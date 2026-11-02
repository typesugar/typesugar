/**
 * Built-in diagnostic suppression rules for @typesugar/macros
 *
 * Rule 1 (ExtensionMethodCall): Suppresses TS2339 ("Property 'X' does not exist
 * on type 'Y'") when an extension method named 'X' is resolvable for type 'Y'
 * through the standalone extension registry or import-scoped resolution.
 *
 * Rule 2 (TypeRewriteAssignment): Suppresses TS2322/TS2345/TS2355 when a type
 * registered in the `typeRewriteRegistry` (from `@opaque`) — matched by symbol
 * and declaring file — is involved in an assignment and the other side matches
 * the registered underlying type.
 *
 * Rule 3 (NewtypeAssignment): Suppresses the spurious TS2345 on the argument of
 * `wrap<T>()` / a newtype constructor (a parameter typed `UnwrapNewtype<T>`).
 * Implicit `Base → Newtype` assignments and brand mismatches stay errors.
 * Legacy: @typesugar/type-system's own types no longer produce that TS2345
 * (see the rule's comment).
 *
 * Every rule must only hide a diagnostic the transformer will actually make
 * valid: an extra red squiggle is far less harmful than a hidden real bug.
 *
 * @see PEP-011 Waves 3-5
 */

import ts from "typescript";
import type {
  DiagnosticSuppressionContext,
  DiagnosticSuppressionRule,
  MacroContext,
  TypeRewriteEntry,
} from "@typesugar/core";
import {
  findStandaloneExtension,
  getAllTypeRewrites,
  typeRewriteEntryCoversFile,
  isDiagnosticSuppressionAuditEnabled,
  isSyntheticNode,
  globalResolutionScope,
  ResolutionScopeTracker,
  scanImportsForScope,
} from "@typesugar/core";
import { getTypeclassesForMethod } from "./typeclass.js";
import { getInstanceOrIntrinsicMethods } from "./specialize.js";
import { getOperatorCandidates } from "./typeclass-index.js";
import { getOperatorString } from "./operators.js";
import { resolveInstance } from "./instance-resolver.js";

/**
 * Create the ExtensionMethodCall diagnostic suppression rule.
 *
 * Suppresses TS2339 when the "missing" property is actually an extension method
 * that the transformer will rewrite at emit time. Checks both:
 * - The standalone extension registry (from `registerExtensions` / `@extension`)
 * - Import-scoped resolution (any imported function whose name matches and whose
 *   first parameter accepts the receiver type)
 */
export function createExtensionMethodCallRule(): DiagnosticSuppressionRule {
  return {
    name: "ExtensionMethodCall",
    errorCodes: [2339],

    shouldSuppress(
      diagnostic: ts.Diagnostic,
      checker: ts.TypeChecker,
      sourceFile: ts.SourceFile
    ): boolean {
      if (diagnostic.start === undefined || diagnostic.length === undefined) {
        return false;
      }

      // Extract the property name from the diagnostic message.
      // TS2339 message format: "Property 'X' does not exist on type 'Y'."
      const messageText = flattenMessage(diagnostic.messageText);
      const propertyName = extractPropertyName(messageText);
      if (!propertyName) return false;

      // Find the AST node at the diagnostic position — should be the property name
      // in a property access expression (e.g., the `clamp` in `(42).clamp(...)`)
      const node = findNodeAtPosition(sourceFile, diagnostic.start, diagnostic.length);
      if (!node) return false;

      // Walk up to the PropertyAccessExpression
      const propAccess = findPropertyAccess(node);
      if (!propAccess) return false;

      // Verify the property name matches what the diagnostic reports
      if (propAccess.name.text !== propertyName) return false;

      const receiver = propAccess.expression;
      let receiverType: ts.Type;
      try {
        receiverType = checker.getTypeAtLocation(receiver);
      } catch (e) {
        if (isDiagnosticSuppressionAuditEnabled()) {
          console.error(`[DiagnosticSuppression] ExtensionMethodCall: ${e}`);
        }
        return false;
      }

      const typeName = checker.typeToString(receiverType);

      // 1. Check standalone extension registry (from registerExtensions / @extension)
      if (findInRegistry(propertyName, typeName, receiverType, checker)) {
        return true;
      }

      // 2. Import-scoped resolution: scan imports for a matching function
      if (resolveExtensionFromImports(sourceFile, propertyName, receiverType, checker)) {
        return true;
      }

      // 3. Typeclass instance method (derived / @instance): e.g. `p.equals(q)` is
      // rewritten by the transformer to `Point.Eq.equals(p, q)`. Suppress the
      // pre-transform TS2339 when the method belongs to a typeclass that has an
      // instance for the receiver type.
      if (
        resolveTypeclassInstanceMethod(propertyName, typeName, receiverType, checker, sourceFile)
      ) {
        return true;
      }

      // 4. Typeclass instance method over a PRIMITIVE via a built-in intrinsic
      // (Wave 7): e.g. `n.equals(m)` for `n: number` is rewritten to
      // `Eq.summon<number>("number").equals(n, m)` using the reflected
      // `eqNumber` intrinsic — there's no user declaration to inspect the
      // way there is for @derive'd classes, so this checks the intrinsic
      // registry and import-scoped method-syntax activation instead.
      if (
        resolvePrimitiveTypeclassMethod(propertyName, typeName, receiverType, checker, sourceFile)
      ) {
        return true;
      }

      return false;
    },
  };
}

const PRIMITIVE_TYPE_NAMES = new Set(["number", "string", "boolean", "bigint"]);

function normalizePrimitiveTypeName(typeName: string): string | undefined {
  const lower = typeName.toLowerCase();
  return PRIMITIVE_TYPE_NAMES.has(lower) ? lower : undefined;
}

/**
 * Check whether `methodName` is a typeclass method with a registered
 * built-in intrinsic instance (PEP-052 Wave 7: eq/ord/show/hash over
 * number/string/boolean/bigint, reflected from primitives.ts) for a
 * PRIMITIVE receiver type — i.e. the transformer will rewrite
 * `recv.methodName(...)` to `TC.summon<Type>("Type").methodName(recv, ...)`.
 *
 * Unlike `resolveTypeclassInstanceMethod` (@derive'd classes, decided purely
 * from a source annotation on the receiver's own declaration), a primitive
 * has no user-authored declaration to inspect. So this checks two
 * independent conditions instead: an intrinsic instance actually exists for
 * `tcName<typeName>` (naming convention `${tc}${Type}`, e.g. "eqNumber"),
 * AND method syntax for that typeclass is activated in this file (PEP-052's
 * import-scoped activation gate — `globalResolutionScope` is populated by
 * the transform pass that always runs before diagnostic suppression filtering, both in the
 * CLI's `program.emit()` and the language service's `getTransformResult()`).
 * Without the activation check, a stray `(5).equals(6)` with no
 * `@typesugar/std/syntax/eq` import would be wrongly suppressed instead of
 * flagged as the real error it is.
 */
function resolvePrimitiveTypeclassMethod(
  methodName: string,
  typeName: string,
  receiverType: ts.Type,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile
): boolean {
  const candidates = getTypeclassesForMethod(methodName);
  if (!candidates) return false;

  let primitiveName = normalizePrimitiveTypeName(typeName);
  if (!primitiveName) {
    // Widen literal types: 42 → number, "hello" → string
    try {
      const baseType = checker.getBaseTypeOfLiteralType(receiverType);
      primitiveName = normalizePrimitiveTypeName(checker.typeToString(baseType));
    } catch (e) {
      if (isDiagnosticSuppressionAuditEnabled()) {
        console.error(`[DiagnosticSuppression] resolvePrimitiveTypeclassMethod: ${e}`);
      }
    }
  }
  if (!primitiveName) return false;
  const capitalized = primitiveName[0].toUpperCase() + primitiveName.slice(1);

  for (const candidate of candidates) {
    const tcName = candidate.typeclass;
    if (!globalResolutionScope.isMethodSyntaxActivated(sourceFile.fileName, tcName)) continue;
    const dictName = `${tcName.toLowerCase()}${capitalized}`;
    if (getInstanceOrIntrinsicMethods(dictName)) return true;
  }
  return false;
}

/**
 * Check whether `methodName` is a typeclass method that the receiver's type
 * derives — i.e. the transformer will rewrite `recv.methodName(...)` to the
 * companion call `Type.TC.methodName(recv, ...)`.
 *
 * This is decided from the AST (the receiver type's declaration carries a
 * `@derive(...)` decorator or `@derive`/`@deriving` JSDoc tag), NOT from the
 * instance registry: `typesugar check` runs with `noEmit`, so the transformer
 * never runs and the registry is empty at diagnostic-filter time. The annotation
 * is always present in the source, so it is the reliable signal — and it works
 * for both the decorator and JSDoc trigger forms.
 */
function resolveTypeclassInstanceMethod(
  methodName: string,
  _typeName: string,
  receiverType: ts.Type,
  _checker: ts.TypeChecker,
  _sourceFile: ts.SourceFile
): boolean {
  const candidates = getTypeclassesForMethod(methodName);
  if (!candidates) return false;
  const candidateNames = new Set(candidates.map((c) => c.typeclass));

  const symbol = receiverType.getSymbol() ?? receiverType.aliasSymbol;
  const declarations = symbol?.getDeclarations();
  if (!declarations) return false;

  for (const decl of declarations) {
    for (const derived of deriveNamesFromDeclaration(decl)) {
      if (candidateNames.has(derived)) return true;
    }
  }
  return false;
}

/**
 * Extract the typeclass names a declaration derives, from either trigger form:
 * - decorator: `@derive(Eq, Clone)` (stored in `modifiers` even on interfaces)
 * - JSDoc: `/** @derive(Eq, Clone) *\/` or `@deriving Eq, Clone`
 */
function deriveNamesFromDeclaration(decl: ts.Node): string[] {
  const names: string[] = [];

  const modifiers = (decl as { modifiers?: ts.NodeArray<ts.ModifierLike> }).modifiers;
  if (modifiers) {
    for (const m of modifiers) {
      if (!ts.isDecorator(m)) continue;
      const expr = m.expression;
      if (
        ts.isCallExpression(expr) &&
        ts.isIdentifier(expr.expression) &&
        (expr.expression.text === "derive" || expr.expression.text === "deriving")
      ) {
        for (const arg of expr.arguments) {
          if (ts.isIdentifier(arg)) names.push(arg.text);
        }
      }
    }
  }

  for (const tag of ts.getJSDocTags(decl)) {
    const tagName = tag.tagName.text;
    if (tagName !== "derive" && tagName !== "deriving") continue;
    const comment = typeof tag.comment === "string" ? tag.comment : "";
    for (const ident of comment.matchAll(/[A-Za-z_$][\w$]*/g)) {
      names.push(ident[0]);
    }
  }

  return names;
}

// ---------------------------------------------------------------------------
// Standalone registry lookup with type widening
// ---------------------------------------------------------------------------

/**
 * Check the standalone extension registry, trying multiple type name forms:
 * 1. Exact type name from typeToString (e.g., "42", "Array<number>")
 * 2. Base type of literal (e.g., "42" → "number", '"hello"' → "string")
 * 3. Generics stripped (e.g., "Array<number>" → "Array")
 */
function findInRegistry(
  propertyName: string,
  typeName: string,
  receiverType: ts.Type,
  checker: ts.TypeChecker
): boolean {
  if (findStandaloneExtension(propertyName, typeName)) {
    return true;
  }

  // Widen literal types: 42 → number, "hello" → string, true → boolean
  try {
    const baseType = checker.getBaseTypeOfLiteralType(receiverType);
    const baseName = checker.typeToString(baseType);
    if (baseName !== typeName && findStandaloneExtension(propertyName, baseName)) {
      return true;
    }
  } catch (e) {
    if (isDiagnosticSuppressionAuditEnabled()) {
      console.error(`[DiagnosticSuppression] findInRegistry: ${e}`);
    }
  }

  // Strip generics: Array<number> → Array
  const strippedName = typeName.replace(/<.*>$/, "");
  if (strippedName !== typeName && findStandaloneExtension(propertyName, strippedName)) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Message parsing
// ---------------------------------------------------------------------------

const TS2339_PATTERN = /^Property '([^']+)' does not exist on type /;

function extractPropertyName(message: string): string | undefined {
  const match = TS2339_PATTERN.exec(message);
  return match?.[1];
}

function flattenMessage(messageText: string | ts.DiagnosticMessageChain): string {
  if (typeof messageText === "string") return messageText;
  return messageText.messageText;
}

// ---------------------------------------------------------------------------
// AST navigation
// ---------------------------------------------------------------------------

function findNodeAtPosition(
  sourceFile: ts.SourceFile,
  start: number,
  length: number
): ts.Node | undefined {
  function visit(node: ts.Node): ts.Node | undefined {
    if (node.getStart(sourceFile) <= start && node.getEnd() >= start + length) {
      const child = ts.forEachChild(node, visit);
      return child ?? node;
    }
    return undefined;
  }
  return ts.forEachChild(sourceFile, visit);
}

/**
 * Walk up from a node to find the enclosing PropertyAccessExpression.
 * The diagnostic position is on the property name identifier, so we need
 * to go up to the PropertyAccessExpression to get the receiver.
 */
function findPropertyAccess(node: ts.Node): ts.PropertyAccessExpression | undefined {
  let current: ts.Node | undefined = node;
  // Walk up at most 3 levels (identifier → propAccess or identifier → propAccess.name context)
  for (let i = 0; i < 3 && current; i++) {
    if (ts.isPropertyAccessExpression(current)) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Import-scoped extension resolution (mirrors transformer logic)
// ---------------------------------------------------------------------------

/**
 * Scan the source file's imports for a function or namespace property that
 * could serve as an extension method. This mirrors the transformer's
 * `resolveExtensionFromImports` / `checkImportedSymbolForExtension` logic
 * but operates without transformer state.
 */
function resolveExtensionFromImports(
  sourceFile: ts.SourceFile,
  methodName: string,
  receiverType: ts.Type,
  checker: ts.TypeChecker
): boolean {
  if (!sourceFile.statements) return false;

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;

    const clause = stmt.importClause;
    if (!clause) continue;

    // Check named imports: import { clamp, NumberExt } from "..."
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const spec of clause.namedBindings.elements) {
        if (checkImportedSymbol(spec.name, methodName, receiverType, checker)) {
          return true;
        }
      }
    }

    // Check namespace import: import * as std from "..."
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      if (checkImportedSymbol(clause.namedBindings.name, methodName, receiverType, checker)) {
        return true;
      }
    }

    // Check default import: import Foo from "..."
    if (clause.name) {
      if (checkImportedSymbol(clause.name, methodName, receiverType, checker)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if an imported identifier provides an extension method matching
 * `methodName` for `receiverType`. Mirrors the transformer's
 * `checkImportedSymbolForExtension`.
 *
 * Two cases:
 * 1. Bare function: identifier name === methodName, first param accepts receiverType
 * 2. Namespace: identifier has a property named methodName that is callable
 *    with first param accepting receiverType
 */
function checkImportedSymbol(
  ident: ts.Identifier,
  methodName: string,
  receiverType: ts.Type,
  checker: ts.TypeChecker
): boolean {
  let symbol: ts.Symbol | undefined;
  try {
    symbol = checker.getSymbolAtLocation(ident);
  } catch (e) {
    if (isDiagnosticSuppressionAuditEnabled()) {
      console.error(`[DiagnosticSuppression] checkImportedSymbol: ${e}`);
    }
    return false;
  }
  if (!symbol) return false;

  let identType: ts.Type;
  try {
    identType = checker.getTypeOfSymbolAtLocation(symbol, ident);
  } catch (e) {
    if (isDiagnosticSuppressionAuditEnabled()) {
      console.error(`[DiagnosticSuppression] checkImportedSymbol: ${e}`);
    }
    return false;
  }

  // Case 1: bare function import — name matches and first param is compatible
  if (ident.text === methodName) {
    const callSigs = identType.getCallSignatures();
    for (const sig of callSigs) {
      const params = sig.getParameters();
      if (params.length === 0) continue;
      try {
        const firstParamType = checker.getTypeOfSymbolAtLocation(params[0], ident);
        if (checker.isTypeAssignableTo(receiverType, firstParamType)) {
          return true;
        }
      } catch (e) {
        if (isDiagnosticSuppressionAuditEnabled()) {
          console.error(`[DiagnosticSuppression] checkImportedSymbol: ${e}`);
        }
        continue;
      }
    }
  }

  // Case 2: namespace — has a callable property named methodName
  const prop = identType.getProperty(methodName);
  if (!prop) return false;

  let propType: ts.Type;
  try {
    propType = checker.getTypeOfSymbolAtLocation(prop, ident);
  } catch (e) {
    if (isDiagnosticSuppressionAuditEnabled()) {
      console.error(`[DiagnosticSuppression] checkImportedSymbol: ${e}`);
    }
    return false;
  }

  const callSigs = propType.getCallSignatures();
  for (const sig of callSigs) {
    const params = sig.getParameters();
    if (params.length === 0) continue;
    try {
      const firstParamType = checker.getTypeOfSymbolAtLocation(params[0], ident);
      if (checker.isTypeAssignableTo(receiverType, firstParamType)) {
        return true;
      }
    } catch (e) {
      if (isDiagnosticSuppressionAuditEnabled()) {
        console.error(`[DiagnosticSuppression] checkImportedSymbol: ${e}`);
      }
      continue;
    }
  }

  return false;
}

// ===========================================================================
// Rule 3: NewtypeAssignment — suppress TS2345 on wrap()/newtype-constructor args
// ===========================================================================

/**
 * Create the NewtypeAssignment diagnostic suppression rule.
 *
 * Scope (deep-review macros-other #9): this rule used to suppress every
 * TS2322/TS2345 where one side was a `Newtype<Base, Brand>` and the other fit
 * `Base` — which hid exactly the errors newtypes exist to produce
 * (`getUser(42)`, `area(meters, feet)`; docs/guides/type-system.md promises
 * both are type errors). Implicit `Base → Newtype` assignment is NOT something
 * the transformer makes valid — it rewrites nothing there — so it stays an
 * error.
 *
 * What remains is the one case the transformer DOES handle: the argument of
 * a `wrap<T>(value)` / `newtypeCtor<T>()` / `validatedNewtype<T>()`
 * constructor, i.e. any parameter declared as `UnwrapNewtype<T>`. TypeScript
 * infers `Base` in `UnwrapNewtype<Newtype<number, "UserId">>` as the whole
 * intersection, so `wrap<UserId>(42)` reports a spurious TS2345; `wrap` is
 * erased to its argument by the transformer and the constructors are the
 * identity at runtime. The argument is suppressed only when it fits the
 * newtype's base and does not itself carry a (different or same) newtype
 * brand — re-branding `wrap<Meters>(feet)` keeps its error.
 *
 * Newtypes are identified by declaration (the `[__brand]` member of a type
 * alias named `Newtype`), not by a `/__brand/` substring of the property
 * name, which also matched users' own hand-rolled brands.
 *
 * LEGACY — no longer needed by `@typesugar/type-system` (2026-10): its
 * `UnwrapNewtype` now reads a phantom `[__base]` slot instead of
 * `T extends Newtype<infer Base, string>`, so `wrap<UserId>(42)` and the
 * constructors type-check with no suppression at all (see "NewtypeAssignment
 * rule — no longer needed" in diagnostic-suppression-rules.test.ts, which
 * also shows this rule suppresses nothing there). It now only fires for code
 * that declares its own `Newtype`/`UnwrapNewtype` in the OLD inferred-base
 * shape, which is what the tests/diagnostic-suppression-*.test.ts fixtures
 * still do. Candidate for removal together with those fixtures and the
 * `createNewtypeAssignmentRule` export.
 */
export function createNewtypeAssignmentRule(): DiagnosticSuppressionRule {
  return {
    name: "NewtypeAssignment",
    errorCodes: [2345],

    shouldSuppress(
      diagnostic: ts.Diagnostic,
      checker: ts.TypeChecker,
      sourceFile: ts.SourceFile
    ): boolean {
      if (diagnostic.start === undefined || diagnostic.length === undefined) {
        return false;
      }

      const node = findNodeAtPosition(sourceFile, diagnostic.start, diagnostic.length);
      if (!node || isSyntheticNode(node)) return false;

      const site = findUnwrapNewtypeArgument(node, checker);
      if (!site) return false;

      const targetBases = extractNewtypeBaseTypes(site.paramType);
      if (targetBases.length === 0) return false;

      // A value that is already a newtype is not "a base value being wrapped".
      if (hasNewtypeBrand(site.argType)) return false;

      return targetBases.every((base) => checker.isTypeAssignableTo(site.argType, base));
    },
  };
}

/**
 * If `node` is (inside) an argument of a call whose matching parameter is
 * declared as `UnwrapNewtype<...>`, return the argument and (instantiated)
 * parameter types.
 */
function findUnwrapNewtypeArgument(
  node: ts.Node,
  checker: ts.TypeChecker
): { argType: ts.Type; paramType: ts.Type } | undefined {
  let current: ts.Node = node;
  for (let i = 0; i < 6 && current.parent; i++) {
    const parent: ts.Node = current.parent;
    if (ts.isCallExpression(parent)) {
      const argIndex = parent.arguments.indexOf(current as ts.Expression);
      if (argIndex < 0) return undefined;
      try {
        const sig = checker.getResolvedSignature(parent);
        const param = sig?.getParameters()[argIndex];
        const decl = param?.valueDeclaration;
        if (!param || !decl || !ts.isParameter(decl) || decl.dotDotDotToken) return undefined;
        if (!decl.type || !isUnwrapNewtypeTypeNode(decl.type)) return undefined;
        return {
          argType: checker.getTypeAtLocation(current),
          paramType: checker.getTypeOfSymbolAtLocation(param, parent),
        };
      } catch (e) {
        reportCheckerFailure("NewtypeAssignment", e);
        return undefined;
      }
    }
    current = parent;
  }
  return undefined;
}

function isUnwrapNewtypeTypeNode(typeNode: ts.TypeNode): boolean {
  if (!ts.isTypeReferenceNode(typeNode)) return false;
  const name = typeNode.typeName;
  const text = ts.isIdentifier(name) ? name.text : name.right.text;
  return text === "UnwrapNewtype";
}

/**
 * Is `prop` the phantom `readonly [__brand]: Brand` member declared inside
 * the `Newtype` type alias (`@typesugar/type-system`'s, or a same-shaped local
 * one)? Identified by its declaration, so an unrelated `__brand` property on
 * a user's own branded type is not mistaken for a newtype.
 */
function isNewtypeBrandSymbol(prop: ts.Symbol): boolean {
  for (const decl of prop.declarations ?? []) {
    if (!ts.isPropertySignature(decl)) continue;
    if (!ts.isComputedPropertyName(decl.name)) continue;
    const expr = decl.name.expression;
    if (!ts.isIdentifier(expr) || expr.text !== "__brand") continue;
    for (let n: ts.Node | undefined = decl.parent; n; n = n.parent) {
      if (ts.isTypeAliasDeclaration(n)) {
        if (n.name.text === "Newtype") return true;
        break;
      }
    }
  }
  return false;
}

function hasNewtypeBrand(type: ts.Type): boolean {
  return type.getProperties().some(isNewtypeBrandSymbol);
}

/**
 * For a `Newtype<Base, Brand>` (an intersection containing the declared brand
 * member), return the base constituents — e.g. `[Base1, Base2]` for
 * `Newtype<Base1 & Base2, Brand>`. Returns `[]` for anything else.
 */
function extractNewtypeBaseTypes(type: ts.Type): ts.Type[] {
  if (!type.isIntersection()) return [];
  if (!type.types.some(hasNewtypeBrand)) return [];
  return type.types.filter((t) => !hasNewtypeBrand(t));
}

/** Leave a visible trace when a checker call fails and the rule degrades (CLAUDE.md). */
const reportedCheckerFailures = new Set<string>();
function reportCheckerFailure(where: string, e: unknown): void {
  if (isDiagnosticSuppressionAuditEnabled()) {
    console.error(`[DiagnosticSuppression] ${where}: ${e}`);
    return;
  }
  if (reportedCheckerFailures.has(where)) return;
  reportedCheckerFailures.add(where);
  console.warn(
    `[typesugar] diagnostic suppression (${where}) skipped a diagnostic after a type-checker ` +
      `failure: ${e instanceof Error ? e.message : String(e)}`
  );
}

/**
 * Extract source and target types from an assignment or argument context.
 *
 * Handles:
 * - Variable declarations: `const x: TargetType = sourceExpr`
 * - Assignments: `x = sourceExpr` (where x has a declared type)
 * - Call arguments: `fn(sourceExpr)` where param has TargetType
 */
function extractAssignmentTypes(
  node: ts.Node,
  checker: ts.TypeChecker
): { sourceType: ts.Type; targetType: ts.Type } | undefined {
  // Walk up to find the relevant parent context
  let current: ts.Node | undefined = node;

  for (let i = 0; i < 10 && current; i++) {
    // Variable declaration: const x: T = expr
    if (ts.isVariableDeclaration(current) && current.initializer && current.type) {
      try {
        const targetType = checker.getTypeFromTypeNode(current.type);
        const sourceType = checker.getTypeAtLocation(current.initializer);
        return { sourceType, targetType };
      } catch (e) {
        if (isDiagnosticSuppressionAuditEnabled()) {
          console.error(`[DiagnosticSuppression] extractAssignmentTypes: ${e}`);
        }
        return undefined;
      }
    }

    // Variable declaration without explicit type annotation — target inferred
    if (ts.isVariableDeclaration(current) && current.initializer && !current.type) {
      try {
        const targetType = checker.getTypeAtLocation(current.name);
        const sourceType = checker.getTypeAtLocation(current.initializer);
        if (targetType !== sourceType) {
          return { sourceType, targetType };
        }
      } catch (e) {
        if (isDiagnosticSuppressionAuditEnabled()) {
          console.error(`[DiagnosticSuppression] extractAssignmentTypes: ${e}`);
        }
        return undefined;
      }
    }

    // Binary expression (assignment): x = expr
    if (
      ts.isBinaryExpression(current) &&
      current.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      try {
        const targetType = checker.getTypeAtLocation(current.left);
        const sourceType = checker.getTypeAtLocation(current.right);
        return { sourceType, targetType };
      } catch (e) {
        if (isDiagnosticSuppressionAuditEnabled()) {
          console.error(`[DiagnosticSuppression] extractAssignmentTypes: ${e}`);
        }
        return undefined;
      }
    }

    // Call expression argument: fn(expr) — match the argument to its parameter
    if (ts.isCallExpression(current) && current.arguments.length > 0) {
      const argResult = matchCallArgument(current, node, checker);
      if (argResult) return argResult;
    }

    // Return statement: return expr (in a function with declared return type)
    if (ts.isReturnStatement(current) && current.expression) {
      try {
        const sourceType = checker.getTypeAtLocation(current.expression);
        const fn = findEnclosingFunction(current);
        if (fn?.type) {
          const targetType = checker.getTypeFromTypeNode(fn.type);
          return { sourceType, targetType };
        }
      } catch (e) {
        if (isDiagnosticSuppressionAuditEnabled()) {
          console.error(`[DiagnosticSuppression] extractAssignmentTypes: ${e}`);
        }
        return undefined;
      }
    }

    // Property assignment in object literal: { key: expr }
    if (ts.isPropertyAssignment(current) && current.initializer) {
      try {
        const contextualType = checker.getContextualType(current.initializer);
        if (contextualType) {
          const sourceType = checker.getTypeAtLocation(current.initializer);
          return { sourceType, targetType: contextualType };
        }
      } catch (e) {
        if (isDiagnosticSuppressionAuditEnabled()) {
          console.error(`[DiagnosticSuppression] extractAssignmentTypes: ${e}`);
        }
        return undefined;
      }
    }

    current = current.parent;
  }

  return undefined;
}

/**
 * For a call expression, find which argument the diagnostic node corresponds to
 * and return the source (argument) and target (parameter) types.
 */
function matchCallArgument(
  call: ts.CallExpression,
  diagNode: ts.Node,
  checker: ts.TypeChecker
): { sourceType: ts.Type; targetType: ts.Type } | undefined {
  let argIndex = -1;
  for (let i = 0; i < call.arguments.length; i++) {
    const arg = call.arguments[i];
    if (arg === diagNode || isDescendantOf(diagNode, arg)) {
      argIndex = i;
      break;
    }
  }
  if (argIndex < 0) return undefined;

  try {
    const sig = checker.getResolvedSignature(call);
    if (!sig) return undefined;

    const params = sig.getParameters();
    if (argIndex >= params.length) return undefined;

    const paramType = checker.getTypeOfSymbolAtLocation(params[argIndex], call);
    const argType = checker.getTypeAtLocation(call.arguments[argIndex]);
    return { sourceType: argType, targetType: paramType };
  } catch (e) {
    if (isDiagnosticSuppressionAuditEnabled()) {
      console.error(`[DiagnosticSuppression] matchCallArgument: ${e}`);
    }
    return undefined;
  }
}

function isDescendantOf(child: ts.Node, ancestor: ts.Node): boolean {
  let current: ts.Node | undefined = child.parent;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function findEnclosingFunction(
  node: ts.Node
): ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isArrowFunction(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

// ===========================================================================
// Rule 2: TypeRewriteAssignment — suppress TS2322/TS2345/TS2355 for @opaque
// ===========================================================================

/**
 * Create the TypeRewriteAssignment diagnostic suppression rule.
 *
 * Suppresses TS2322, TS2345, and TS2355 when one side of an assignment is a
 * type registered in the `typeRewriteRegistry` (populated by `@opaque` in
 * PEP-012) and the other side matches the registered underlying representation.
 *
 * At runtime, an `@opaque` type IS its underlying type — the opaque interface
 * only exists in the type system. So assignments like
 * `const o: Option<number> = nullableValue` are safe when `Option<T>` maps to
 * `T | null`.
 *
 * @see PEP-011 Wave 5
 * @see PEP-012 — Type Macros (`@opaque`)
 */
export function createTypeRewriteAssignmentRule(): DiagnosticSuppressionRule {
  return {
    name: "TypeRewriteAssignment",
    errorCodes: [2322, 2345, 2355],

    shouldSuppress(
      diagnostic: ts.Diagnostic,
      checker: ts.TypeChecker,
      sourceFile: ts.SourceFile
    ): boolean {
      if (diagnostic.start === undefined || diagnostic.length === undefined) {
        return false;
      }

      const node = findNodeAtPosition(sourceFile, diagnostic.start, diagnostic.length);
      if (!node) return false;

      // TS2355 is special: "A function whose declared type is neither 'void' nor 'any'
      // must return a value." — the diagnostic is on the function declaration, not an
      // assignment. We handle it by checking if the return type is a registered opaque
      // type (the function returns the underlying type implicitly).
      if (diagnostic.code === 2355) {
        return checkReturnTypeRewrite(node, checker);
      }

      // For TS2322/TS2345, extract source and target from the assignment context.
      const types = extractAssignmentTypes(node, checker);
      if (!types) return false;

      const { sourceType, targetType } = types;

      return checkTypeRewriteAssignability(sourceType, targetType, checker);
    },
  };
}

/**
 * Check whether source→target assignment is valid because one side is a
 * registered opaque type and the other matches its underlying representation.
 *
 * The opaque side is identified by its SYMBOL (name + declaring file), the way
 * the transformer's symbol-scoped erasure identifies it (commit c96a5925), not
 * by the `typeToString` text: an unrelated same-named `Option` from another
 * module must not borrow a registered entry. The underlying template is then
 * instantiated with the type's real arguments, matched to the declaration's
 * own type-parameter names (deep-review macros-other #18: a hardcoded
 * `T, U, V, ...` positional list left fp's `Option<A>` unsubstituted).
 */
function checkTypeRewriteAssignability(
  sourceType: ts.Type,
  targetType: ts.Type,
  checker: ts.TypeChecker
): boolean {
  // Case 1: target is an opaque type, source matches its underlying
  const target = resolveTypeRewrite(targetType, checker);
  if (target) {
    for (const st of collectTypeTextVariants(
      sourceType,
      checker.typeToString(sourceType),
      checker
    )) {
      if (matchesRewriteUnderlying(st, target)) return true;
    }
  }

  // Case 2: source is an opaque type, target matches its underlying
  const source = resolveTypeRewrite(sourceType, checker);
  if (source) {
    for (const tt of collectTypeTextVariants(
      targetType,
      checker.typeToString(targetType),
      checker
    )) {
      if (matchesRewriteUnderlying(tt, source)) return true;
    }
  }

  return false;
}

interface ResolvedTypeRewrite {
  entry: TypeRewriteEntry;
  /** `underlyingTypeText` with the type's arguments substituted for its parameters. */
  underlyingText: string;
}

function matchesRewriteUnderlying(candidateText: string, rewrite: ResolvedTypeRewrite): boolean {
  if (rewrite.entry.matchesUnderlying && rewrite.entry.matchesUnderlying(candidateText)) {
    return true;
  }
  return isUnderlyingMatch(candidateText, rewrite.underlyingText);
}

/**
 * Find the type-rewrite entry for `type` by its symbol, and instantiate the
 * entry's underlying template with the type's arguments.
 *
 * An entry with a `declarationFile` (or `sourceModule`) only applies to a
 * symbol declared in that file/module. An entry carrying neither (hand-built
 * registrations) falls back to a name match.
 */
function resolveTypeRewrite(
  type: ts.Type,
  checker: ts.TypeChecker
): ResolvedTypeRewrite | undefined {
  const symbol = type.aliasSymbol ?? type.getSymbol();
  if (!symbol) return undefined;
  const name = symbol.getName();
  const candidates = getAllTypeRewrites().filter((e) => e.typeName === name);
  if (candidates.length === 0) return undefined;

  const declarations = symbol.getDeclarations() ?? [];
  const declFiles = declarations.map((d) => d.getSourceFile().fileName);
  let entry: TypeRewriteEntry | undefined;
  for (let i = candidates.length - 1; i >= 0 && !entry; i--) {
    const c = candidates[i];
    if (
      (c.declarationFile || c.sourceModule) &&
      declFiles.some((f) => typeRewriteEntryCoversFile(f, c))
    ) {
      entry = c;
    }
  }
  for (let i = candidates.length - 1; i >= 0 && !entry; i--) {
    const c = candidates[i];
    if (!c.declarationFile && !c.sourceModule) entry = c;
  }
  if (!entry) return undefined;

  // Type parameters, by name, from the declaration itself.
  let paramNames: string[] = [];
  for (const decl of declarations) {
    if (
      (ts.isInterfaceDeclaration(decl) ||
        ts.isTypeAliasDeclaration(decl) ||
        ts.isClassDeclaration(decl)) &&
      decl.typeParameters
    ) {
      paramNames = decl.typeParameters.map((tp) => tp.name.text);
      break;
    }
  }

  let typeArgs: readonly ts.Type[] = [];
  if (type.aliasSymbol) {
    typeArgs = type.aliasTypeArguments ?? [];
  } else if (
    type.flags & ts.TypeFlags.Object &&
    (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
  ) {
    typeArgs = checker.getTypeArguments(type as ts.TypeReference);
  }

  const substitutions = new Map<string, string>();
  for (let i = 0; i < paramNames.length && i < typeArgs.length; i++) {
    substitutions.set(paramNames[i], checker.typeToString(typeArgs[i]));
  }
  return {
    entry,
    underlyingText: substituteTypeParams(entry.underlyingTypeText, substitutions),
  };
}

/**
 * Replace whole-word type-parameter names in a type text, all at once (so
 * `<A, B>` instantiated as `<B, A>` cannot substitute twice). This compares
 * type texts for matching only; no code is generated from the result.
 */
function substituteTypeParams(
  template: string,
  substitutions: ReadonlyMap<string, string>
): string {
  if (substitutions.size === 0) return template;
  const names = [...substitutions.keys()].map((n) => n.replace(/[$]/g, "\\$&"));
  const pattern = new RegExp(`(?<![\\w$])(?:${names.join("|")})(?![\\w$])`, "g");
  return template.replace(pattern, (m) => substitutions.get(m) ?? m);
}

/**
 * Collect type name variants for matching: the literal form, the widened
 * base type, and stripped generics.
 */
function collectTypeTextVariants(
  type: ts.Type,
  typeText: string,
  checker: ts.TypeChecker
): string[] {
  const variants = [typeText];

  // Widen literal types: "user@test.com" → string, 42 → number, true → boolean
  try {
    const baseType = checker.getBaseTypeOfLiteralType(type);
    const baseName = checker.typeToString(baseType);
    if (baseName !== typeText && !variants.includes(baseName)) {
      variants.push(baseName);
    }
  } catch (e) {
    if (isDiagnosticSuppressionAuditEnabled()) {
      console.error(`[DiagnosticSuppression] collectTypeTextVariants: ${e}`);
    }
  }

  return variants;
}

/**
 * Check if a type text matches an underlying type text representation.
 *
 * Handles simple cases like exact match and normalized whitespace comparison.
 * For complex cases (union types with different orderings, etc.), the
 * `matchesUnderlying` callback on the registry entry should be used.
 */
function isUnderlyingMatch(candidateText: string, underlyingText: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  if (norm(candidateText) === norm(underlyingText)) return true;

  // Handle union type ordering: "null | T" vs "T | null"
  const normalizeParts = (s: string) =>
    s
      .split("|")
      .map((p) => p.trim())
      .sort()
      .join(" | ");

  if (normalizeParts(candidateText) === normalizeParts(underlyingText)) return true;

  return false;
}

// ===========================================================================
// Rule 5: MacroDecorator — suppress TS1206 for typesugar decorators on interfaces
// ===========================================================================

/**
 * Known typesugar decorator names that the transformer handles on interfaces,
 * type aliases, and other non-class declarations where TypeScript doesn't
 * normally allow decorators.
 */
const MACRO_DECORATOR_NAMES = new Set([
  "derive",
  "typeclass",
  "service",
  "hkt",
  "adt",
  "opaque",
  "mock",
  "existential",
  "tailrec",
  "contract",
]);

/**
 * Create the MacroDecorator diagnostic suppression rule.
 *
 * Suppresses TS1206 ("Decorators are not valid here") when the decorator is a
 * known typesugar macro. TypeScript doesn't allow decorators on interfaces or
 * type aliases, but the typesugar transformer handles them at compile time.
 */
export function createMacroDecoratorRule(): DiagnosticSuppressionRule {
  return {
    name: "MacroDecorator",
    errorCodes: [1206],

    shouldSuppress(
      diagnostic: ts.Diagnostic,
      _checker: ts.TypeChecker,
      sourceFile: ts.SourceFile
    ): boolean {
      if (diagnostic.start === undefined) return false;

      // Find the node at the diagnostic position — should be the @ decorator
      const node = findNodeAtPosition(sourceFile, diagnostic.start, diagnostic.length ?? 1);
      if (!node) return false;

      // Walk up to find a decorator
      let current: ts.Node | undefined = node;
      for (let i = 0; i < 5 && current; i++) {
        if (ts.isDecorator(current)) {
          // Extract the decorator name
          const expr = current.expression;
          let name: string | undefined;
          if (ts.isIdentifier(expr)) {
            name = expr.text;
          } else if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
            name = expr.expression.text;
          }
          if (name && MACRO_DECORATOR_NAMES.has(name)) {
            return true;
          }
        }
        current = current.parent;
      }

      return false;
    },
  };
}

// ===========================================================================
// Rule 7: MacroCallChain — suppress errors inside typesugar match() chains
// ===========================================================================

/** The chain methods the `match` macro parses (std/src/macros/match.ts parseArms). */
const MATCH_CHAIN_METHODS = new Set(["case", "or", "as", "if", "then", "else"]);

/**
 * Create the MacroCallChain diagnostic suppression rule.
 *
 * Applies only to a fluent chain rooted at `@typesugar/std`'s `match` (the
 * callee resolved through imports to that package, as the transformer
 * resolves it — deep-review macros-other #17: any function named `match`,
 * including ts-pattern's, used to qualify, and every TS2339/TS2304 within 20
 * parents was hidden). Within such a chain it suppresses:
 *
 * - TS2339 on a chain method itself (`.case`, `.then`, ... on `never`), which
 *   the macro consumes;
 * - TS2304 ("Cannot find name") and TS18004 (shorthand with no value) only for
 *   a name the arm's own pattern binds (`.case({ kind: "circle", r })`,
 *   `.case([p, ...rest])`, `.case(Some(x))`, `.as(name)`), used in that arm's
 *   pattern, `.as`, `.if` or `.then`. The transformer emits `const r = ...`
 *   for exactly those names. Any other unknown name is a real error.
 */
export function createMacroCallChainRule(): DiagnosticSuppressionRule {
  return {
    name: "MacroCallChain",
    errorCodes: [2339, 2304, 18004],

    shouldSuppress(
      diagnostic: ts.Diagnostic,
      checker: ts.TypeChecker,
      sourceFile: ts.SourceFile
    ): boolean {
      if (diagnostic.start === undefined) return false;

      const node = findNodeAtPosition(sourceFile, diagnostic.start, diagnostic.length ?? 1);
      if (!node || isSyntheticNode(node)) return false;

      if (diagnostic.code === 2339) {
        return isMatchChainMethodName(node, checker, sourceFile);
      }

      if (!ts.isIdentifier(node)) return false;
      const name = node.text;

      // Every enclosing chain link whose arguments contain the node, innermost
      // first: a name may be bound by an outer arm and used in a nested match.
      for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
        if (!ts.isCallExpression(current)) continue;
        if (!current.arguments.some((a) => isWithin(node, a))) continue;
        const chain = flattenMatchChain(current, checker, sourceFile);
        if (!chain) continue;
        if (armBindingsAt(chain.links).has(name)) return true;
      }
      return false;
    },
  };
}

interface MatchChainLink {
  method: string;
  args: readonly ts.Expression[];
}

/**
 * Flatten `match(x).case(p).then(r)...` ending at `call` into its links
 * (outermost-last). Returns `undefined` unless `call` is a chain link (not the
 * root `match(x)` call itself) of a chain rooted at typesugar's `match`.
 */
function flattenMatchChain(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile
): { links: MatchChainLink[] } | undefined {
  const links: MatchChainLink[] = [];
  let expr: ts.CallExpression = call;
  for (let i = 0; i < 200; i++) {
    const callee = expr.expression;
    if (ts.isIdentifier(callee)) {
      if (links.length === 0) return undefined; // the root call's own args
      if (!isTypesugarMatch(callee, checker, sourceFile)) return undefined;
      links.reverse();
      return { links };
    }
    if (!ts.isPropertyAccessExpression(callee) || !ts.isCallExpression(callee.expression)) {
      return undefined;
    }
    if (!MATCH_CHAIN_METHODS.has(callee.name.text)) return undefined;
    links.push({ method: callee.name.text, args: expr.arguments });
    expr = callee.expression;
  }
  return undefined;
}

/** Names bound by the arm that the LAST link belongs to. */
function armBindingsAt(links: readonly MatchChainLink[]): Set<string> {
  const names = new Set<string>();
  const last = links[links.length - 1];
  if (last.method === "else") return names;
  // Walk back to the arm's `.case` (an arm is `.case [.or]* [.as] [.if] .then`).
  for (let i = links.length - 1; i >= 0; i--) {
    const link = links[i];
    if (link.method === "then" && i !== links.length - 1) break;
    if (link.method === "case" || link.method === "or" || link.method === "as") {
      for (const arg of link.args.slice(0, 1)) collectPatternBindings(arg, names);
    }
    if (link.method === "case") break;
  }
  return names;
}

/**
 * Syntactically collect the variable names a match pattern binds (mirrors
 * `analyzePattern`/`collectBindings` in std/src/macros/match.ts): bare
 * identifiers, array elements and spreads, object shorthands, property values,
 * and extractor arguments (`Some(x)`), but never an extractor's callee.
 */
function collectPatternBindings(pattern: ts.Expression, out: Set<string>): void {
  if (ts.isIdentifier(pattern)) {
    if (pattern.text !== "_" && pattern.text !== "undefined") out.add(pattern.text);
  } else if (ts.isParenthesizedExpression(pattern)) {
    collectPatternBindings(pattern.expression, out);
  } else if (ts.isArrayLiteralExpression(pattern)) {
    for (const el of pattern.elements) collectPatternBindings(el, out);
  } else if (ts.isSpreadElement(pattern)) {
    collectPatternBindings(pattern.expression, out);
  } else if (ts.isObjectLiteralExpression(pattern)) {
    for (const prop of pattern.properties) {
      if (ts.isShorthandPropertyAssignment(prop)) out.add(prop.name.text);
      else if (ts.isPropertyAssignment(prop)) collectPatternBindings(prop.initializer, out);
      else if (ts.isSpreadAssignment(prop)) collectPatternBindings(prop.expression, out);
    }
  } else if (ts.isCallExpression(pattern)) {
    for (const arg of pattern.arguments) collectPatternBindings(arg, out);
  }
}

/** Is `node` the name of a chain method (`.case`, `.then`, ...) of a typesugar match chain? */
function isMatchChainMethodName(
  node: ts.Node,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile
): boolean {
  const access = node.parent;
  if (!ts.isIdentifier(node) || !access || !ts.isPropertyAccessExpression(access)) return false;
  if (access.name !== node) return false;
  const call = access.parent;
  if (!call || !ts.isCallExpression(call) || call.expression !== access) return false;
  return flattenMatchChain(call, checker, sourceFile) !== undefined;
}

function isWithin(node: ts.Node, ancestor: ts.Node): boolean {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    if (n === ancestor) return true;
  }
  return false;
}

/** Packages whose `match` export is the typesugar macro (match.ts `module`). */
function isTypesugarMatchModule(spec: string): boolean {
  return spec === "@typesugar/std" || spec.startsWith("@typesugar/std/") || spec === "typesugar";
}

/** The package a declaration file belongs to (mirrors import-resolution.ts resolveModuleSpecifier). */
function packageOfFile(fileName: string): string | undefined {
  const normalized = fileName.replace(/\\/g, "/");
  const nm = /\/node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(normalized);
  if (nm) return nm[1];
  const pk = /\/packages\/([a-z0-9-]+)\//.exec(normalized);
  if (pk) return pk[1] === "typesugar" ? "typesugar" : `@typesugar/${pk[1]}`;
  return undefined;
}

/**
 * Does `callee` refer to typesugar's `match` macro? Resolved through import
 * aliases to a declaration in `@typesugar/std` (or the `typesugar` umbrella);
 * when the import cannot be resolved at all, the import specifier decides,
 * as the transformer's name-and-import fallback does. A local or third-party
 * `match` never qualifies.
 */
function isTypesugarMatch(
  callee: ts.Identifier,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile
): boolean {
  let symbol: ts.Symbol | undefined;
  try {
    symbol = checker.getSymbolAtLocation(callee);
  } catch (e) {
    reportCheckerFailure("MacroCallChain", e);
    return false;
  }
  if (!symbol) return false;

  const wasImported = (symbol.flags & ts.SymbolFlags.Alias) !== 0;
  let resolved = symbol;
  if (wasImported) {
    try {
      resolved = checker.getAliasedSymbol(symbol);
    } catch (e) {
      reportCheckerFailure("MacroCallChain", e);
      return false;
    }
  }

  const decls = resolved.getDeclarations() ?? [];
  if (decls.length > 0) {
    if (resolved.getName() !== "match") return false;
    return decls.some((d) => {
      const pkg = packageOfFile(d.getSourceFile().fileName);
      return pkg !== undefined && isTypesugarMatchModule(pkg);
    });
  }

  // Unresolvable import: decide by the import declaration's specifier.
  if (!wasImported) return false;
  const importDecl = symbol.declarations?.[0];
  for (let n: ts.Node | undefined = importDecl; n; n = n.parent) {
    if (ts.isImportDeclaration(n)) {
      if (!ts.isStringLiteral(n.moduleSpecifier)) return false;
      const importedName =
        importDecl && ts.isImportSpecifier(importDecl)
          ? (importDecl.propertyName ?? importDecl.name).text
          : undefined;
      return importedName === "match" && isTypesugarMatchModule(n.moduleSpecifier.text);
    }
  }
  return false;
}

// ===========================================================================
// Rule 6: OperatorOverload — suppress TS2365 for @op operator overloading
// ===========================================================================

/** Mirrors OPERATOR_PRIMITIVE_TYPES in transformer-core/src/rewriting.ts. */
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

/** Per-program operator-syntax activation, computed the way the transform pass does. */
const operatorActivationCache = new WeakMap<ts.Program, Map<string, Set<string>>>();

function activatedOperatorTypeclasses(program: ts.Program, sourceFile: ts.SourceFile): Set<string> {
  let perFile = operatorActivationCache.get(program);
  if (!perFile) {
    perFile = new Map();
    operatorActivationCache.set(program, perFile);
  }
  const cached = perFile.get(sourceFile.fileName);
  if (cached) return cached;
  // A private tracker: same scan as transform.ts's scanImportsForScope call,
  // without depending on whether (or for which program) a transform ran.
  const tracker = new ResolutionScopeTracker();
  scanImportsForScope(sourceFile, tracker, program);
  const result = new Set([
    ...tracker.getActivatedOperatorSyntax(sourceFile.fileName),
    ...tracker.getDefinedTypeclasses(sourceFile.fileName),
  ]);
  perFile.set(sourceFile.fileName, result);
  return result;
}

/**
 * Create the OperatorOverload diagnostic suppression rule.
 *
 * Suppresses TS2365 ("Operator 'X' cannot be applied to types 'A' and 'B'")
 * only when the transformer's operator rewrite (`tryRewriteTypeclassOperator`)
 * will replace that expression: the file activates (imports or defines) a
 * typeclass mapping the operator via `@op`, the LEFT operand is a
 * non-primitive type, and an instance of that typeclass for the left
 * operand's type is in scope (or the type `@derive`s it). Deep-review
 * macros-other #10: it used to suppress every TS2365 with any object operand
 * (`money + 1`, `[1, 2] + 3`).
 *
 * The operator index needs the `ts.Program`, which the caller must pass in
 * the evaluation context (`filterDiagnostics(..., { program })`); without it
 * nothing is suppressed.
 */
export function createOperatorOverloadRule(): DiagnosticSuppressionRule {
  return {
    name: "OperatorOverload",
    errorCodes: [2365],

    shouldSuppress(
      diagnostic: ts.Diagnostic,
      checker: ts.TypeChecker,
      sourceFile: ts.SourceFile,
      context?: DiagnosticSuppressionContext
    ): boolean {
      const program = context?.program;
      if (!program) return false;
      if (diagnostic.start === undefined || diagnostic.length === undefined) {
        return false;
      }

      const node = findNodeAtPosition(sourceFile, diagnostic.start, diagnostic.length);
      if (!node) return false;

      let binary: ts.BinaryExpression | undefined;
      for (let cur: ts.Node | undefined = node, i = 0; cur && i < 5; cur = cur.parent, i++) {
        if (ts.isBinaryExpression(cur)) {
          binary = cur;
          break;
        }
      }
      if (!binary || isSyntheticNode(binary)) return false;

      const op = getOperatorString(binary.operatorToken.kind);
      if (!op) return false;

      const activated = activatedOperatorTypeclasses(program, sourceFile);
      if (activated.size === 0) return false;
      const candidates = getOperatorCandidates(program, activated, op);
      if (candidates.length === 0) return false;

      try {
        const leftType = checker.getTypeAtLocation(binary.left);
        const rightType = checker.getTypeAtLocation(binary.right);
        const nullish = ts.TypeFlags.Null | ts.TypeFlags.Undefined;
        if ((leftType.flags & nullish) !== 0 || (rightType.flags & nullish) !== 0) return false;
        const leftName = checker.typeToString(leftType).replace(/<.*>$/, "");
        if (OPERATOR_PRIMITIVE_TYPES.has(leftName)) return false;
        if (!(leftType.flags & ts.TypeFlags.Object)) return false;

        const ctx = { typeChecker: checker, program, sourceFile } as unknown as MacroContext;
        const declared = new Set<string>();
        const symbol = leftType.getSymbol() ?? leftType.aliasSymbol;
        for (const decl of symbol?.getDeclarations() ?? []) {
          for (const tc of deriveNamesFromDeclaration(decl)) declared.add(tc);
        }
        for (const candidate of candidates) {
          if (declared.has(candidate.typeclass)) return true;
          const resolved = resolveInstance(ctx, candidate.typeclass, leftType);
          if (resolved?.kind === "resolved") return true;
        }
      } catch (e) {
        reportCheckerFailure("OperatorOverload", e);
        return false;
      }
      return false;
    },
  };
}

/**
 * Handle TS2355 by checking if the function's return type is a registered
 * opaque type. If so, the function body may return the underlying type
 * implicitly, which the transformer will handle.
 */
function checkReturnTypeRewrite(node: ts.Node, checker: ts.TypeChecker): boolean {
  const fn = findEnclosingFunctionFromNode(node);
  if (!fn?.type) return false;

  try {
    const returnType = checker.getTypeFromTypeNode(fn.type);
    if (resolveTypeRewrite(returnType, checker)) return true;
  } catch (e) {
    if (isDiagnosticSuppressionAuditEnabled()) {
      console.error(`[DiagnosticSuppression] checkReturnTypeRewrite: ${e}`);
    }
    return false;
  }

  return false;
}

/**
 * Find the enclosing function-like declaration from any node.
 * Similar to `findEnclosingFunction` but starts from the node itself.
 */
function findEnclosingFunctionFromNode(
  node: ts.Node
):
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression
  | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}
