/**
 * JSDoc macro handling, decorator parsing/sorting, and derive expansion.
 *
 * Functions for detecting JSDoc macro tags, synthesizing decorators from
 * JSDoc comments, topologically sorting decorators, expanding derive macros,
 * and extracting type information for derive implementations.
 */

import * as ts from "typescript";

import {
  tryExpandGenericDerive,
  tryExtractSumType,
  instanceScanner,
  companionPath,
  reportGenericDeriveFailure,
} from "@typesugar/macros";

import {
  MacroContextImpl,
  type MacroDefinition,
  type AttributeMacro,
  type DeriveMacro,
  DeriveTypeInfo,
  DeriveFieldInfo,
  DeriveVariantInfo,
  globalResolutionScope,
  isInOptedOutScope,
  getSuggestionsForSymbol,
  formatSuggestionsMessage,
  TS9101,
  TS9102,
  TS9103,
  TS9104,
  isJSDocTagAtLineStart,
} from "@typesugar/core";

// Moved to @typesugar/core (the instance scanner in @typesugar/macros needs it
// too); re-exported here for existing importers.
export { isJSDocTagAtLineStart };

import { safeGetNodeText, isPrimitiveType, type VisitFn } from "./transformer-utils.js";
import { lookupMacroByName } from "./import-resolution.js";

// ---------------------------------------------------------------------------
// JSDoc macro tags
// ---------------------------------------------------------------------------

// PEP-052 Wave 8: unified with the legacy transformer's private copy
// (transformer/src/index.ts JSDOC_MACRO_TAGS) — both dispatchers now handle
// `derive`/`deriving` the same way (see tryExpandJSDocMacros below and
// tryExpandAttributeMacros in transformer.ts): PEP-032 deleted the standalone
// `derive` ATTRIBUTE macro from the registry, so both dispatchers special-case
// it directly rather than looking it up via globalRegistry.getAttribute.
// `adt` needs no special case — it's a real, registered attribute macro
// (packages/macros/src/adt.ts) and only needed to be recognized as a
// macro-triggering tag at all. `operators`/`operator` were already dead
// entries before this wave (verified: no attribute macro named either exists
// — real operator/method syntax activation is the separate Wave 6 mechanism,
// `@syntax-operators` markers read via readSyntaxActivationMarkers, not this
// dispatcher) — kept for parity/no silent removal, but they still just
// produce "unknown macro tag" like before.
export const JSDOC_MACRO_TAGS: ReadonlyMap<string, string> = new Map([
  ["typeclass", "typeclass"],
  ["impl", "impl"],
  ["instance", "instance"],
  ["derive", "derive"],
  ["deriving", "deriving"],
  ["operators", "operators"],
  ["operator", "operator"],
  ["extension", "extension"],
  ["reflect", "reflect"],
  ["hkt", "hkt"],
  ["adt", "adt"],
  // Function-only attribute macro (docs review B#4): `/** @tailrec */` on a
  // function declaration was silently ignored. On a non-function target the
  // macro itself reports that it only applies to functions.
  ["tailrec", "tailrec"],
  // @typesugar/sql's schema attribute macro: `/** @schema("users") */` was
  // silently ignored while the decorator form reached the macro.
  ["schema", "schema"],
  // @typesugar/contracts' function attribute macro (docs guides-b #4):
  // `/** @contract */ function f() { requires: ... }` was silently ignored.
  ["contract", "contract"],
]);

/** The SourceFile a (parsed) node belongs to, or undefined for a synthetic node. */
function sourceFileOf(node: ts.Node): ts.SourceFile | undefined {
  let n: ts.Node | undefined = ts.getOriginalNode(node);
  while (n && !ts.isSourceFile(n)) n = n.parent;
  return n;
}

/** Does `sourceFile` import `moduleName` (or a subpath of it) in any form? */
function fileImportsModule(sourceFile: ts.SourceFile, moduleName: string): boolean {
  return sourceFile.statements.some(
    (stmt) =>
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      (stmt.moduleSpecifier.text === moduleName ||
        stmt.moduleSpecifier.text.startsWith(moduleName + "/"))
  );
}

/**
 * The attribute-macro name a JSDoc tag dispatches, if any: a built-in tag from
 * {@link JSDOC_MACRO_TAGS}, or -- for third-party attribute macros (docs
 * start #6) -- a registered attribute macro of the same name whose `module`
 * this file imports (`import "my-macros"`, `import { logged } from
 * "my-macros"`, or a subpath). The import requirement keeps ordinary
 * documentation tags inert in files that never asked for such a macro; the
 * caller still applies the line-start rule and the function-target check.
 *
 * Reads the file's own `import` declarations, which are never synthesized
 * mid-pass, and the macro registry, which macro packages populate at load
 * time -- so no same-pass-visibility concern (CLAUDE.md).
 */
export function jsDocTagMacroName(tag: ts.JSDocTag, node: ts.Node): string | undefined {
  const name = tag.tagName.text;
  const builtin = JSDOC_MACRO_TAGS.get(name);
  if (builtin) return builtin;
  const sf = sourceFileOf(node);
  // Several modules may register an attribute macro of this name (PEP-060
  // item 8): the file's imports pick one.
  const macro = lookupMacroByName(sf, name, "attribute");
  if (!macro?.module) return undefined;
  return sf && fileImportsModule(sf, macro.module) ? name : undefined;
}

export function isJSDocMacroTargetNode(
  node: ts.Node
): node is
  | ts.InterfaceDeclaration
  | ts.ClassDeclaration
  | ts.TypeAliasDeclaration
  | ts.VariableStatement
  | ts.VariableDeclaration
  | ts.FunctionDeclaration
  | ts.EnumDeclaration {
  return (
    // An enum carries no macro, but a `@derive` on one is reported (TS9102).
    ts.isEnumDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isVariableStatement(node) ||
    ts.isVariableDeclaration(node)
  );
}

export function hasJSDocMacroTags(node: ts.Node): boolean {
  if (!isJSDocMacroTargetNode(node)) {
    return false;
  }

  const tags = ts.getJSDocTags(node);
  for (const tag of tags) {
    if (jsDocTagMacroName(tag, node) && isJSDocTagAtLineStart(tag)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// JSDoc macro expansion
// ---------------------------------------------------------------------------

export function tryExpandJSDocMacros(
  ctx: MacroContextImpl,
  verbose: boolean,
  node: ts.Node
): ts.Node | ts.Node[] | undefined {
  if (isInOptedOutScope(ctx.sourceFile, node, globalResolutionScope, "macros")) {
    return undefined;
  }

  if (!isJSDocMacroTargetNode(node)) {
    return undefined;
  }

  const tags = ts.getJSDocTags(node);
  const results: ts.Node[] = [];
  let derived = false;

  let targetDecl: ts.Declaration;
  if (ts.isVariableStatement(node)) {
    if (node.declarationList.declarations.length === 0) {
      return undefined;
    }
    targetDecl = node.declarationList.declarations[0];
  } else {
    targetDecl = node;
  }

  let currentNode: ts.Declaration = targetDecl;

  for (const tag of tags) {
    const macroName = jsDocTagMacroName(tag, node);
    if (!macroName) continue;
    // Prose / fenced-example / nested-comment mentions are not triggers.
    if (!isJSDocTagAtLineStart(tag)) continue;

    // @derive/@deriving are handled directly (PEP-032 deleted the standalone
    // `derive` attribute macro; individual derives are registered under
    // globalRegistry.getDerive instead — see expandDeriveDecorator).
    if (macroName === "derive" || macroName === "deriving") {
      const args = parseJSDocMacroArgs(ctx, tag, macroName);
      if (
        ts.isInterfaceDeclaration(currentNode) ||
        ts.isClassDeclaration(currentNode) ||
        ts.isTypeAliasDeclaration(currentNode)
      ) {
        const syntheticDecorator = createSyntheticDecorator(ctx, tag, macroName, args);
        const derives = expandDeriveDecorator(ctx, verbose, syntheticDecorator, currentNode, args);
        if (derives) {
          results.push(...derives);
          derived = true;
        }
      } else if (!isDeriveProse(tag)) {
        // A const, a function, an enum: not a type, so nothing to derive. Said
        // so (TS9102) rather than dropping the tag — a `/** @derive(Eq) */
        // const p = ...` used to be ignored without a word.
        reportDeriveOnNonType(ctx, tag, args, currentNode);
      }
      continue;
    }

    // An enum carries no other macro tag.
    if (ts.isEnumDeclaration(currentNode)) {
      ctx.reportWarning(
        tag,
        `JSDoc macro tag @${tag.tagName.text} is not supported on an enum and was ignored.`
      );
      continue;
    }

    const macro = lookupMacroByName(ctx.sourceFile, macroName, "attribute") as
      | AttributeMacro
      | undefined;
    if (!macro) {
      ctx.reportWarning(tag, `Unknown JSDoc macro tag @${tag.tagName.text}`);
      continue;
    }

    // A function declaration only dispatches attribute macros that declare
    // "function" as a valid target (@extension, @tailrec); anything else
    // (`/** @typeclass */ function f`) is reported, not silently dropped.
    if (ts.isFunctionDeclaration(currentNode) && !macro.validTargets.includes("function")) {
      reportUnsupportedOnFunction(ctx, tag);
      continue;
    }

    const args = parseJSDocMacroArgs(ctx, tag, macroName);

    const syntheticDecorator = createSyntheticDecorator(ctx, tag, macroName, args);

    try {
      if (verbose) {
        console.log(`[typesugar] Expanding JSDoc macro: @${tag.tagName.text}`);
      }

      const expanded = macro.expand(ctx, syntheticDecorator, currentNode, args);

      if (expanded === undefined) continue;

      if (Array.isArray(expanded)) {
        if (expanded.length > 0) {
          currentNode = expanded[0] as ts.Declaration;
          results.push(...expanded.slice(1));
        }
      } else {
        currentNode = expanded as ts.Declaration;
      }
    } catch (err) {
      const macroTag = tag.tagName.text;
      const errMsg = err instanceof Error ? err.message : String(err);
      ctx.reportError(tag, `@${macroTag} macro failed (this may be transient — try saving again)`);
      if (verbose) {
        console.error(
          `[typesugar] @${macroTag} expand threw: ${err instanceof Error ? err.stack : errMsg}`
        );
      }
    }
  }

  // Several @derive tags: their functions before any of their namespaces.
  if (derived) results.splice(0, results.length, ...functionsFirst(results));

  const wasExpanded = currentNode !== targetDecl || results.length > 0;
  if (!wasExpanded) {
    return undefined;
  }

  if (ts.isVariableStatement(node)) {
    const factory = ctx.factory;
    const updatedDecl = currentNode as ts.VariableDeclaration;
    const updatedDeclList = factory.updateVariableDeclarationList(node.declarationList, [
      updatedDecl,
      ...node.declarationList.declarations.slice(1),
    ]);
    const updatedStmt = factory.updateVariableStatement(node, node.modifiers, updatedDeclList);
    return results.length > 0 ? [updatedStmt, ...results] : updatedStmt;
  }

  return results.length > 0 ? [currentNode, ...results] : currentNode;
}

/**
 * A `@derive(...)` line followed by prose, `@derive(Read) — derives a Read
 * instance`, is documentation of a derive macro (written on the macro's
 * `const`), not a request to derive: its argument list is followed by more
 * text. Only consulted where `@derive` can't apply (TS9102); on a type
 * declaration the tag derives as before.
 */
function isDeriveProse(tag: ts.JSDocTag): boolean {
  const comment =
    typeof tag.comment === "string" ? tag.comment : ts.getTextOfJSDocComment(tag.comment);
  const text = (comment ?? "").trim();
  // The unparenthesized form, `@derive Eq, Clone`: anything but a name list is prose.
  if (!text.startsWith("(")) return !/^([A-Za-z_$][\w$]*(\s*,\s*[A-Za-z_$][\w$]*)*)?$/.test(text);
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(i + 1).trim().length > 0;
  }
  return false;
}

/**
 * TS9102 for `@derive` on something that is not a type declaration. On a
 * variable, the help points at what the author likely wanted: the type's own
 * declaration, or `derived<TC<T>>()` for a type they don't own.
 */
export function reportDeriveOnNonType(
  ctx: MacroContextImpl,
  at: ts.Node,
  args: readonly ts.Expression[],
  target: ts.Node
): void {
  const names = args.filter(ts.isIdentifier).map((a) => a.text);
  const typeclass = names.join(", ") || "...";
  const first = names[0] ?? "Eq";
  const builder = ctx.diagnostic(TS9102).at(at).withArgs({ typeclass });
  if (ts.isVariableDeclaration(target) || ts.isVariableStatement(target)) {
    builder
      .note("@derive was ignored: this is a variable, and a variable has no fields to derive from.")
      .help(
        `Put @derive(${typeclass}) on the declaration of the variable's type, or, for a type ` +
          `you don't own, declare its instance: \`export const instance = derived<${first}<Type>>();\``
      );
  } else {
    const what = ts.isFunctionDeclaration(target)
      ? "a function"
      : ts.isEnumDeclaration(target)
        ? "an enum, whose values are numbers or strings (compared and copied as they are)"
        : "not a type declaration";
    builder
      .note(`@derive was ignored: this is ${what}.`)
      .help(`Put @derive(${typeclass}) on an interface, class or type alias.`);
  }
  builder.emit();
}

function reportUnsupportedOnFunction(ctx: MacroContextImpl, tag: ts.JSDocTag): void {
  ctx.reportWarning(
    tag,
    `JSDoc macro tag @${tag.tagName.text} is not supported on a function declaration and was ignored.`
  );
}

// ---------------------------------------------------------------------------
// JSDoc argument parsing
// ---------------------------------------------------------------------------

export function parseJSDocMacroArgs(
  ctx: MacroContextImpl,
  tag: ts.JSDocTag,
  macroName: string
): ts.Expression[] {
  const comment =
    typeof tag.comment === "string" ? tag.comment : ts.getTextOfJSDocComment(tag.comment);

  const trimmed = comment?.trim() ?? "";

  switch (macroName) {
    case "typeclass":
      if (!trimmed) return [];
      try {
        JSON.parse(trimmed);
        return [ctx.factory.createStringLiteral(trimmed)];
      } catch {
        return [];
      }

    case "impl":
    case "instance":
      if (!trimmed) return [];
      return [ctx.factory.createStringLiteral(trimmed)];

    case "derive":
    case "deriving": {
      // @derive Eq, Clone or @deriving (Show, Eq, Ord) — optional wrapping
      // parens are stripped so both forms parse the same. A tag's comment
      // runs to the next tag, so only the leading list is the derive list:
      // the parenthesized part, or the comma-separated names that start the
      // comment; prose after it ("@derive(Meta)" then a description line) is
      // documentation, not more derives (it was "Unknown derive: '(Meta)\n
      // User table schema ...'"). This reads the tag's syntax, not code.
      if (!trimmed) return [];
      const list = /^\(([^)]*)\)|^([A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*)/.exec(trimmed);
      const inner = list ? (list[1] ?? list[2]) : trimmed;
      const tcNames = inner
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return tcNames.map((name) => ctx.factory.createIdentifier(name));
    }

    default:
      return [];
  }
}

export function createSyntheticDecorator(
  ctx: MacroContextImpl,
  tag: ts.JSDocTag,
  macroName: string,
  args: ts.Expression[]
): ts.Decorator {
  const factory = ctx.factory;

  let expression: ts.Expression;
  if (args.length === 0) {
    expression = factory.createIdentifier(macroName);
  } else {
    expression = factory.createCallExpression(factory.createIdentifier(macroName), undefined, args);
  }

  const decorator = factory.createDecorator(expression);
  return ts.setTextRange(decorator, tag);
}

// ---------------------------------------------------------------------------
// Decorator parsing and sorting
// ---------------------------------------------------------------------------

export function parseDecorator(decorator: ts.Decorator): {
  macroName: string;
  args: ts.Expression[];
  identNode: ts.Node | undefined;
} {
  const expr = decorator.expression;

  if (ts.isIdentifier(expr)) {
    return { macroName: expr.text, args: [], identNode: expr };
  }

  if (ts.isCallExpression(expr)) {
    if (ts.isIdentifier(expr.expression)) {
      return {
        macroName: expr.expression.text,
        args: Array.from(expr.arguments),
        identNode: expr.expression,
      };
    }
  }

  return { macroName: "", args: [], identNode: undefined };
}

export function sortDecoratorsByDependency(decorators: readonly ts.Decorator[]): ts.Decorator[] {
  const parsed = decorators.map((d) => ({
    decorator: d,
    ...parseDecorator(d),
  }));

  const nameToIndex = new Map<string, number>();
  for (let i = 0; i < parsed.length; i++) {
    const name = parsed[i].macroName;
    if (name) nameToIndex.set(name, i);
  }

  // Expand-order metadata only; the file's imports pick among same-named
  // macros of different modules (PEP-060 item 8).
  const sf = decorators.length > 0 ? sourceFileOf(decorators[0]) : undefined;
  const orderingMacro = (name: string) =>
    lookupMacroByName(sf, name, "attribute") ?? lookupMacroByName(sf, name, "derive");

  let hasDeps = false;
  for (const p of parsed) {
    if (!p.macroName) continue;
    const macro = orderingMacro(p.macroName);
    if (macro?.expandAfter && macro.expandAfter.length > 0) {
      hasDeps = true;
      break;
    }
  }
  if (!hasDeps) return [...decorators];

  const n = parsed.length;
  const inDegree = new Array<number>(n).fill(0);
  const adj: number[][] = [];
  for (let i = 0; i < n; i++) adj.push([]);

  for (let i = 0; i < n; i++) {
    const name = parsed[i].macroName;
    if (!name) continue;
    const macro = orderingMacro(name);
    if (!macro?.expandAfter) continue;
    for (const dep of macro.expandAfter) {
      const depIdx = nameToIndex.get(dep);
      if (depIdx !== undefined) {
        adj[depIdx].push(i);
        inDegree[i]++;
      }
    }
  }

  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (inDegree[i] === 0) queue.push(i);
  }

  const sorted: ts.Decorator[] = [];
  while (queue.length > 0) {
    queue.sort((a, b) => a - b);
    const idx = queue.shift()!;
    sorted.push(parsed[idx].decorator);
    for (const next of adj[idx]) {
      inDegree[next]--;
      if (inDegree[next] === 0) queue.push(next);
    }
  }

  if (sorted.length < n) {
    return [...decorators];
  }

  return sorted;
}

// ---------------------------------------------------------------------------
// Derive dependency sorting
// ---------------------------------------------------------------------------

const BUILTIN_DERIVE_DEPS: Record<string, string[]> = {
  Ord: ["Eq"],
  Monoid: ["Semigroup"],
};

export function sortDeriveArgsByDependency(args: ts.Expression[]): ts.Expression[] {
  const identArgs = args.filter(ts.isIdentifier);
  if (identArgs.length < 2) return [...args];

  const nameToIndex = new Map<string, number>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (ts.isIdentifier(a)) nameToIndex.set(a.text, i);
  }

  const sf = sourceFileOf(identArgs[0]);
  let hasDeps = false;
  const n = args.length;
  const inDegree = new Array<number>(n).fill(0);
  const adj: number[][] = [];
  for (let i = 0; i < n; i++) adj.push([]);

  for (let i = 0; i < n; i++) {
    const a = args[i];
    if (!ts.isIdentifier(a)) continue;
    const name = a.text;

    const deps: string[] = [];

    const deriveMacro = lookupMacroByName(sf, name, "derive");
    if (deriveMacro?.expandAfter) {
      deps.push(...deriveMacro.expandAfter);
    }

    const tcMacro = lookupMacroByName(sf, `${name}TC`, "derive");
    if (tcMacro?.expandAfter) {
      deps.push(...tcMacro.expandAfter);
    }

    const builtinDeps = BUILTIN_DERIVE_DEPS[name];
    if (builtinDeps) {
      deps.push(...builtinDeps);
    }

    for (const dep of deps) {
      const depIdx = nameToIndex.get(dep);
      if (depIdx !== undefined) {
        adj[depIdx].push(i);
        inDegree[i]++;
        hasDeps = true;
      }
    }
  }

  if (!hasDeps) return [...args];

  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (inDegree[i] === 0) queue.push(i);
  }

  const sorted: ts.Expression[] = [];
  while (queue.length > 0) {
    queue.sort((a, b) => a - b);
    const idx = queue.shift()!;
    sorted.push(args[idx]);
    for (const next of adj[idx]) {
      inDegree[next]--;
      if (inDegree[next] === 0) queue.push(next);
    }
  }

  if (sorted.length < n) {
    return [...args];
  }

  return sorted;
}

// ---------------------------------------------------------------------------
// Derive decorator expansion
// ---------------------------------------------------------------------------

/**
 * Recursively set the source map range on a node and all its descendants.
 * Used for macro-generated statements whose leaf nodes lack real positions
 * (synthetic/derived AST), so the printer's source map maps them back to
 * the originating decorator instead of leaving them unmapped.
 */
function setSourceMapRangeDeep<T extends ts.Node>(node: T, original: ts.Node): T {
  const range = ts.getSourceMapRange(original);
  function visit(n: ts.Node): void {
    ts.setSourceMapRange(n, range);
    ts.forEachChild(n, visit);
  }
  visit(node);
  return node;
}

export function expandDeriveDecorator(
  ctx: MacroContextImpl,
  verbose: boolean,
  decorator: ts.Decorator,
  node: ts.Node,
  args: ts.Expression[]
): ts.Statement[] | undefined {
  // Covers both forms: the JSDoc path builds a synthetic `deriving` decorator.
  const callee = ts.isCallExpression(decorator.expression)
    ? decorator.expression.expression
    : decorator.expression;
  if (ts.isIdentifier(callee) && callee.text === "deriving") {
    ctx.reportWarning(decorator, "@deriving is deprecated: use @derive(...) (identical behaviour)");
  }

  if (
    !ts.isInterfaceDeclaration(node) &&
    !ts.isClassDeclaration(node) &&
    !ts.isTypeAliasDeclaration(node)
  ) {
    reportDeriveOnNonType(ctx, decorator, args, node);
    return undefined;
  }

  const sortedArgs = sortDeriveArgsByDependency(args);
  const statements: ts.Statement[] = [];
  const typeInfo = extractTypeInfo(ctx, node);
  const typeName = node.name?.text ?? "Anonymous";

  for (const arg of sortedArgs) {
    if (!ts.isIdentifier(arg)) {
      ctx.reportError(arg, "derive arguments must be identifiers");
      continue;
    }

    const deriveName = arg.text;

    // 1. Check for a registered derive macro (code-gen derives)
    // `@derive(X)` names X without an import binding we resolve: the file's
    // imports pick among several modules' derive macros named X.
    const deriveMacro = lookupMacroByName(ctx.sourceFile, deriveName, "derive") as
      | DeriveMacro
      | undefined;
    if (deriveMacro) {
      if (verbose) {
        console.log(`[typesugar] Expanding derive macro: ${deriveName}`);
      }

      try {
        const result = ctx.hygiene.withScope(() => deriveMacro.expand(ctx, node, typeInfo));
        for (const stmt of result) {
          statements.push(setSourceMapRangeDeep(stmt, decorator));
        }
      } catch (error) {
        ctx.reportError(arg, `Derive macro expansion failed: ${error}`);
      }
      continue;
    }

    // Diagnostic checks for typeclass derivation (applies to both builtin and generic paths)

    // Check for empty types (no fields to derive from)
    if (typeInfo.fields.length === 0 && !ts.isTypeAliasDeclaration(node)) {
      ctx.diagnostic(TS9104).at(arg).withArgs({ typeclass: deriveName, type: typeName }).emit();
      continue;
    }

    // Check for non-derivable field types (functions)
    if (["Eq", "Ord", "Hash", "Clone"].includes(deriveName)) {
      for (const field of typeInfo.fields) {
        if (field.typeString.includes("=>") || field.typeString.startsWith("(")) {
          ctx
            .diagnostic(TS9101)
            .at(arg)
            .withArgs({
              typeclass: deriveName,
              type: typeName,
              field: field.name,
              fieldType: field.typeString,
            })
            .emit();
        }
      }
    }

    // Check for union without discriminant
    if (ts.isTypeAliasDeclaration(node)) {
      const sumCheck = tryExtractSumType(ctx, node);
      if (!sumCheck && ts.isUnionTypeNode(node.type)) {
        ctx.diagnostic(TS9103).at(arg).withArgs({ typeclass: deriveName, type: typeName }).emit();
        continue;
      }
    }

    // 2. Check for a GenericDerivation strategy (unified path for all typeclasses)
    try {
      const genericExpansion = tryExpandGenericDerive(ctx, deriveName, typeName, node);
      if (genericExpansion) {
        if (verbose) {
          console.log(
            `[typesugar] Auto-deriving via GenericDerivation: ${deriveName} for ${typeName}`
          );
        }
        for (const stmt of genericExpansion.statements) {
          statements.push(setSourceMapRangeDeep(stmt, decorator));
        }
        // Same-pass fix (PEP-052/task #30): this always builds a companion at
        // the `${typeName}.${deriveName}` convention (see tryExpandGenericDerive's
        // "Build companion namespace directly as AST" comment) — but that
        // companion is spliced only into the transformer's OUTPUT tree, never
        // into `ctx.sourceFile.statements`, so operator/method-sugar resolution
        // (which scans the pre-transform source) can never see it on its own.
        // Registering it here makes it visible to a LATER use site in the same
        // file (e.g. `p1 === p2` after `@derive(Eq) class Point`).
        if (typeInfo.type) {
          instanceScanner.registerSynthesized(ctx.program, ctx.sourceFile.fileName, {
            typeclassName: deriveName,
            forType: typeInfo.type,
            forTypeString: typeName,
            exportName: companionPath(deriveName, typeName),
            sourceModule: ctx.sourceFile.fileName,
            detectedVia: "derived",
          });
        }
        continue;
      }
    } catch (error) {
      reportGenericDeriveFailure(ctx, arg, deriveName, error);
      continue;
    }

    // 3. Check for a "{Name}TC" derive macro (typeclass derive convention)
    const tcDeriveMacro = lookupMacroByName(ctx.sourceFile, `${deriveName}TC`, "derive") as
      | DeriveMacro
      | undefined;
    if (tcDeriveMacro) {
      if (verbose) {
        console.log(`[typesugar] Expanding typeclass derive macro: ${deriveName}TC`);
      }
      try {
        const result = ctx.hygiene.withScope(() => tcDeriveMacro.expand(ctx, node, typeInfo));
        for (const stmt of result) {
          statements.push(setSourceMapRangeDeep(stmt, decorator));
        }
      } catch (error) {
        ctx.reportError(arg, `Typeclass derive macro expansion failed: ${error}`);
      }
      continue;
    }

    // 4. Nothing found — provide import suggestions
    const suggestions = getSuggestionsForSymbol(deriveName);
    const suggestionMsg = formatSuggestionsMessage(suggestions);
    const message = suggestionMsg
      ? `Unknown derive: '${deriveName}'. Not a registered derive macro, ` +
        `typeclass with auto-derivation, or typeclass derive macro ` +
        `('${deriveName}TC').\n\n${suggestionMsg}`
      : `Unknown derive: '${deriveName}'. Not a registered derive macro, ` +
        `typeclass with auto-derivation, or typeclass derive macro ` +
        `('${deriveName}TC').`;
    ctx.reportError(arg, message);
  }

  return statements.length > 0 ? functionsFirst(statements) : undefined;
}

/**
 * Derive output with its function declarations first. A derive may emit a
 * function named like the type (`@derive(Destructure)`'s `function Point`)
 * and another a companion `namespace Point` (`@derive(Eq)`); they merge only
 * when the function comes first (TS2434). Function declarations are hoisted,
 * so moving them up changes nothing at run time. Stable otherwise.
 */
export function functionsFirst<T extends ts.Node>(nodes: T[]): T[] {
  return [
    ...nodes.filter((n) => ts.isFunctionDeclaration(n)),
    ...nodes.filter((n) => !ts.isFunctionDeclaration(n)),
  ];
}

// ---------------------------------------------------------------------------
// Type info extraction for derives
// ---------------------------------------------------------------------------

export function extractTypeInfo(
  ctx: MacroContextImpl,
  node: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration
): DeriveTypeInfo {
  const name = node.name?.text ?? "Anonymous";
  const typeParameters = node.typeParameters ? Array.from(node.typeParameters) : [];

  let type: ts.Type;
  try {
    type = ctx.typeChecker.getTypeAtLocation(node);
  } catch (e) {
    // Degrading to zero fields changes generated output (e.g. an Eq that
    // compares nothing), so the user must see it (CLAUDE.md rule 3).
    ctx.reportWarning(
      node,
      `could not resolve the type of '${name}' (${e instanceof Error ? e.message : String(e)}); ` +
        `derived code will see no fields`
    );
    return {
      name,
      fields: [],
      typeParameters,
      type: undefined as unknown as ts.Type,
      kind: "product",
    };
  }

  if (ts.isTypeAliasDeclaration(node)) {
    const sumInfo = tryExtractSumType(ctx, node);
    if (sumInfo) {
      return extractSumTypeInfo(ctx, node, name, typeParameters, type, sumInfo);
    }
  }

  if (ts.isTypeAliasDeclaration(node) && isPrimitiveType(type)) {
    return { name, fields: [], typeParameters, type, kind: "primitive" };
  }

  const fields: DeriveFieldInfo[] = [];
  let properties: ts.Symbol[];
  try {
    properties = ctx.typeChecker.getPropertiesOfType(type);
  } catch (e) {
    ctx.reportWarning(
      node,
      `could not list the properties of '${name}' (${e instanceof Error ? e.message : String(e)}); ` +
        `derived code will see no fields`
    );
    return { name, fields: [], typeParameters, type, kind: "product" };
  }

  let isRecursive = false;
  for (const prop of properties) {
    const declarations = prop.getDeclarations();
    if (!declarations || declarations.length === 0) continue;

    const decl = declarations[0];

    // Skip method declarations and accessors — only derive for data fields
    if (
      ts.isMethodDeclaration(decl) ||
      ts.isMethodSignature(decl) ||
      ts.isGetAccessorDeclaration(decl) ||
      ts.isSetAccessorDeclaration(decl)
    ) {
      continue;
    }

    let propType: ts.Type;
    let propTypeString: string;
    try {
      propType = ctx.typeChecker.getTypeOfSymbolAtLocation(prop, decl);
      propTypeString = ctx.typeChecker.typeToString(propType);
    } catch {
      propType = type;
      propTypeString = "unknown";
    }

    if (propTypeString === name || propTypeString.includes(`${name}<`)) {
      isRecursive = true;
    }

    const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
    const readonly =
      ts.isPropertyDeclaration(decl) || ts.isPropertySignature(decl)
        ? (decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false)
        : false;

    fields.push({
      name: prop.name,
      typeString: propTypeString,
      type: propType,
      optional,
      readonly,
      symbol: prop,
    });
  }

  return { name, fields, typeParameters, type, kind: "product", isRecursive };
}

function extractSumTypeInfo(
  ctx: MacroContextImpl,
  node: ts.TypeAliasDeclaration,
  name: string,
  typeParameters: ts.TypeParameterDeclaration[],
  type: ts.Type,
  sumInfo: { discriminant: string; variants: Array<{ tag: string; typeName: string }> }
): DeriveTypeInfo {
  const variants: DeriveVariantInfo[] = [];
  let isRecursive = false;

  if (ts.isUnionTypeNode(node.type)) {
    for (const member of node.type.types) {
      let memberType: ts.Type;
      let variantInfo: { tag: string; typeName: string } | undefined;
      try {
        memberType = ctx.typeChecker.getTypeFromTypeNode(member);
      } catch (e) {
        ctx.reportWarning(
          member,
          `could not resolve a variant of '${name}' (${e instanceof Error ? e.message : String(e)}); ` +
            `derived code will not handle it`
        );
        continue;
      }
      if (ts.isTypeReferenceNode(member)) {
        const memberTypeName = ts.isIdentifier(member.typeName)
          ? member.typeName.text
          : safeGetNodeText(member.typeName, ctx.sourceFile);
        variantInfo = sumInfo.variants.find((v) => v.typeName === memberTypeName);
      } else if (ts.isTypeLiteralNode(member)) {
        // Inline `{ kind: "square"; ... }`: tryExtractSumType names it
        // `${alias}_${tag}`; recover its tag from the discriminant's type.
        const discProp = memberType.getProperty(sumInfo.discriminant);
        const discDecl = discProp?.getDeclarations()?.[0];
        const discType =
          discProp && discDecl
            ? ctx.typeChecker.getTypeOfSymbolAtLocation(discProp, discDecl)
            : undefined;
        if (discType?.isStringLiteral()) {
          const tag = discType.value;
          variantInfo = sumInfo.variants.find(
            (v) => v.tag === tag && v.typeName === `${name}_${tag}`
          );
        }
      }
      if (!variantInfo) continue;

      const fields: DeriveFieldInfo[] = [];

      try {
        const props = ctx.typeChecker.getPropertiesOfType(memberType);
        for (const prop of props) {
          if (prop.name === sumInfo.discriminant) continue;

          const declarations = prop.getDeclarations();
          if (!declarations || declarations.length === 0) continue;

          const decl = declarations[0];
          let propType: ts.Type;
          let propTypeString: string;
          try {
            propType = ctx.typeChecker.getTypeOfSymbolAtLocation(prop, decl);
            propTypeString = ctx.typeChecker.typeToString(propType);
          } catch {
            propType = memberType;
            propTypeString = "unknown";
          }

          if (propTypeString === name || propTypeString.includes(`${name}<`)) {
            isRecursive = true;
          }

          const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
          const readonly =
            ts.isPropertyDeclaration(decl) || ts.isPropertySignature(decl)
              ? (decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false)
              : false;

          fields.push({
            name: prop.name,
            typeString: propTypeString,
            type: propType,
            optional,
            readonly,
            symbol: prop,
          });
        }
      } catch (e) {
        ctx.reportWarning(
          member,
          `could not list the fields of variant '${variantInfo.tag}' of '${name}' ` +
            `(${e instanceof Error ? e.message : String(e)}); derived code will see no fields`
        );
      }

      variants.push({
        tag: variantInfo.tag,
        typeName: variantInfo.typeName,
        fields,
      });
    }
  }

  return {
    name,
    fields: [],
    typeParameters,
    type,
    kind: "sum",
    variants,
    discriminant: sumInfo.discriminant,
    isRecursive,
  };
}
