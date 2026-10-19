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
  globalRegistry,
  type MacroDefinition,
  DeriveTypeInfo,
  DeriveFieldInfo,
  DeriveVariantInfo,
  globalResolutionScope,
  isInOptedOutScope,
  getSuggestionsForSymbol,
  formatSuggestionsMessage,
  TS9101,
  TS9103,
  TS9104,
} from "@typesugar/core";

import { safeGetNodeText, isPrimitiveType, type VisitFn } from "./transformer-utils.js";

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
  const macro = globalRegistry.getAttribute(name);
  if (!macro?.module) return undefined;
  const sf = sourceFileOf(node);
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
  | ts.FunctionDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isVariableStatement(node) ||
    ts.isVariableDeclaration(node)
  );
}

/**
 * Whether a JSDoc tag sits at a real tag position: the `@` starts its comment
 * line (only whitespace and the leading `*` before it, or only whitespace
 * after `/**` on the comment's first line), and the line is not inside a
 * ``` / ~~~ code fence within that comment.
 *
 * TypeScript's JSDoc parser treats any whitespace-preceded `@word` as a tag,
 * so prose ("Parsed from @adt tag."), nested example comments
 * (` * /** @hkt *\/`) and fenced examples (` * @derive(Read)` between ```)
 * all come back from `ts.getJSDocTags`. Those must not dispatch macros.
 *
 * A tag with no real source position (synthetic) is accepted, as before.
 */
export function isJSDocTagAtLineStart(tag: ts.JSDocTag): boolean {
  if (tag.pos < 0) return true;
  let jsDoc: ts.Node | undefined = tag.parent;
  while (jsDoc && jsDoc.kind !== ts.SyntaxKind.JSDoc) jsDoc = jsDoc.parent;
  let root: ts.Node | undefined = jsDoc;
  while (root && root.kind !== ts.SyntaxKind.SourceFile) root = root.parent;
  if (!jsDoc || !root || jsDoc.pos < 0) return true;
  const text = (root as ts.SourceFile).text;
  const commentStart = jsDoc.pos;
  const tagPos = tag.pos;
  if (text.charCodeAt(tagPos) !== 64 /* @ */) return true;

  // Prefix of the tag's own line.
  const lineStart = text.lastIndexOf("\n", tagPos - 1) + 1;
  const prefix =
    lineStart <= commentStart
      ? text.slice(commentStart, tagPos).replace(/^\/\*\*/, "")
      : text.slice(lineStart, tagPos).replace(/^[ \t]*\*/, "");
  if (!/^[ \t]*$/.test(prefix)) return false;

  // Code-fence state over the comment lines BEFORE the tag's line.
  let inFence = false;
  const before = text.slice(commentStart, lineStart);
  for (const rawLine of before.split("\n")) {
    const line = rawLine
      .replace(/^[ \t]*\/\*\*/, "")
      .replace(/^[ \t]*\*/, "")
      .trimStart();
    if (line.startsWith("```") || line.startsWith("~~~")) inFence = !inFence;
  }
  return !inFence;
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
        }
      } else if (ts.isFunctionDeclaration(currentNode)) {
        reportUnsupportedOnFunction(ctx, tag);
      }
      continue;
    }

    const macro = globalRegistry.getAttribute(macroName);
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
      // parens are stripped so both forms parse the same.
      if (!trimmed) return [];
      const inner =
        trimmed.startsWith("(") && trimmed.endsWith(")") ? trimmed.slice(1, -1) : trimmed;
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

  let hasDeps = false;
  for (const p of parsed) {
    if (!p.macroName) continue;
    const macro = globalRegistry.getAttribute(p.macroName) ?? globalRegistry.getDerive(p.macroName);
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
    const macro = globalRegistry.getAttribute(name) ?? globalRegistry.getDerive(name);
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

    const deriveMacro = globalRegistry.getDerive(name);
    if (deriveMacro?.expandAfter) {
      deps.push(...deriveMacro.expandAfter);
    }

    const tcMacro = globalRegistry.getDerive(`${name}TC`);
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
    ctx.reportError(
      decorator,
      "@derive can only be applied to interfaces, classes, or type aliases"
    );
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
    const deriveMacro = globalRegistry.getDerive(deriveName);
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
    const tcDeriveMacro = globalRegistry.getDerive(`${deriveName}TC`);
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

  return statements.length > 0 ? statements : undefined;
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
