/**
 * Extension method rewriting, operator overloading, HKT transformation,
 * and tagged template / type macro handling.
 *
 * Each function takes explicit parameters instead of relying on class state,
 * so the MacroTransformer methods become thin delegation wrappers.
 */

import * as ts from "typescript";

import {
  getOperatorString,
  isKindAnnotation,
  transformHKTDeclaration,
  getOperatorCandidates,
  resolveInstance,
  type ResolvedInstance,
} from "@typesugar/macros";

import {
  MacroContextImpl,
  globalRegistry,
  type MacroDefinition,
  findStandaloneExtensions,
  getAllStandaloneExtensions,
  buildStandaloneExtensionCall,
  type StandaloneExtensionInfo,
  ExpressionMacro,
  TaggedTemplateMacroDef,
  TypeMacro,
  globalResolutionScope,
  isInOptedOutScope,
  isSyntheticNode,
  preserveSourceMap,
  getAllTypeRewrites,
  typeRewriteEntryCoversFile,
  type TypeRewriteEntry,
  type ConstructorRewrite,
  type MethodInlinePattern,
  extractTypeArgumentsContent,
  stripTypeArguments,
  cloneWithoutComments,
} from "@typesugar/core";

import { createMacroErrorExpression, type VisitFn } from "./transformer-utils.js";

// ---------------------------------------------------------------------------
// Callback types for cross-cutting concerns
// ---------------------------------------------------------------------------

export type ResolveMacroFn = (
  node: ts.Node,
  macroName: string,
  kind: MacroDefinition["kind"]
) => MacroDefinition | undefined;

export type ResolveExtensionFn = (
  node: ts.CallExpression,
  methodName: string,
  receiverType: ts.Type
) => StandaloneExtensionInfo | undefined;

// ---------------------------------------------------------------------------
// Tagged template expansion
// ---------------------------------------------------------------------------

export function tryExpandTaggedTemplate(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  resolveMacroFromSymbol: ResolveMacroFn,
  node: ts.TaggedTemplateExpression
): ts.Expression | undefined {
  if (isInOptedOutScope(ctx.sourceFile, node, globalResolutionScope, "macros")) {
    return undefined;
  }

  if (!ts.isIdentifier(node.tag)) return undefined;

  const tagName = node.tag.text;

  const taggedMacro = resolveMacroFromSymbol(node.tag, tagName, "tagged-template") as
    | TaggedTemplateMacroDef
    | undefined;
  if (taggedMacro) {
    if (verbose) {
      console.log(`[typesugar] Expanding tagged template macro: ${tagName}`);
    }

    try {
      if (taggedMacro.validate && !taggedMacro.validate(ctx, node)) {
        ctx.reportError(node, `Tagged template validation failed for '${tagName}'`);
        return createMacroErrorExpression(
          ctx.factory,
          `typesugar: tagged template '${tagName}' validation failed`
        );
      }

      const result = ctx.hygiene.withScope(() => taggedMacro.expand(ctx, node));
      if (result === (node as ts.Node)) {
        return ts.visitEachChild(node, visit, ctx.transformContext) as ts.Expression;
      }
      const visited = ts.visitNode(result, visit) as ts.Expression;
      return preserveSourceMap(visited, node);
    } catch (error) {
      ctx.reportError(node, `Tagged template macro expansion failed: ${error}`);
      return createMacroErrorExpression(
        ctx.factory,
        `typesugar: tagged template '${tagName}' expansion failed: ${error}`
      );
    }
  }

  const exprMacro = resolveMacroFromSymbol(node.tag, tagName, "expression") as
    | ExpressionMacro
    | undefined;
  if (!exprMacro) return undefined;

  if (verbose) {
    console.log(`[typesugar] Expanding tagged template via expression macro: ${tagName}`);
  }

  try {
    const result = ctx.hygiene.withScope(() =>
      exprMacro.expand(ctx, node as unknown as ts.CallExpression, [
        node.template as unknown as ts.Expression,
      ])
    );
    if (result === (node as unknown as ts.Expression)) {
      return ts.visitEachChild(node, visit, ctx.transformContext) as ts.Expression;
    }
    const visited = ts.visitNode(result, visit) as ts.Expression;
    return preserveSourceMap(visited, node);
  } catch (error) {
    ctx.reportError(node, `Tagged template macro expansion failed: ${error}`);
    return createMacroErrorExpression(
      ctx.factory,
      `typesugar: tagged template '${tagName}' expansion failed: ${error}`
    );
  }
}

// ---------------------------------------------------------------------------
// Type macro expansion
// ---------------------------------------------------------------------------

export function tryExpandTypeMacro(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  resolveMacroFromSymbol: ResolveMacroFn,
  node: ts.TypeReferenceNode
): ts.TypeNode | undefined {
  if (isInOptedOutScope(ctx.sourceFile, node, globalResolutionScope, "macros")) {
    return undefined;
  }

  let macroName: string | undefined;
  let identNode: ts.Node | undefined;

  if (ts.isIdentifier(node.typeName)) {
    macroName = node.typeName.text;
    identNode = node.typeName;
  } else if (ts.isQualifiedName(node.typeName)) {
    if (
      ts.isIdentifier(node.typeName.left) &&
      (node.typeName.left.text === "typesugar" || node.typeName.left.text === "typemacro")
    ) {
      macroName = node.typeName.right.text;
      identNode = node.typeName;
    }
  }

  if (!macroName || !identNode) return undefined;

  const macro = resolveMacroFromSymbol(identNode, macroName, "type") as TypeMacro | undefined;
  if (!macro) return undefined;

  if (verbose) {
    console.log(`[typesugar] Expanding type macro: ${macroName}`);
  }

  try {
    const typeArgs = node.typeArguments ? Array.from(node.typeArguments) : [];
    const result = ctx.hygiene.withScope(() => macro.expand(ctx, node, typeArgs));
    if (result === (node as ts.Node)) {
      return ts.visitEachChild(node, visit, ctx.transformContext) as ts.TypeNode;
    }
    const visited = ts.visitNode(result, visit) as ts.TypeNode;
    return preserveSourceMap(visited, node);
  } catch (error) {
    ctx.reportError(node, `Type macro expansion failed: ${error}`);
    return ts.visitEachChild(node, visit, ctx.transformContext) as ts.TypeNode;
  }
}

// ---------------------------------------------------------------------------
// Extension method rewriting
// ---------------------------------------------------------------------------

/**
 * Shared guards for both the type-rewrite-registry path
 * (`tryRewriteOpaqueMethodCall`, checked first) and the standalone-extension
 * path (`tryRewriteExtensionMethod`, checked second): an opted-out file or a
 * macro-producing receiver call must skip both. Legacy's `tryRewriteExtensionMethod`
 * checked these once, internally, before trying its type-rewrite-registry
 * sub-step then its extension fallback in the SAME function body; the split
 * into two top-level dispatch functions here means each must run this guard
 * on its own turn, but factoring it out keeps a change to either guard from
 * silently applying to only one of the two paths.
 */
function checkMethodCallDispatchGuards(
  ctx: MacroContextImpl,
  resolveMacroFromSymbol: ResolveMacroFn,
  node: ts.CallExpression
):
  | { propAccess: ts.PropertyAccessExpression; methodName: string; receiver: ts.Expression }
  | undefined {
  if (isInOptedOutScope(ctx.sourceFile, node, globalResolutionScope, "extensions")) {
    return undefined;
  }

  const propAccess = node.expression as ts.PropertyAccessExpression;
  const methodName = propAccess.name.text;
  const receiver = propAccess.expression;

  if (ts.isCallExpression(receiver) && ts.isIdentifier(receiver.expression)) {
    const calleeName = receiver.expression.text;
    const calleeMacro = resolveMacroFromSymbol(receiver.expression, calleeName, "expression");
    if (calleeMacro) {
      return undefined;
    }
  }

  return { propAccess, methodName, receiver };
}

export function tryRewriteExtensionMethod(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  resolveMacroFromSymbol: ResolveMacroFn,
  resolveExtensionFromImports: ResolveExtensionFn,
  node: ts.CallExpression
): ts.Expression | undefined {
  const guarded = checkMethodCallDispatchGuards(ctx, resolveMacroFromSymbol, node);
  if (!guarded) return undefined;
  const { methodName, receiver } = guarded;

  const receiverType = ctx.typeChecker.getTypeAtLocation(receiver);

  if (!ctx.isTypeReliable(receiverType)) {
    const couldBeExtension = getAllStandaloneExtensions().some((e) => e.methodName === methodName);
    if (couldBeExtension) {
      ctx.reportWarning(
        node,
        `typesugar skipped extension method '${methodName}' rewrite because the receiver type could not be resolved. Fix upstream type errors first.`
      );
    }
    return undefined;
  }

  const existingProp = receiverType.getProperty(methodName);

  let forceRewrite = false;
  if (existingProp) {
    const potentialExt = resolveExtensionFromImports(node, methodName, receiverType);
    if (potentialExt) {
      const receiverText = ts.isIdentifier(receiver) ? receiver.text : null;
      const isSameObject = receiverText && potentialExt.qualifier === receiverText;
      if (!isSameObject) {
        forceRewrite = true;
      }
    }
  }

  if (existingProp && !forceRewrite) {
    return undefined;
  }

  const typeName = ctx.typeChecker.typeToString(receiverType);

  // Normalize literal types to their base type for extension lookup --
  // otherwise a receiver the checker types as a literal (e.g. `(5).clamp(...)`)
  // would never match a "number" extension, since `typeToString` on it returns
  // the literal text ("5"), not "number". `getBaseTypeOfLiteralType` is a
  // no-op for non-literal types, so this is safe to call unconditionally --
  // the same idiom already used for this exact purpose in
  // `@typesugar/macros`'s sfinae-rules.ts/implicits.ts.
  const normalizedType = ctx.typeChecker.typeToString(
    ctx.typeChecker.getBaseTypeOfLiteralType(receiverType)
  );

  // Registry shape (CLAUDE.md): `standaloneExtensionRegistry` is a live keyed
  // registry, keyed by declaring file, so a same-file `@extension` registered
  // earlier in THIS pass is visible here and is preferred over other files'.
  // It is still process-wide, though: an entry may come from another file, an
  // earlier program (watch mode, LSP) or a compiled dist's self-registration.
  // The rewrite emits a bare `method(recv, ...)` / `Qualifier.method(recv, ...)`
  // and injects no import, so each candidate is only usable when its callee is
  // actually bound, and callable, at this call site. Otherwise fall through to
  // the import-scoped resolver below.
  const fromFile = ctx.sourceFile.fileName;
  const typeNames = [normalizedType, typeName, stripTypeArguments(typeName)].filter(
    (t, i, all) => all.indexOf(t) === i
  );
  let standaloneExt: StandaloneExtensionInfo | undefined;
  for (const t of typeNames) {
    standaloneExt = findStandaloneExtensions(methodName, t, fromFile).find((ext) =>
      isExtensionCalleeBound(ctx, node, ext)
    );
    if (standaloneExt) break;
  }

  if (!standaloneExt) {
    standaloneExt = resolveExtensionFromImports(node, methodName, receiverType);
    if (standaloneExt) {
      const receiverText = ts.isIdentifier(receiver) ? receiver.text : null;
      if (receiverText && standaloneExt.qualifier === receiverText) {
        standaloneExt = undefined;
      }
    }
  }

  if (!standaloneExt) {
    return undefined;
  }

  if (verbose) {
    const qual = standaloneExt.qualifier
      ? `${standaloneExt.qualifier}.${standaloneExt.methodName}`
      : standaloneExt.methodName;
    console.log(
      `[typesugar] Rewriting standalone extension: ${typeName}.${methodName}() → ${qual}(...)`
    );
  }

  const rewritten = buildStandaloneExtensionCall(
    ctx.factory,
    standaloneExt,
    receiver,
    Array.from(node.arguments)
  );

  try {
    const visited = ts.visitNode(rewritten, visit) as ts.Expression;
    return preserveSourceMap(visited, node);
  } catch (error) {
    ctx.reportError(node, `Extension method rewrite failed: ${error}`);
    return undefined;
  }
}

/**
 * Is the callee a standalone-extension rewrite would emit bound at `node`, to
 * something callable? Bare form: `methodName` must resolve to a value with a
 * call signature; qualified form: `qualifier` must resolve to a value with a
 * `methodName` property.
 */
function isExtensionCalleeBound(
  ctx: MacroContextImpl,
  node: ts.CallExpression,
  ext: StandaloneExtensionInfo
): boolean {
  const rootName = ext.qualifier ?? ext.methodName;
  const checker = ctx.typeChecker;
  try {
    // A synthesized call has no scope of its own; fall back to the file's
    // top-level scope (CLAUDE.md: don't hand a synthetic node to the checker).
    const location: ts.Node = isProgramNode(node) ? node : ctx.sourceFile;
    const sym = checker
      .getSymbolsInScope(location, ts.SymbolFlags.Value)
      .find((s) => s.getName() === rootName);
    if (!sym) return false;
    const type = checker.getTypeOfSymbolAtLocation(skipAlias(checker, sym), location);
    if (ext.qualifier) {
      return type.getProperty(ext.methodName) !== undefined || ctx.isTypeReliable(type) === false;
    }
    return type.getCallSignatures().length > 0 || ctx.isTypeReliable(type) === false;
  } catch (error) {
    ctx.reportWarning(
      node,
      `typesugar skipped extension method '${ext.methodName}' rewrite: could not check that '${rootName}' is in scope (${error}).`
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// HKT transformation
// ---------------------------------------------------------------------------

export function tryTransformHKTDeclaration(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  node: ts.InterfaceDeclaration | ts.TypeAliasDeclaration
): ts.InterfaceDeclaration | ts.TypeAliasDeclaration | undefined {
  const typeParams = node.typeParameters;
  if (!typeParams) return undefined;

  let hasKA = false;
  for (const param of typeParams) {
    if (isKindAnnotation(param)) {
      hasKA = true;
      break;
    }
  }

  if (!hasKA) return undefined;

  if (verbose) {
    const name = node.name?.text ?? "Anonymous";
    console.log(`[typesugar] Transforming HKT declaration: ${name}`);
  }

  try {
    const transformed = transformHKTDeclaration(ctx, node);
    const visited = ts.visitEachChild(transformed, visit, ctx.transformContext) as
      | ts.InterfaceDeclaration
      | ts.TypeAliasDeclaration;
    return preserveSourceMap(visited, node);
  } catch (error) {
    ctx.reportError(node, `HKT transformation failed: ${error}`);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Operator rewriting entry point (PEP-052: import-scoped, registry-free)
// ---------------------------------------------------------------------------

function isNullOrUndefinedExpr(node: ts.Expression): boolean {
  if (node.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isIdentifier(node) && node.text === "undefined") return true;
  if (ts.isVoidExpression(node)) return true;
  return false;
}

const OPERATOR_PRIMITIVE_TYPES = new Set([
  "number",
  "string",
  "boolean",
  "bigint",
  "null",
  "undefined",
  "any",
  "unknown",
]);

export function tryRewriteTypeclassOperator(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  node: ts.BinaryExpression
): ts.Expression | undefined {
  // Skip synthetic nodes (from macro-generated code) — the checker can crash.
  if (isSyntheticNode(node)) return undefined;
  if (isInOptedOutScope(ctx.sourceFile, node, globalResolutionScope, "extensions")) {
    return undefined;
  }

  const opString = getOperatorString(node.operatorToken.kind);
  if (!opString) return undefined;

  // PEP-052 activation gate: rewrite only if the file activated a typeclass that
  // maps this operator (imported `@syntax-operators` marker or in-file `@typeclass`).
  const sfn = ctx.sourceFile.fileName;
  const activatedOps = globalResolutionScope.getActivatedOperatorSyntax(sfn);
  const definedTcs = globalResolutionScope.getDefinedTypeclasses(sfn);
  const activatedForOps =
    definedTcs.size === 0 ? activatedOps : new Set([...activatedOps, ...definedTcs]);
  if (activatedForOps.size === 0) return undefined;

  const candidates = getOperatorCandidates(ctx.program, activatedForOps, opString);
  if (candidates.length === 0) return undefined;

  if (isNullOrUndefinedExpr(node.right) || isNullOrUndefinedExpr(node.left)) return undefined;

  let leftType: ts.Type;
  let rightType: ts.Type;
  let typeName: string;
  if (isSyntheticNode(node.left) || isSyntheticNode(node.right)) return undefined;
  try {
    leftType = ctx.typeChecker.getTypeAtLocation(node.left);
    rightType = ctx.typeChecker.getTypeAtLocation(node.right);
    typeName = ctx.typeChecker.typeToString(leftType);
  } catch (error) {
    ctx.reportWarning(
      node,
      `typesugar skipped typeclass operator rewrite of '${opString}': ` +
        `the operand types could not be resolved (${error}).`
    );
    return undefined;
  }

  if (
    (rightType.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) !== 0 ||
    (leftType.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) !== 0
  ) {
    return undefined;
  }

  if (OPERATOR_PRIMITIVE_TYPES.has(stripTypeArguments(typeName))) return undefined;

  // Resolve an instance for the operand type from scope (no global registry).
  let matched: { typeclass: string; method: string; resolved: ResolvedInstance } | undefined;
  for (const candidate of candidates) {
    const result = resolveInstance(ctx, candidate.typeclass, leftType);
    if (!result) continue;
    if (result.kind === "ambiguous") {
      ctx.reportError(
        node,
        `Ambiguous ${candidate.typeclass} instance for type '${typeName}': ` +
          `${result.candidates.map((c) => c.exportName).join(", ")}. ` +
          `Import exactly one instance to disambiguate.`
      );
      return undefined;
    }
    if (matched) {
      ctx.reportError(
        node,
        `Ambiguous operator '${opString}' for type '${typeName}': both ` +
          `${matched.typeclass}.${matched.method} and ` +
          `${candidate.typeclass}.${candidate.method} apply. ` +
          `Use explicit method calls to disambiguate.`
      );
      return undefined;
    }
    matched = { typeclass: candidate.typeclass, method: candidate.method, resolved: result };
  }

  if (!matched) return undefined;

  if (verbose) {
    console.log(
      `[typesugar] Rewriting operator: ${typeName} ${opString} → ` +
        `${matched.typeclass}.${matched.method}()`
    );
  }

  const factory = ctx.factory;
  const left = ts.visitNode(node.left, visit) as ts.Expression;
  const right = ts.visitNode(node.right, visit) as ts.Expression;

  // Emit instanceRef.method(left, right). The export name may be a companion path
  // (e.g. "Point.Eq"). If the instance was resolved via a cross-module scan
  // (not local scope), ensure its base name is actually imported -- otherwise
  // the emitted reference can be dangling. Uses the identifier ensureImport
  // returns (which may be a conflict-safe alias) rather than a fresh one.
  const instName = matched.resolved.exportName;
  let importedIdentifier: ts.Identifier | undefined;
  if (matched.resolved.importSpecifier && matched.resolved.source !== "local-scope") {
    const importName = instName.includes(".") ? instName.split(".")[0] : instName;
    importedIdentifier = ctx.ensureImport(importName, matched.resolved.importSpecifier);
  }
  const instanceRef = buildInstanceReferenceExpression(factory, instName, importedIdentifier);
  const methodAccess = factory.createPropertyAccessExpression(instanceRef, matched.method);
  const rewritten = factory.createCallExpression(methodAccess, undefined, [
    cloneWithoutComments(left),
    cloneWithoutComments(right),
  ]);
  return preserveSourceMap(rewritten, node);
}

/**
 * Build the reference expression for a resolved companion/instance export name --
 * a dotted companion path (`"Point.Eq"`) becomes a property access on its base
 * (`Point.Eq`); a bare name (`"eqPoint"`) becomes a plain identifier.
 *
 * `baseIdentifier`, if provided, is used for the base of a dotted path (or as
 * the whole reference for a bare name) instead of a fresh identifier -- callers
 * that already resolved a hygienic (possibly aliased) identifier via
 * `ctx.ensureImport`/`ctx.safeRef` should pass it here so the emitted reference
 * matches whatever was actually imported.
 */
export function buildInstanceReferenceExpression(
  factory: ts.NodeFactory,
  instName: string,
  baseIdentifier?: ts.Identifier
): ts.Expression {
  const dotIndex = instName.indexOf(".");
  if (dotIndex === -1) {
    return baseIdentifier ?? factory.createIdentifier(instName);
  }
  const base = baseIdentifier ?? factory.createIdentifier(instName.slice(0, dotIndex));
  return factory.createPropertyAccessExpression(base, instName.slice(dotIndex + 1));
}

// ---------------------------------------------------------------------------
// @opaque type rewrite — method, constructor, and accessor erasure (PEP-012)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Declaration identity for @opaque / @adt registry entries
// ---------------------------------------------------------------------------
//
// Registry shape (CLAUDE.md "Resolving things a macro just generated"): the
// type-rewrite registry is a LIVE KEYED REGISTRY read within the same pass --
// same-project `@opaque`/`@adt` entries are registered when the defining file
// is transformed, `.d.ts` entries by `discoverOpaqueTypesFromImports` before a
// consuming file's visitor pass. It is process-global, though, so an entry may
// have been registered by a DIFFERENT file (or program). That is why every
// lookup below first resolves the reference's symbol through the checker
// (following import aliases) and only accepts an entry whose declaring
// file/module is where that symbol is declared -- never a bare-name match. A
// same-named but unrelated `function Some`, `enum { None }`, `const None` or
// `class Option` therefore never matches, regardless of which files were
// transformed earlier in the process.

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Strip a TS/JS (including `.d.ts`) extension from a normalized path. */
function stripScriptExtension(p: string): string {
  return p.replace(/\.d\.[cm]?ts$/, "").replace(/\.[cm]?[jt]sx?$/, "");
}

// `typeRewriteEntryCoversFile` lives in @typesugar/core (type-rewrite-registry.ts)
// so the macros diagnostic-suppression rule uses the exact same membership test.
export { typeRewriteEntryCoversFile };

/** Does any declaration of `sym` live in a file belonging to `entry`? */
function symbolDeclaredByEntry(sym: ts.Symbol, entry: TypeRewriteEntry): boolean {
  for (const decl of sym.declarations ?? []) {
    if (typeRewriteEntryCoversFile(decl.getSourceFile().fileName, entry)) return true;
  }
  return false;
}

/** Is the file being transformed the entry's own defining module (transparent scope)? */
function isInDefiningModule(ctx: MacroContextImpl, entry: TypeRewriteEntry): boolean {
  const fileName = ctx.sourceFile.fileName;
  if (entry.declarationFile) {
    return (
      stripScriptExtension(normalizeSlashes(entry.declarationFile)) ===
      stripScriptExtension(normalizeSlashes(fileName))
    );
  }
  return !!entry.sourceModule && isWithinSourceModule(fileName, entry.sourceModule);
}

function skipAlias(checker: ts.TypeChecker, sym: ts.Symbol): ts.Symbol {
  if (sym.flags & ts.SymbolFlags.Alias) {
    const target = checker.getAliasedSymbol(sym);
    if (target) return target;
  }
  return sym;
}

/** A node that is part of the parsed program (safe to hand to the checker). */
function isProgramNode(node: ts.Node): boolean {
  return !isSyntheticNode(node) && node.parent !== undefined;
}

/**
 * Resolve the symbol an identifier refers to, through import aliases.
 *
 * Real (parsed) nodes go to the checker directly. A macro-synthesized node is
 * outside the checker's contract (CLAUDE.md), so it is resolved by name
 * against the current file's top-level scope instead (imports + top-level
 * declarations) -- what generated code referencing `Some`/`None` binds to.
 * A checker failure is surfaced as a warning and treated as "no match".
 */
function resolveReferencedSymbol(
  ctx: MacroContextImpl,
  node: ts.Identifier,
  meaning: ts.SymbolFlags
): ts.Symbol | undefined {
  const checker = ctx.typeChecker;
  try {
    let sym: ts.Symbol | undefined;
    if (isProgramNode(node)) {
      sym =
        ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
          ? checker.getShorthandAssignmentValueSymbol(node.parent)
          : checker.getSymbolAtLocation(node);
    } else {
      const original = ts.getOriginalNode(node);
      if (original !== node && ts.isIdentifier(original) && isProgramNode(original)) {
        sym = checker.getSymbolAtLocation(original);
      } else {
        sym = checker
          .getSymbolsInScope(ctx.sourceFile, meaning)
          .find((s) => s.getName() === node.text);
      }
    }
    return sym ? skipAlias(checker, sym) : undefined;
  } catch (error) {
    ctx.reportWarning(
      node,
      `typesugar skipped @opaque erasure of '${node.text}': its declaration could not be resolved (${error}).`
    );
    return undefined;
  }
}

/**
 * Find the registry entry describing `type` -- matched by the type's own
 * (alias) symbol AND its declaring file, not by `typeToString` text alone.
 * Two unrelated types that share a name (the user's `class Option` and
 * `@typesugar/fp`'s `Option`) resolve to different entries, or none.
 */
function resolveTypeRewriteEntry(
  type: ts.Type
): { entry: TypeRewriteEntry; typeName: string } | undefined {
  const all = getAllTypeRewrites();
  if (all.length === 0) return undefined;
  for (const sym of [type.aliasSymbol, type.getSymbol()]) {
    if (!sym) continue;
    const name = sym.getName();
    // Latest registration first, matching getTypeRewrite's precedence.
    for (let i = all.length - 1; i >= 0; i--) {
      const entry = all[i];
      if (entry.typeName === name && symbolDeclaredByEntry(sym, entry)) {
        return { entry, typeName: name };
      }
    }
  }
  return undefined;
}

/**
 * Find the entry + rewrite rule for a constructor/constant reference
 * (`Some` in `Some(x)`, `None`). Cheap name pre-filter first (no checker call
 * unless some entry has a constructor of that name), then resolve the
 * identifier's symbol and require it to be declared by that entry.
 */
function resolveConstructorRewrite(
  ctx: MacroContextImpl,
  ident: ts.Identifier
): { entry: TypeRewriteEntry; ctor: ConstructorRewrite } | undefined {
  const name = ident.text;
  const candidates = getAllTypeRewrites().filter((e) => e.constructors?.has(name));
  if (candidates.length === 0) return undefined;

  const sym = resolveReferencedSymbol(ctx, ident, ts.SymbolFlags.Value);
  // Renamed imports (`import { Other as Some }`) resolve to a different name.
  if (!sym || sym.getName() !== name) return undefined;

  for (let i = candidates.length - 1; i >= 0; i--) {
    const entry = candidates[i];
    if (symbolDeclaredByEntry(sym, entry)) {
      return { entry, ctor: entry.constructors!.get(name)! };
    }
  }
  return undefined;
}

/**
 * Is this identifier a value REFERENCE (something `None` -> `null` could
 * replace)? Declaration names, property names/keys, enum members, labels,
 * import/export specifiers, shorthand properties and type positions are not.
 */
function isValueReferencePosition(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return true; // synthetic expression node
  if ((parent as { name?: ts.Node }).name === node) {
    // `x.None`, `{ None: 1 }`, `enum E { None }`, `function None() {}`, `const None`,
    // `class C { None() {} }`, `{ None }` (can't be replaced by a literal), ...
    return false;
  }
  if ((parent as { propertyName?: ts.Node }).propertyName === node) return false;
  if ((parent as { label?: ts.Node }).label === node) return false;
  if (
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isImportEqualsDeclaration(parent) ||
    ts.isQualifiedName(parent) ||
    ts.isTypeReferenceNode(parent) ||
    ts.isTypeQueryNode(parent) ||
    ts.isExpressionWithTypeArguments(parent) ||
    ts.isMetaProperty(parent)
  ) {
    return false;
  }
  return true;
}

function buildConstantExpression(factory: ts.NodeFactory, value: string): ts.Expression {
  switch (value) {
    case "null":
      return factory.createNull();
    case "undefined":
      return factory.createIdentifier("undefined");
    case "true":
      return factory.createTrue();
    case "false":
      return factory.createFalse();
    default: {
      const num = Number(value);
      if (!isNaN(num)) {
        return factory.createNumericLiteral(num);
      }
      if (value.startsWith('"') || value.startsWith("'")) {
        return factory.createStringLiteral(value.slice(1, -1));
      }
      return factory.createIdentifier(value);
    }
  }
}

/** Check if a path is absolute (Unix `/...` or Windows `C:/...` / `C:\...`). Browser-safe. */
function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[/\\]/.test(p);
}

function isWithinSourceModule(filePath: string, sourceModule: string): boolean {
  const normFile = filePath.replace(/\\/g, "/");
  const normModule = sourceModule.replace(/\\/g, "/");
  if (isAbsolutePath(normModule)) {
    return normFile === normModule;
  }
  const modulePath = normModule.replace(/^@/, "");
  const fileNoExt = normFile.replace(/\.[^/.]+$/, "");
  return fileNoExt.endsWith(modulePath) || fileNoExt.endsWith(modulePath + "/index");
}

/**
 * Rewrite a method call on an @opaque type.
 *
 * When a `methodInlines` pattern is registered for the method, the call is
 * inlined to a null-check expression (e.g., `x.map(fn)` → `x != null ? fn(x) : null`).
 * When the receiver is a literal `null`, the expression is constant-folded.
 * Falls back to standalone function call rewriting when no inline pattern exists.
 */
export function tryRewriteOpaqueMethodCall(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  resolveMacroFromSymbol: ResolveMacroFn,
  node: ts.CallExpression
): ts.Expression | undefined {
  if (!ts.isPropertyAccessExpression(node.expression)) return undefined;

  const guarded = checkMethodCallDispatchGuards(ctx, resolveMacroFromSymbol, node);
  if (!guarded) return undefined;
  const { methodName, receiver } = guarded;

  if (getAllTypeRewrites().length === 0) return undefined;
  // The checker can't type a macro-synthesized receiver (CLAUDE.md).
  if (!isProgramNode(receiver)) return undefined;

  let receiverType: ts.Type;
  try {
    receiverType = ctx.typeChecker.getTypeAtLocation(receiver);
  } catch (error) {
    ctx.reportWarning(
      node,
      `typesugar skipped @opaque method erasure of '.${methodName}()': the receiver type could not be resolved (${error}).`
    );
    return undefined;
  }
  if (!ctx.isTypeReliable(receiverType)) return undefined;

  // Matched by the receiver type's declaration, not its name (see
  // resolveTypeRewriteEntry): an unrelated `class Option` is never rewritten.
  const resolvedEntry = resolveTypeRewriteEntry(receiverType);
  if (!resolvedEntry) return undefined;
  const { entry, typeName } = resolvedEntry;

  if (entry.transparent && isInDefiningModule(ctx, entry)) {
    return undefined;
  }

  const methods = entry.methods;
  if (!methods) return undefined;

  const standaloneFnName = methods.get(methodName);
  if (!standaloneFnName) return undefined;

  const inlinePattern = entry.methodInlines?.get(methodName);
  if (inlinePattern) {
    const visitedReceiver = ts.visitNode(receiver, visit) as ts.Expression;
    const visitedArgs = node.arguments.map((a) => ts.visitNode(a, visit) as ts.Expression);
    const result = buildOpaqueInlineExpression(
      ctx.factory,
      (prefix) => ctx.generateUniqueName(prefix),
      inlinePattern,
      visitedReceiver,
      visitedArgs,
      verbose,
      typeName,
      methodName
    );
    if (result) return preserveSourceMap(result, node);
  }

  // Schedule an import if the standalone function comes from another module --
  // uses the shared reference-hygiene mechanism (ctx.ensureImport) and the
  // identifier IT RETURNS (which may be a conflict-safe alias), matching the
  // pattern already used by method-sugar.ts / tryRewriteTypeclassOperator.
  const resolvedFnName = entry.sourceModule
    ? ctx.ensureImport(standaloneFnName, entry.sourceModule).text
    : standaloneFnName;

  if (verbose) {
    console.log(`[typesugar] Type rewrite: ${typeName}.${methodName}() → ${resolvedFnName}(...)`);
  }

  const ext: StandaloneExtensionInfo = {
    methodName: resolvedFnName,
    forType: entry.typeName,
  };

  const rewritten = buildStandaloneExtensionCall(
    ctx.factory,
    ext,
    receiver,
    Array.from(node.arguments)
  );

  try {
    const visited = ts.visitNode(rewritten, visit) as ts.Expression;
    return preserveSourceMap(visited, node);
  } catch (error) {
    ctx.reportError(node, `Type rewrite method erasure failed: ${error}`);
    return undefined;
  }
}

/**
 * Erase a registered @opaque type's accessor property access (e.g. `money.value`)
 * to either the receiver itself (an identity accessor, the common case for a
 * newtype-shaped wrapper) or a custom expression (PEP-056 Wave 4 -- ported from
 * legacy's `tryEraseAccessor`; core previously had no accessor-erasure dispatch
 * at all, only method/constructor/constant-ref erasure).
 *
 * Dispatched on a bare (non-call) PropertyAccessExpression -- distinct from
 * `tryRewriteOpaqueMethodCall`, which requires the property access to be the
 * callee of a CallExpression.
 */
export function tryEraseOpaqueAccessor(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  node: ts.PropertyAccessExpression
): ts.Expression | undefined {
  const propName = node.name.text;
  const receiver = node.expression;

  // Cheap pre-filter: no checker call unless some entry has this accessor.
  if (!getAllTypeRewrites().some((e) => e.accessors?.has(propName))) return undefined;
  if (!isProgramNode(receiver)) return undefined;

  let receiverType: ts.Type;
  try {
    receiverType = ctx.typeChecker.getTypeAtLocation(receiver);
  } catch (error) {
    ctx.reportWarning(
      node,
      `typesugar skipped @opaque accessor erasure of '.${propName}': the receiver type could not be resolved (${error}).`
    );
    return undefined;
  }
  if (!ctx.isTypeReliable(receiverType)) return undefined;

  const resolvedEntry = resolveTypeRewriteEntry(receiverType);
  if (!resolvedEntry) return undefined;
  const { entry, typeName } = resolvedEntry;
  if (!entry.accessors) return undefined;

  const accessor = entry.accessors.get(propName);
  if (!accessor) return undefined;

  // Transparent scope: skip erasure inside the defining module
  if (entry.transparent && isInDefiningModule(ctx, entry)) {
    return undefined;
  }

  if (accessor.kind === "identity") {
    if (verbose) {
      console.log(`[typesugar] Accessor erasure: ${typeName}.${propName} -> receiver`);
    }
    const visited = ts.visitNode(receiver, visit) as ts.Expression;
    return preserveSourceMap(visited, node);
  }

  if (accessor.kind === "custom" && accessor.value) {
    if (verbose) {
      console.log(`[typesugar] Accessor erasure: ${typeName}.${propName} -> ${accessor.value}`);
    }
    const custom = ctx.factory.createIdentifier(accessor.value);
    return preserveSourceMap(custom, node);
  }

  return undefined;
}

function isNullLiteral(node: ts.Expression): boolean {
  return node.kind === ts.SyntaxKind.NullKeyword;
}

function isSimpleExpression(node: ts.Expression): boolean {
  return (
    ts.isIdentifier(node) ||
    ts.isNumericLiteral(node) ||
    ts.isStringLiteral(node) ||
    isNullLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.UndefinedKeyword
  );
}

/**
 * Can this argument be moved into a conditional branch without changing
 * behavior? Evaluating it has no side effects and its value can't change in
 * between: literals, plain identifiers and function expressions (creating a
 * closure is unobservable). Anything else must be evaluated once, eagerly,
 * as in the original method call.
 */
function isTriviallyEvaluable(node: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(node)) return isTriviallyEvaluable(node.expression);
  return (
    isSimpleExpression(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node)
  );
}

/**
 * Build an inlined expression for an @opaque method call.
 * When the receiver is a literal `null`, constant-folds the result.
 *
 * The receiver must be evaluated once, before the arguments, and every
 * argument exactly once (eagerly), as in the original `recv.method(args)`.
 * So when the receiver is complex or any argument is not trivially
 * evaluable, the ternary is wrapped in an IIFE whose parameters -- fresh
 * hygienic names from `uniqueName`, never a fixed `_opt` that a user
 * reference inside an argument could resolve to -- bind the receiver and
 * those arguments, in source order:
 *
 *   `getOpt().map(mk())` -> `((o, a) => o != null ? a(o) : null)(getOpt(), mk())`
 */
function buildOpaqueInlineExpression(
  factory: ts.NodeFactory,
  uniqueName: (prefix: string) => ts.Identifier,
  pattern: MethodInlinePattern,
  receiver: ts.Expression,
  args: ts.Expression[],
  verbose: boolean,
  typeName: string,
  methodName: string
): ts.Expression | undefined {
  const argsTrivial = args.every(isTriviallyEvaluable);

  if (argsTrivial && isNullLiteral(receiver)) {
    if (verbose) {
      console.log(`[typesugar] Opaque inline (constant-folded null): ${typeName}.${methodName}()`);
    }
    return constantFoldNull(factory, pattern, args);
  }

  if (argsTrivial && isKnownNonNullLiteral(receiver)) {
    if (verbose) {
      console.log(
        `[typesugar] Opaque inline (constant-folded non-null): ${typeName}.${methodName}()`
      );
    }
    return constantFoldNonNull(factory, pattern, receiver, args);
  }

  if (verbose) {
    console.log(`[typesugar] Opaque inline (inlined): ${typeName}.${methodName}()`);
  }

  if (argsTrivial && isSimpleExpression(receiver)) {
    return buildInlineTernary(factory, pattern, receiver, args);
  }

  // Bind the receiver (unless it's a literal) and every non-trivial argument.
  const params: ts.ParameterDeclaration[] = [];
  const callArgs: ts.Expression[] = [];
  const bind = (expr: ts.Expression, prefix: string): ts.Expression => {
    const name = uniqueName(prefix);
    params.push(
      factory.createParameterDeclaration(
        undefined,
        undefined,
        name,
        undefined,
        undefined,
        undefined
      )
    );
    callArgs.push(expr);
    return factory.createIdentifier(name.text);
  };

  const receiverRef =
    isNullLiteral(receiver) || isKnownNonNullLiteral(receiver) ? receiver : bind(receiver, "opt");
  const argRefs = args.map((a, i) => (isTriviallyEvaluable(a) ? a : bind(a, `optArg${i}`)));

  const body = buildInlineTernary(factory, pattern, receiverRef, argRefs);
  if (!body) return undefined;

  const arrow = factory.createArrowFunction(
    undefined,
    undefined,
    params,
    undefined,
    factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    body
  );
  return factory.createCallExpression(
    factory.createParenthesizedExpression(arrow),
    undefined,
    callArgs
  );
}

function isKnownNonNullLiteral(node: ts.Expression): boolean {
  return (
    ts.isNumericLiteral(node) ||
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword
  );
}

/**
 * When the receiver is a known non-null literal (string, number, boolean),
 * the null check can be eliminated entirely.
 */
function constantFoldNonNull(
  factory: ts.NodeFactory,
  pattern: MethodInlinePattern,
  receiver: ts.Expression,
  args: ts.Expression[]
): ts.Expression | undefined {
  switch (pattern.kind) {
    case "null-check-apply": {
      const fn = args[0];
      return fn ? factory.createCallExpression(fn, undefined, [receiver]) : undefined;
    }
    case "null-check-predicate": {
      const pred = args[0];
      if (!pred) return undefined;
      return factory.createConditionalExpression(
        factory.createCallExpression(pred, undefined, [receiver]),
        undefined,
        receiver,
        undefined,
        factory.createNull()
      );
    }
    case "null-coalesce-call":
    case "null-coalesce-value":
      return receiver;
    case "fold": {
      const onSome = args[1];
      return onSome ? factory.createCallExpression(onSome, undefined, [receiver]) : undefined;
    }
  }
}

function constantFoldNull(
  factory: ts.NodeFactory,
  pattern: MethodInlinePattern,
  args: ts.Expression[]
): ts.Expression | undefined {
  switch (pattern.kind) {
    case "null-check-apply":
    case "null-check-predicate":
      return factory.createNull();
    case "null-coalesce-call": {
      const defaultFn = args[0];
      return defaultFn ? factory.createCallExpression(defaultFn, undefined, []) : undefined;
    }
    case "null-coalesce-value":
      return args[0];
    case "fold": {
      const onNone = args[0];
      return onNone ? factory.createCallExpression(onNone, undefined, []) : undefined;
    }
  }
}

function buildInlineTernary(
  factory: ts.NodeFactory,
  pattern: MethodInlinePattern,
  receiver: ts.Expression,
  args: ts.Expression[]
): ts.Expression | undefined {
  const nullExpr = factory.createNull();
  const notNull = factory.createBinaryExpression(
    receiver,
    ts.SyntaxKind.ExclamationEqualsToken,
    nullExpr
  );

  switch (pattern.kind) {
    case "null-check-apply": {
      const fn = args[0];
      if (!fn) return undefined;
      return factory.createConditionalExpression(
        notNull,
        undefined,
        factory.createCallExpression(fn, undefined, [receiver]),
        undefined,
        nullExpr
      );
    }

    case "null-check-predicate": {
      const pred = args[0];
      if (!pred) return undefined;
      return factory.createConditionalExpression(
        factory.createBinaryExpression(
          notNull,
          ts.SyntaxKind.AmpersandAmpersandToken,
          factory.createCallExpression(pred, undefined, [receiver])
        ),
        undefined,
        receiver,
        undefined,
        nullExpr
      );
    }

    case "null-coalesce-call": {
      const defaultFn = args[0];
      if (!defaultFn) return undefined;
      return factory.createConditionalExpression(
        notNull,
        undefined,
        receiver,
        undefined,
        factory.createCallExpression(defaultFn, undefined, [])
      );
    }

    case "null-coalesce-value": {
      const defaultVal = args[0];
      if (!defaultVal) return undefined;
      return factory.createConditionalExpression(
        notNull,
        undefined,
        receiver,
        undefined,
        defaultVal
      );
    }

    case "fold": {
      const onNone = args[0];
      const onSome = args[1];
      if (!onNone || !onSome) return undefined;
      return factory.createConditionalExpression(
        notNull,
        undefined,
        factory.createCallExpression(onSome, undefined, [receiver]),
        undefined,
        factory.createCallExpression(onNone, undefined, [])
      );
    }
  }
}

/**
 * Erase an @opaque constructor call: `Some(x)` → `x`, `Left(e)` → literal.
 */
export function tryEraseOpaqueConstructorCall(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  node: ts.CallExpression
): ts.Expression | undefined {
  if (!ts.isIdentifier(node.expression)) return undefined;

  const ctorName = node.expression.text;

  // Resolved by the callee's symbol, not its name: only a call to the
  // registered entry's own constructor is erased (see resolveConstructorRewrite).
  const resolved = resolveConstructorRewrite(ctx, node.expression);
  if (resolved) {
    const { entry, ctor } = resolved;

    if (entry.transparent && isInDefiningModule(ctx, entry)) {
      return undefined;
    }

    if (ctor.kind === "identity") {
      if (node.arguments.length !== 1) {
        ctx.reportWarning(
          node,
          `Identity constructor '${ctorName}' expects exactly 1 argument, got ${node.arguments.length}`
        );
        return undefined;
      }

      if (verbose) {
        console.log(`[typesugar] Constructor erasure: ${ctorName}(arg) → arg`);
      }

      const arg = node.arguments[0];
      const visited = ts.visitNode(arg, visit) as ts.Expression;
      return preserveSourceMap(visited, node);
    }

    if (ctor.kind === "constant") {
      if (verbose) {
        console.log(`[typesugar] Constructor erasure: ${ctorName}(...) → ${ctor.value}`);
      }
      return preserveSourceMap(
        buildConstantExpression(ctx.factory, ctor.value ?? "undefined"),
        node
      );
    }

    // A "custom" rewrite whose expression is the constructor's own name (what
    // `@adt` registers for object-building variants) would turn `Circle(5)`
    // into the bare function `Circle`, dropping the arguments -- the call
    // already IS the runtime representation, so leave it as-is.
    if (ctor.kind === "custom" && ctor.value && ctor.value !== ctorName) {
      if (verbose) {
        console.log(`[typesugar] Constructor erasure: ${ctorName}(...) → ${ctor.value}`);
      }
      return preserveSourceMap(ctx.factory.createIdentifier(ctor.value), node);
    }
  }

  return undefined;
}

/**
 * Erase a bare constant constructor reference: `None` → `null`.
 */
export function tryEraseOpaqueConstantRef(
  ctx: MacroContextImpl,
  verbose: boolean,
  node: ts.Identifier
): ts.Expression | undefined {
  const name = node.text;

  if (!isValueReferencePosition(node)) return undefined;

  const resolved = resolveConstructorRewrite(ctx, node);
  if (!resolved || resolved.ctor.kind !== "constant") return undefined;
  const { entry, ctor } = resolved;

  if (entry.transparent && isInDefiningModule(ctx, entry)) {
    return undefined;
  }

  if (verbose) {
    console.log(`[typesugar] Constant constructor ref erasure: ${name} → ${ctor.value}`);
  }

  return preserveSourceMap(buildConstantExpression(ctx.factory, ctor.value ?? "undefined"), node);
}

// ---------------------------------------------------------------------------
// @opaque type annotation erasure (PEP-019 Wave 1)
// ---------------------------------------------------------------------------

/**
 * Extract an opaque type rewrite entry from a TypeNode (e.g., `Option<Money>`).
 * Returns the entry whose declaration the type reference resolves to (through
 * import aliases) -- not merely one that shares its name.
 */
function getOpaqueEntryFromTypeNode(
  ctx: MacroContextImpl,
  typeNode: ts.TypeNode
): TypeRewriteEntry | undefined {
  if (!ts.isTypeReferenceNode(typeNode)) return undefined;

  const nameNode = ts.isIdentifier(typeNode.typeName)
    ? typeNode.typeName
    : ts.isQualifiedName(typeNode.typeName)
      ? typeNode.typeName.right
      : undefined;
  if (!nameNode) return undefined;

  const typeName = nameNode.text;
  const candidates = getAllTypeRewrites().filter((e) => e.typeName === typeName);
  if (candidates.length === 0) return undefined;

  const sym = resolveReferencedSymbol(ctx, nameNode, ts.SymbolFlags.Type);
  if (!sym) return undefined;
  for (let i = candidates.length - 1; i >= 0; i--) {
    if (symbolDeclaredByEntry(sym, candidates[i])) return candidates[i];
  }
  return undefined;
}

/**
 * Check if an initializer expression would be erased by opaque constructor
 * erasure for the given type rewrite entry -- the same symbol-resolved check
 * `tryEraseOpaqueConstructorCall`/`tryEraseOpaqueConstantRef` apply, so the
 * annotation is stripped exactly when the initializer really is erased.
 */
function wouldBeOpaqueErased(
  ctx: MacroContextImpl,
  init: ts.Expression,
  entry: TypeRewriteEntry
): boolean {
  if (!entry.constructors) return false;

  if (ts.isCallExpression(init) && ts.isIdentifier(init.expression)) {
    const resolved = resolveConstructorRewrite(ctx, init.expression);
    if (!resolved || resolved.entry !== entry) return false;
    const { ctor } = resolved;
    return !(ctor.kind === "custom" && ctor.value === init.expression.text);
  }

  if (ts.isIdentifier(init)) {
    const resolved = resolveConstructorRewrite(ctx, init);
    return resolved !== undefined && resolved.entry === entry && resolved.ctor.kind === "constant";
  }

  return false;
}

/**
 * When a variable declaration has a type annotation referencing an @opaque type
 * and its initializer would be erased by opaque constructor/constant erasure,
 * strip the type annotation to prevent invalid TypeScript output.
 *
 * `const x: Option<Money> = Some(m)` → `const x = m`
 * `const x: Option<Money> = None` → `const x = null`
 */
export function tryStripOpaqueTypeAnnotation(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  node: ts.VariableDeclaration
): ts.VariableDeclaration | undefined {
  if (!node.type || !node.initializer) return undefined;

  const opaqueEntry = getOpaqueEntryFromTypeNode(ctx, node.type);
  if (!opaqueEntry) return undefined;

  // For same-project opaque types (transparent), skip stripping inside
  // the defining module where the implementation uses the raw representation.
  if (opaqueEntry.transparent && isInDefiningModule(ctx, opaqueEntry)) {
    return undefined;
  }

  // For library-imported opaque types (non-transparent), the published .d.ts
  // has a type alias (e.g., `type Option<A> = A | null`), so the annotation
  // is valid after constructor erasure — keep it.
  if (!opaqueEntry.transparent) return undefined;

  if (!wouldBeOpaqueErased(ctx, node.initializer, opaqueEntry)) return undefined;

  if (verbose) {
    console.log(
      `[typesugar] Type annotation erasure: stripping ${opaqueEntry.typeName} from variable declaration`
    );
  }

  const visitedName = ts.visitNode(node.name, visit) as ts.BindingName;
  const visitedInit = ts.visitNode(node.initializer, visit) as ts.Expression;

  return preserveSourceMap(
    ctx.factory.updateVariableDeclaration(
      node,
      visitedName,
      node.exclamationToken,
      undefined,
      visitedInit
    ),
    node
  );
}

/**
 * When a function parameter has a type annotation referencing an @opaque type
 * and a default value that would be erased by opaque constructor/constant erasure,
 * strip the type annotation to prevent invalid TypeScript output.
 *
 * `function f(x: Option<Money> = Some(m))` → `function f(x = m)`
 */
export function tryStripOpaqueParamAnnotation(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  node: ts.ParameterDeclaration
): ts.ParameterDeclaration | undefined {
  if (!node.type || !node.initializer) return undefined;

  const opaqueEntry = getOpaqueEntryFromTypeNode(ctx, node.type);
  if (!opaqueEntry) return undefined;

  if (opaqueEntry.transparent && isInDefiningModule(ctx, opaqueEntry)) {
    return undefined;
  }

  // Library-imported opaque types have erased type aliases — annotation is valid
  if (!opaqueEntry.transparent) return undefined;

  if (!wouldBeOpaqueErased(ctx, node.initializer, opaqueEntry)) return undefined;

  if (verbose) {
    console.log(
      `[typesugar] Type annotation erasure: stripping ${opaqueEntry.typeName} from parameter`
    );
  }

  const visitedName = ts.visitNode(node.name, visit) as ts.BindingName;
  const visitedInit = ts.visitNode(node.initializer, visit) as ts.Expression;

  return preserveSourceMap(
    ctx.factory.updateParameterDeclaration(
      node,
      node.modifiers,
      node.dotDotDotToken,
      visitedName,
      node.questionToken,
      undefined,
      visitedInit
    ),
    node
  );
}

/**
 * When a function's return type annotation references an @opaque type
 * and the body contains return statements using erased opaque constructors,
 * strip the return type to prevent invalid TypeScript output.
 *
 * `function findPort(...): Option<number> { return Some(x); }`
 * → `function findPort(...) { return x; }`
 */
export function shouldStripOpaqueReturnType(
  ctx: MacroContextImpl,
  returnType: ts.TypeNode | undefined,
  _body: ts.Block | ts.ConciseBody | undefined
): boolean {
  if (!returnType) return false;

  const opaqueEntry = getOpaqueEntryFromTypeNode(ctx, returnType);
  if (!opaqueEntry) return false;

  if (opaqueEntry.transparent && isInDefiningModule(ctx, opaqueEntry)) {
    return false;
  }

  // Library-imported opaque types have erased type aliases — annotation is valid
  if (!opaqueEntry.transparent) return false;

  return true;
}
