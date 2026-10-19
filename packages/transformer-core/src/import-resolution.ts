/**
 * Import tracking, cleanup, and macro resolution from symbols.
 *
 * Functions for recording which imports resolve to macros,
 * cleaning up macro-only imports, resolving module specifiers,
 * and resolving symbols to macro definitions.
 */

import * as ts from "typescript";

import {
  MacroContextImpl,
  globalRegistry,
  type MacroDefinition,
  scanImportsForScope,
  globalResolutionScope,
  isSyntheticNode,
  type StandaloneExtensionInfo,
} from "@typesugar/core";

// ---------------------------------------------------------------------------
// Import tracking
// ---------------------------------------------------------------------------

/** Get-or-create a Set for the given import declaration and add a value. */
function trackMacroImport(
  macroImportSpecifiers: Map<
    ts.ImportDeclaration,
    Set<ts.ImportSpecifier | "namespace" | "default">
  >,
  importDecl: ts.ImportDeclaration,
  value: ts.ImportSpecifier | "namespace" | "default"
): void {
  let set = macroImportSpecifiers.get(importDecl);
  if (!set) {
    set = new Set();
    macroImportSpecifiers.set(importDecl, set);
  }
  set.add(value);
}

/**
 * Record that a symbol resolved to a macro, so its import specifier can be
 * removed after the visitor pass.
 */
export function recordMacroImport(
  macroImportSpecifiers: Map<
    ts.ImportDeclaration,
    Set<ts.ImportSpecifier | "namespace" | "default">
  >,
  originalSymbol: ts.Symbol
): void {
  const declarations = originalSymbol.getDeclarations();
  if (!declarations) return;

  for (const decl of declarations) {
    if (ts.isImportSpecifier(decl)) {
      const importDecl = decl.parent.parent.parent;
      if (ts.isImportDeclaration(importDecl)) {
        trackMacroImport(macroImportSpecifiers, importDecl, decl);
      }
      return;
    }

    if (ts.isNamespaceImport(decl)) {
      const importDecl = decl.parent.parent;
      if (ts.isImportDeclaration(importDecl)) {
        trackMacroImport(macroImportSpecifiers, importDecl, "namespace");
      }
      return;
    }

    if (ts.isImportClause(decl) && decl.name) {
      const importDecl = decl.parent;
      if (ts.isImportDeclaration(importDecl)) {
        trackMacroImport(macroImportSpecifiers, importDecl, "default");
      }
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Import cleanup
// ---------------------------------------------------------------------------

/**
 * Collect the identifier texts still used as VALUE references in the
 * transformed (non-import) statements: skips type positions, property-access
 * names, and declaration names, but counts shorthand properties and
 * `export { x }` specifiers.
 */
function collectValueReferences(statements: readonly ts.Statement[]): Set<string> {
  const refs = new Set<string>();
  const walk = (node: ts.Node, parent: ts.Node | undefined): void => {
    if (ts.isIdentifier(node)) {
      if (parent && (parent as { name?: ts.Node }).name === node) {
        if (ts.isShorthandPropertyAssignment(parent)) refs.add(node.text);
        else if (ts.isExportSpecifier(parent) && !parent.propertyName) refs.add(node.text);
        return;
      }
      refs.add(node.text);
      return;
    }
    if (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node)) return;
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return;
    if (ts.isPropertyAccessExpression(node)) {
      walk(node.expression, node);
      return;
    }
    if (ts.isQualifiedName(node)) return;
    ts.forEachChild(node, (child) => walk(child, node));
  };
  for (const stmt of statements) {
    if (ts.isImportDeclaration(stmt)) continue;
    if (ts.isImportEqualsDeclaration(stmt)) continue;
    walk(stmt, undefined);
  }
  return refs;
}

/**
 * Remove or trim import declarations whose specifiers resolved to macros.
 *
 * A specifier is only removed when no value reference to its local name
 * survives in the transformed statements: an opted-out call (`"use no
 * typesugar"`, `// @ts-no-typesugar`), a value use (`const f = pipe`,
 * `export { pipe }`) or a call left unexpanded still needs the runtime
 * binding (deep-review core #11). Name-based, so a same-named shadowing local
 * also keeps the import -- a harmless false positive.
 */
/**
 * A statement that prints nothing but `stmt`'s leading comments (copied as
 * synthetic comments; the printer drops an original node's comments with the
 * node). Comment text is copied verbatim, not generated.
 */
function commentPlaceholderFor(factory: ts.NodeFactory, stmt: ts.Statement): ts.Statement {
  const placeholder = factory.createNotEmittedStatement(factory.createEmptyStatement());
  const sf = stmt.getSourceFile();
  if (!sf || stmt.pos < 0) return placeholder;
  const text = sf.text;
  for (const range of ts.getLeadingCommentRanges(text, stmt.pos) ?? []) {
    const body =
      range.kind === ts.SyntaxKind.SingleLineCommentTrivia
        ? text.slice(range.pos + 2, range.end)
        : text.slice(range.pos + 2, range.end - 2);
    ts.addSyntheticLeadingComment(placeholder, range.kind, body, range.hasTrailingNewLine);
  }
  return placeholder;
}

export function cleanupMacroImports(
  factory: ts.NodeFactory,
  macroImportSpecifiers: Map<
    ts.ImportDeclaration,
    Set<ts.ImportSpecifier | "namespace" | "default">
  >,
  statements: ts.Statement[],
  verbose: boolean
): ts.Statement[] {
  if (macroImportSpecifiers.size === 0) return statements;

  const stillReferenced = collectValueReferences(statements);
  const result: ts.Statement[] = [];

  for (const stmt of statements) {
    if (!ts.isImportDeclaration(stmt)) {
      result.push(stmt);
      continue;
    }

    const tracked = macroImportSpecifiers.get(stmt);
    if (!tracked) {
      result.push(stmt);
      continue;
    }

    const importClause = stmt.importClause;
    if (!importClause) {
      result.push(stmt);
      continue;
    }

    const hasDefaultImport = importClause.name !== undefined;
    const defaultIsMacro =
      tracked.has("default") && !stillReferenced.has(importClause.name?.text ?? "");
    const keepDefault = hasDefaultImport && !defaultIsMacro;

    const namedBindings = importClause.namedBindings;
    let newNamedBindings: ts.NamedImportBindings | undefined;

    if (namedBindings) {
      if (ts.isNamespaceImport(namedBindings)) {
        if (tracked.has("namespace") && !stillReferenced.has(namedBindings.name.text)) {
          newNamedBindings = undefined;
        } else {
          newNamedBindings = namedBindings;
        }
      } else if (ts.isNamedImports(namedBindings)) {
        const remainingSpecifiers = namedBindings.elements.filter(
          (spec) => !tracked.has(spec) || stillReferenced.has(spec.name.text)
        );

        if (remainingSpecifiers.length === namedBindings.elements.length) {
          newNamedBindings = namedBindings;
        } else if (remainingSpecifiers.length > 0) {
          newNamedBindings = factory.updateNamedImports(namedBindings, remainingSpecifiers);
        } else {
          newNamedBindings = undefined;
        }
      }
    }

    if (!keepDefault && !newNamedBindings) {
      if (verbose) {
        const moduleSpec = ts.isStringLiteral(stmt.moduleSpecifier)
          ? stmt.moduleSpecifier.text
          : "<unknown>";
        console.log(`[typesugar] Removing macro-only import: import ... from "${moduleSpec}"`);
      }
      // Keep the removed import's leading comments (a file header, `//!`
      // banners, JSDoc) attached to a placeholder that prints nothing else;
      // dropping the statement would lose them or reattach them inside the
      // next (injected) import's braces.
      result.push(commentPlaceholderFor(factory, stmt));
      continue;
    }

    const newImportClause = factory.updateImportClause(
      importClause,
      importClause.isTypeOnly,
      keepDefault ? importClause.name : undefined,
      newNamedBindings
    );

    const newImport = factory.updateImportDeclaration(
      stmt,
      stmt.modifiers,
      newImportClause,
      stmt.moduleSpecifier,
      stmt.attributes
    );

    if (verbose) {
      const moduleSpec = ts.isStringLiteral(stmt.moduleSpecifier)
        ? stmt.moduleSpecifier.text
        : "<unknown>";
      console.log(`[typesugar] Trimmed macro specifiers from import: "${moduleSpec}"`);
    }

    result.push(newImport);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Module specifier resolution
// ---------------------------------------------------------------------------

/**
 * Map a file path back to a module specifier like "typesugar" or "@typesugar/units".
 */
export function resolveModuleSpecifier(fileName: string): string | undefined {
  const normalized = fileName.replace(/\\/g, "/");

  const nodeModulesMatch = normalized.match(/\/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (nodeModulesMatch) {
    const pkgName = nodeModulesMatch[1];
    if (pkgName.startsWith("@typesugar/")) {
      return pkgName;
    }
    if (pkgName === "typesugar") {
      return "typesugar";
    }
    return pkgName;
  }

  // Monorepo detection: assumes the standard `packages/<name>/` directory
  // layout. Used to map a file path back to a `@typesugar/<name>` specifier.
  const packagesMatch = normalized.match(/\/packages\/([a-z0-9-]+)\//);
  if (packagesMatch) {
    const pkgName = packagesMatch[1];
    if (pkgName === "typesugar") {
      return "typesugar";
    }
    return `@typesugar/${pkgName}`;
  }

  return undefined;
}

/**
 * Scan the source file's imports to find the module specifier for a name.
 */
export function findImportModuleForName(
  sourceFile: ts.SourceFile,
  name: string
): string | undefined {
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;

    const moduleSpecifier = stmt.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpecifier)) continue;

    const moduleName = moduleSpecifier.text;
    const importClause = stmt.importClause;
    if (!importClause) continue;

    if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
      for (const element of importClause.namedBindings.elements) {
        const localName = element.name.text;
        if (localName === name) {
          return moduleName;
        }
      }
    }
  }

  return undefined;
}

/**
 * Check if an imported module matches the macro's required module.
 */
export function moduleMatchesMacro(importedModule: string, macroModule: string): boolean {
  if (importedModule === macroModule) return true;

  const legacyAliases = ["typemacro", "ttfx", "macrots"];

  const aliases: Record<string, string[]> = {
    typesugar: legacyAliases,
    typemacro: ["typesugar", "ttfx", "macrots"],
  };

  const importAliases = aliases[importedModule];
  if (importAliases?.includes(macroModule)) return true;

  if (importedModule === "typesugar" && macroModule.startsWith("@typesugar/")) {
    return true;
  }

  if (macroModule === "typesugar" && importedModule.startsWith("@typesugar/")) {
    return true;
  }

  if (importedModule.startsWith("@typesugar/")) {
    const pkgName = importedModule.slice("@typesugar/".length);
    if (macroModule === pkgName || macroModule === `@typesugar/${pkgName}`) {
      return true;
    }
    if (legacyAliases.includes(macroModule)) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Name-based macro lookup
// ---------------------------------------------------------------------------

/**
 * Fall back to name-based lookup for macros without module requirement.
 */
export function fallbackNameLookup(
  name: string,
  kind: MacroDefinition["kind"]
): MacroDefinition | undefined {
  let macro: MacroDefinition | undefined;
  switch (kind) {
    case "expression":
      macro = globalRegistry.getExpression(name);
      break;
    case "attribute":
      macro = globalRegistry.getAttribute(name);
      break;
    case "derive":
      macro = globalRegistry.getDerive(name);
      break;
    case "tagged-template":
      macro = globalRegistry.getTaggedTemplate(name);
      break;
    case "type":
      macro = globalRegistry.getType(name);
      break;
    case "labeled-block":
      macro = globalRegistry.getLabeledBlock(name);
      break;
  }

  if (macro?.module) {
    return undefined;
  }

  return macro;
}

/**
 * Fall back to name-based lookup with import verification.
 */
export function fallbackNameLookupWithImports(
  sourceFile: ts.SourceFile,
  name: string,
  kind: MacroDefinition["kind"]
): MacroDefinition | undefined {
  let macro: MacroDefinition | undefined;
  switch (kind) {
    case "expression":
      macro = globalRegistry.getExpression(name);
      break;
    case "attribute":
      macro = globalRegistry.getAttribute(name);
      break;
    case "derive":
      macro = globalRegistry.getDerive(name);
      break;
    case "tagged-template":
      macro = globalRegistry.getTaggedTemplate(name);
      break;
    case "type":
      macro = globalRegistry.getType(name);
      break;
    case "labeled-block":
      macro = globalRegistry.getLabeledBlock(name);
      break;
  }

  if (!macro) return undefined;

  if (!macro.module) {
    return macro;
  }

  const importedModule = findImportModuleForName(sourceFile, name);
  if (!importedModule) {
    return undefined;
  }

  if (moduleMatchesMacro(importedModule, macro.module)) {
    return macro;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Symbol-to-macro resolution
// ---------------------------------------------------------------------------

let macroModulesCache: { size: number; modules: Set<string> } | undefined;

/**
 * Whether a module specifier (as returned by `resolveModuleSpecifier`) is a
 * macro-providing module: `typesugar`, any `@typesugar/*` package, or a
 * module some registered macro declares as its `module` (third-party macro
 * packages). An arbitrary `node_modules` package (rxjs, lodash, ...) is not,
 * so a declaration living there must not enable the name-based fallback
 * (deep-review core #2: `obs.pipe(...)` on an rxjs Observable was expanded as
 * the `pipe` macro whenever the file imported `pipe`). Memoised on registry
 * size, since macros are only ever added.
 */
export function isMacroModuleSpecifier(spec: string): boolean {
  if (spec === "typesugar" || spec.startsWith("@typesugar/")) return true;
  const all = globalRegistry.getAll();
  if (!macroModulesCache || macroModulesCache.size !== all.length) {
    const modules = new Set<string>();
    for (const m of all) if (m.module) modules.add(m.module);
    macroModulesCache = { size: all.length, modules };
  }
  return macroModulesCache.modules.has(spec);
}

/**
 * Core symbol resolution: follow aliases to find the original declaration,
 * then check if it comes from a known macro module.
 */
export function resolveSymbolToMacro(
  typeChecker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  symbol: ts.Symbol,
  macroName: string,
  kind: MacroDefinition["kind"]
): MacroDefinition | undefined {
  // Whether the REFERENCE ITSELF was brought into scope via an explicit
  // import (an alias symbol) -- computed before following the alias, since
  // that's the one signal that reliably means "the user wrote an import
  // statement for this name," regardless of which file(s) the aliased
  // target's own declarations happen to live in (a plain relative-path
  // import from an in-repo module is exactly as import-worthy as one from
  // a recognized @typesugar/* package).
  const wasImported = (symbol.flags & ts.SymbolFlags.Alias) !== 0;

  let resolved = symbol;
  if (resolved.flags & ts.SymbolFlags.Alias) {
    try {
      resolved = typeChecker.getAliasedSymbol(resolved);
    } catch {
      // TypeChecker.getAliasedSymbol can throw for unresolvable import aliases
    }
  }

  const declarations = resolved.getDeclarations();
  if (!declarations || declarations.length === 0) {
    return fallbackNameLookupWithImports(sourceFile, macroName, kind);
  }

  // Track whether we found any declaration resolving to a recognized
  // @typesugar/* package path.
  let foundModuleDecl = false;

  for (const decl of declarations) {
    const declSourceFile = decl.getSourceFile();
    const fileName = declSourceFile.fileName;

    const moduleSpecifier = resolveModuleSpecifier(fileName);
    if (moduleSpecifier) {
      if (isMacroModuleSpecifier(moduleSpecifier)) {
        foundModuleDecl = true;
      }
      const exportName = resolved.name;
      const macro = globalRegistry.getByModuleExport(moduleSpecifier, exportName);
      if (macro && macro.kind === kind) {
        return macro;
      }
      if (exportName !== macroName) {
        const macroByName = globalRegistry.getByModuleExport(moduleSpecifier, macroName);
        if (macroByName && macroByName.kind === kind) {
          return macroByName;
        }
      }
    }
  }

  // Fall back to name-based lookup only when either (a) some declaration
  // resolves to a recognized package path, or (b) the reference itself was
  // an explicit import -- even one from a plain relative-path module that
  // isn't a recognized @typesugar/* package (e.g. a project's own in-repo
  // macro helper file). A symbol that is NEITHER aliased NOR from a
  // recognized module is a true local/ambient/merged declaration that
  // happens to share a name with a macro - do NOT fall back to import
  // lookup. This prevents `Show.summon(...)` from matching the global
  // `summon` macro when `Show` is a local companion object, and also
  // covers declarations merged/split across multiple files with no import
  // connecting them to the reference site at all.
  if (!foundModuleDecl && !wasImported) {
    return undefined;
  }

  const byLocalName = fallbackNameLookupWithImports(sourceFile, macroName, kind);
  if (byLocalName) return byLocalName;

  const originalName = resolved.name;
  if (originalName !== macroName) {
    const byOriginalName = fallbackNameLookupWithImports(sourceFile, originalName, kind);
    if (byOriginalName) return byOriginalName;
  }

  return undefined;
}

/**
 * Resolve an identifier to a macro definition via import tracking.
 */
const boundInProgram = new WeakMap<ts.SourceFile, boolean>();

/**
 * Is `node` part of a SourceFile the program's checker has bound (the
 * program's own copy)? A detached `ts.createSourceFile` copy with the same
 * name is not, and the checker must not be called on its nodes.
 */
export function isNodeInProgram(program: ts.Program, node: ts.Node): boolean {
  const sf = node.getSourceFile();
  if (!sf) return false;
  let bound = boundInProgram.get(sf);
  if (bound === undefined) {
    bound = program.getSourceFile(sf.fileName) === sf;
    boundInProgram.set(sf, bound);
  }
  return bound;
}

const symbolCacheIds = new WeakMap<ts.Symbol, number>();
let nextSymbolCacheId = 1;

/** A stable, unique-per-symbol-object id for cache keys. */
function symbolCacheId(symbol: ts.Symbol): number {
  let id = symbolCacheIds.get(symbol);
  if (id === undefined) {
    id = nextSymbolCacheId++;
    symbolCacheIds.set(symbol, id);
  }
  return id;
}

export function resolveMacroFromSymbol(
  typeChecker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  symbolMacroCache: Map<string, MacroDefinition | null>,
  node: ts.Node,
  macroName: string,
  kind: MacroDefinition["kind"],
  onMacroImport?: (symbol: ts.Symbol) => void,
  program?: ts.Program
): MacroDefinition | undefined {
  // A macro-generated node is outside the checker's contract (CLAUDE.md):
  // resolve it by name + the file's imports without asking the checker.
  // So is a node of a SourceFile that is not the program's own (bound) copy
  // -- e.g. the detached copy packages/transformer's pipeline makes when the
  // preprocessed text differs: the checker throws on it ("reading 'members'").
  if (isSyntheticNode(node) || (program && !isNodeInProgram(program, node))) {
    return fallbackNameLookupWithImports(sourceFile, macroName, kind);
  }
  let symbol: ts.Symbol | undefined;
  try {
    symbol = typeChecker.getSymbolAtLocation(node);
  } catch (e) {
    // Degrade to name-based lookup, but leave a visible trace.
    console.warn(
      `[typesugar] symbol lookup for '${macroName}' in ${sourceFile.fileName} failed ` +
        `(${e instanceof Error ? e.message : String(e)}); resolving by name and imports instead`
    );
    return fallbackNameLookupWithImports(sourceFile, macroName, kind);
  }
  if (!symbol) {
    return fallbackNameLookupWithImports(sourceFile, macroName, kind);
  }

  // Key by symbol AND kind: callers probe the same symbol under several kinds
  // (a tagged template is tried as "tagged-template", then as "expression"), and a
  // miss cached for one kind must not hide a hit for another.
  //
  // Also key by macroName and by OUR OWN per-symbol id: the checker's internal
  // `symbol.id` is 0 until something asks for it, and every unresolved name
  // shares the checker's single `unknownSymbol` — so `Nullable<string>` and
  // `Readonly<{a:1}>` used to share one cache slot, and the second was
  // expanded by the first's macro (docs review W#23).
  const cacheKey = `${symbolCacheId(symbol)}:${kind}:${macroName}`;
  if (symbolMacroCache.has(cacheKey)) {
    return symbolMacroCache.get(cacheKey) ?? undefined;
  }

  const result = resolveSymbolToMacro(typeChecker, sourceFile, symbol, macroName, kind);

  symbolMacroCache.set(cacheKey, result ?? null);

  if (result && onMacroImport) {
    onMacroImport(symbol);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Extension-related helpers
// ---------------------------------------------------------------------------

/**
 * Check if a declaration has the @extension decorator.
 */
export function hasExtensionDecorator(node: ts.Node): boolean {
  if (!ts.canHaveDecorators(node)) return false;

  const decorators = ts.getDecorators(node);
  if (!decorators) return false;

  for (const decorator of decorators) {
    const expr = decorator.expression;
    if (ts.isIdentifier(expr) && expr.text === "extension") {
      return true;
    }
    if (
      ts.isCallExpression(expr) &&
      ts.isIdentifier(expr.expression) &&
      expr.expression.text === "extension"
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a symbol is extension-enabled.
 */
export function isExtensionEnabled(ctx: MacroContextImpl, symbol: ts.Symbol): boolean {
  const declarations = symbol.getDeclarations();
  if (!declarations || declarations.length === 0) {
    return false;
  }

  for (const decl of declarations) {
    const sourceFile = decl.getSourceFile();
    const fileName = sourceFile.fileName;

    if (sourceFile.isDeclarationFile) {
      if (hasExtensionDecorator(decl)) {
        return true;
      }
      continue;
    }

    if (fileName !== ctx.sourceFile.fileName) {
      scanImportsForScope(sourceFile, globalResolutionScope, ctx.program);
    }

    if (globalResolutionScope.hasUseExtension(fileName)) {
      return true;
    }

    if (hasExtensionDecorator(decl)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if an imported identifier provides an extension method.
 */
export function checkImportedSymbolForExtension(
  typeChecker: ts.TypeChecker,
  ident: ts.Identifier,
  methodName: string,
  receiverType: ts.Type
): StandaloneExtensionInfo | undefined {
  const symbol = typeChecker.getSymbolAtLocation(ident);
  if (!symbol) return undefined;

  const identType = typeChecker.getTypeOfSymbolAtLocation(symbol, ident);

  if (ident.text === methodName) {
    for (const sig of identType.getCallSignatures()) {
      if (receiverMatchesFirstParam(typeChecker, receiverType, sig, ident)) {
        return { methodName, forType: "", qualifier: undefined };
      }
    }
  }

  const prop = identType.getProperty(methodName);
  if (!prop) return undefined;
  // A member every value has from the standard library (`Function.prototype.
  // bind/call/apply`, `Object.prototype.toString`, ...) is not an extension
  // provided by the import: `describe.bind` / `head.bind` must never become
  // candidates for `fn.bind(x)`.
  if (isDefaultLibMember(prop)) return undefined;

  const propType = typeChecker.getTypeOfSymbolAtLocation(prop, ident);
  for (const sig of propType.getCallSignatures()) {
    if (receiverMatchesFirstParam(typeChecker, receiverType, sig, ident)) {
      return { methodName, forType: "", qualifier: ident.text };
    }
  }

  return undefined;
}

/**
 * Can `receiverType` be passed as the first argument of `sig`?
 *
 * A generic signature's parameter types still mention its own type
 * parameters (`head<A>(arr: readonly A[])` has `readonly A[]`), and the
 * public checker API offers no way to infer/instantiate them, so a plain
 * `isTypeAssignableTo(number[], readonly A[])` is always false — which is why
 * every generic extension (`arr.head()`, `arr.chunk(2)`) was silently left
 * un-rewritten. For a generic signature, fall back to matching against the
 * parameter type with its type parameters erased to their constraints.
 */
export function receiverMatchesFirstParam(
  checker: ts.TypeChecker,
  receiverType: ts.Type,
  sig: ts.Signature,
  location: ts.Node
): boolean {
  const params = sig.getParameters();
  if (params.length === 0) return false;
  // A rest first parameter (`join(...paths: string[])`) is not a receiver
  // slot: its array type would swallow an array receiver, turning
  // `xs.join("/")` into node:path's `join(xs, "/")`.
  const decl = params[0].valueDeclaration;
  if (decl && ts.isParameter(decl) && decl.dotDotDotToken) return false;
  const paramType = checker.getTypeOfSymbolAtLocation(params[0], location);
  if (checker.isTypeAssignableTo(receiverType, paramType)) return true;
  const typeParams = sig.getTypeParameters();
  if (!typeParams || typeParams.length === 0) return false;
  return matchesErased(checker, receiverType, paramType, new Set<ts.Type>(typeParams), 0);
}

function isReferenceType(type: ts.Type): type is ts.TypeReference {
  return (
    (type.flags & ts.TypeFlags.Object) !== 0 &&
    ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) !== 0
  );
}

/** Structural match of `recv` against `param`, treating `typeParams` as wildcards bounded by their constraints. */
function matchesErased(
  checker: ts.TypeChecker,
  recv: ts.Type,
  param: ts.Type,
  typeParams: ReadonlySet<ts.Type>,
  depth: number
): boolean {
  if (depth > 8) return false;
  if (checker.isTypeAssignableTo(recv, param)) return true;
  const next = (r: ts.Type, p: ts.Type) => matchesErased(checker, r, p, typeParams, depth + 1);

  if (param.flags & ts.TypeFlags.TypeParameter) {
    if (!typeParams.has(param)) return false;
    const constraint = checker.getBaseConstraintOfType(param);
    if (!constraint || constraint.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any)) return true;
    // `{}` is the base constraint the checker reports for an unconstrained
    // parameter in some positions; it accepts every non-nullish receiver.
    return next(recv, constraint);
  }
  if (recv.isUnion()) return recv.types.every((t) => next(t, param));
  if (param.isUnion()) return param.types.some((t) => next(recv, t));
  if (param.isIntersection()) return param.types.every((t) => next(recv, t));

  if (checker.isArrayType(param)) {
    const recvIsArray = checker.isArrayType(recv);
    const recvIsTuple = checker.isTupleType(recv);
    if (!recvIsArray && !recvIsTuple) return false;
    const paramReadonly = param.getSymbol()?.getName() === "ReadonlyArray";
    const recvReadonly = recvIsTuple
      ? ((recv as ts.TypeReference).target as ts.TupleType).readonly
      : recv.getSymbol()?.getName() === "ReadonlyArray";
    if (recvReadonly && !paramReadonly) return false;
    const [paramElem] = checker.getTypeArguments(param as ts.TypeReference);
    const recvElem = checker.getIndexTypeOfType(recv, ts.IndexKind.Number);
    if (!paramElem || !recvElem) return true;
    return next(recvElem, paramElem);
  }

  // Same generic interface/class (`Box<A>` vs `Box<number>`): match type arguments pairwise.
  if (isReferenceType(param) && isReferenceType(recv) && param.target === recv.target) {
    const pArgs = checker.getTypeArguments(param);
    const rArgs = checker.getTypeArguments(recv);
    if (pArgs.length !== rArgs.length) return false;
    return pArgs.every((p, i) => next(rArgs[i], p));
  }

  return false;
}

/** The declaration symbol an extension match calls (aliases resolved), for de-duplication. */
function extensionTarget(
  checker: ts.TypeChecker,
  ident: ts.Identifier,
  ext: StandaloneExtensionInfo
): ts.Symbol | undefined {
  const resolve = (s: ts.Symbol | undefined) =>
    s && s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;
  const sym = checker.getSymbolAtLocation(ident);
  if (!sym) return undefined;
  if (ext.qualifier === undefined) return resolve(sym);
  return resolve(checker.getTypeOfSymbolAtLocation(sym, ident).getProperty(ext.methodName));
}

/** Is every declaration of `prop` in a default lib file (`lib.*.d.ts`)? */
function isDefaultLibMember(prop: ts.Symbol): boolean {
  const decls = prop.getDeclarations();
  if (!decls || decls.length === 0) return false;
  return decls.every((d) => d.getSourceFile().hasNoDefaultLib);
}

/**
 * Is every declaration of `prop` inside a `declare global { ... }` block?
 *
 * Libraries like @typesugar/std declare their extension methods on the
 * built-in interfaces (`interface Number { clamp(...) }`) purely so
 * `(42).clamp(0, 100)` type-checks; those stubs never exist at runtime, so
 * they must not count as the receiver's "own" method.
 */
export function isGlobalAugmentationStub(prop: ts.Symbol): boolean {
  const decls = prop.getDeclarations();
  if (!decls || decls.length === 0) return false;
  return decls.every((d) => {
    for (let n: ts.Node | undefined = d.parent; n; n = n.parent) {
      if (ts.isModuleDeclaration(n) && (n.flags & ts.NodeFlags.GlobalAugmentation) !== 0)
        return true;
    }
    return false;
  });
}

/**
 * Scan imports for a matching extension method.
 * Collects all matching extensions for ambiguity detection.
 */
export function scanImportsForExtension(
  ctx: MacroContextImpl,
  sourceFile: ts.SourceFile,
  methodName: string,
  receiverType: ts.Type,
  node?: ts.Node
): StandaloneExtensionInfo | undefined {
  if (!sourceFile || !sourceFile.statements) {
    return undefined;
  }

  const matches: Array<{
    ext: StandaloneExtensionInfo;
    importSource: string;
    target: ts.Symbol | undefined;
  }> = [];

  // A receiver's OWN method (e.g. Array.prototype.map) must never be
  // redirected to a same-named member of some imported object: an imported
  // typeclass instance like `parCombinePromise` has a `map(fa, f)` whose first
  // parameter accepts an array, and `arr.map(f)` was being rewritten to
  // `parCombinePromise.map(arr, f)`. Only a bare imported function named
  // after the method (the explicit-override form) may shadow a native method.
  // A `declare global` extension stub (std's `interface Number { clamp }`)
  // is not a native method: it exists only so the call type-checks.
  // The check uses the receiver with `null | undefined` removed: for
  // `host.directoryExists?.bind(host)` the receiver is `F | undefined`, and a
  // union only has the properties of ALL its members, so `bind` was "not
  // native" and the call was offered to every import's `.bind`.
  let hasNativeMethod = false;
  try {
    const own = ctx.typeChecker.getPropertyOfType(
      ctx.typeChecker.getApparentType(ctx.typeChecker.getNonNullableType(receiverType)),
      methodName
    );
    hasNativeMethod = own !== undefined && !isGlobalAugmentationStub(own);
  } catch {
    const own = receiverType.getProperty(methodName);
    hasNativeMethod = own !== undefined && !isGlobalAugmentationStub(own);
  }
  const push = (
    ext: StandaloneExtensionInfo | undefined,
    importSource: string,
    ident: ts.Identifier
  ) => {
    if (!ext) return;
    if (hasNativeMethod && ext.qualifier !== undefined) return;
    matches.push({ ext, importSource, target: extensionTarget(ctx.typeChecker, ident, ext) });
  };

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;

    const clause = stmt.importClause;
    if (!clause) continue;

    const moduleSpecifier = stmt.moduleSpecifier;
    const importSource = ts.isStringLiteral(moduleSpecifier) ? moduleSpecifier.text : "unknown";

    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const spec of clause.namedBindings.elements) {
        const result = checkImportedSymbolForExtension(
          ctx.typeChecker,
          spec.name,
          methodName,
          receiverType
        );
        push(result, importSource, spec.name);
      }
    }

    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      const result = checkImportedSymbolForExtension(
        ctx.typeChecker,
        clause.namedBindings.name,
        methodName,
        receiverType
      );
      push(result, importSource, clause.namedBindings.name);
    }

    if (clause.name) {
      const result = checkImportedSymbolForExtension(
        ctx.typeChecker,
        clause.name,
        methodName,
        receiverType
      );
      push(result, importSource, clause.name);
    }
  }

  if (matches.length === 0) {
    return undefined;
  }

  if (matches.length === 1) {
    return matches[0].ext;
  }

  const uniqueQualifiers = new Set(matches.map((m) => m.ext.qualifier ?? ""));
  if (uniqueQualifiers.size === 1) {
    return matches[0].ext;
  }

  // The same export reached two ways (`import { head }` and `import * as std`
  // from one module) is one extension, not an ambiguity: prefer the bare name.
  const first = matches[0].target;
  if (first && matches.every((m) => m.target === first)) {
    return (matches.find((m) => m.ext.qualifier === undefined) ?? matches[0]).ext;
  }

  const typeName = ctx.typeChecker.typeToString(receiverType);
  const sources = matches
    .map((m) => {
      const qual = m.ext.qualifier ? `${m.ext.qualifier}.${methodName}` : methodName;
      return `  - ${qual} (from "${m.importSource}")`;
    })
    .join("\n");

  const errorMessage =
    `Ambiguous extension method '${methodName}' for type '${typeName}'. ` +
    `Multiple extensions match:\n${sources}\n` +
    `Use an explicit qualifier or rename one of the imports to disambiguate.`;

  if (node) {
    ctx.reportError(node, errorMessage);
  }

  return matches[0].ext;
}
