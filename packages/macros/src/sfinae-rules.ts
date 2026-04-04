/**
 * Built-in SFINAE Rules for @typesugar/macros
 *
 * Rule 1 (ExtensionMethodCall): Suppresses TS2339 ("Property 'X' does not exist
 * on type 'Y'") when an extension method named 'X' is resolvable for type 'Y'
 * through the standalone extension registry or import-scoped resolution.
 *
 * Rule 2 (TypeRewriteAssignment): Suppresses TS2322/TS2345/TS2355 when a type
 * registered in the `typeRewriteRegistry` (from `@opaque`) is involved in an
 * assignment and the other side matches the registered underlying type.
 *
 * Rule 3 (NewtypeAssignment): Suppresses TS2322/TS2345 when a `Newtype<Base, Brand>`
 * is involved in an assignment and the other side is assignable to `Base`. Since
 * newtypes erase to their base type at runtime, these assignments are safe.
 *
 * @see PEP-011 Waves 3-5
 */

import ts from "typescript";
import type { SfinaeRule } from "@typesugar/core";
import {
  findStandaloneExtension,
  findTypeRewrite,
  isSfinaeAuditEnabled,
  extractTypeArgumentsContent,
  splitTopLevelTypeArgs,
} from "@typesugar/core";

/**
 * Create the ExtensionMethodCall SFINAE rule.
 *
 * Suppresses TS2339 when the "missing" property is actually an extension method
 * that the transformer will rewrite at emit time. Checks both:
 * - The standalone extension registry (from `registerExtensions` / `@extension`)
 * - Import-scoped resolution (any imported function whose name matches and whose
 *   first parameter accepts the receiver type)
 */
export function createExtensionMethodCallRule(): SfinaeRule {
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
        if (isSfinaeAuditEnabled()) {
          console.error(`[SFINAE] ExtensionMethodCall: ${e}`);
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

      return false;
    },
  };
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
    if (isSfinaeAuditEnabled()) {
      console.error(`[SFINAE] findInRegistry: ${e}`);
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
    if (isSfinaeAuditEnabled()) {
      console.error(`[SFINAE] checkImportedSymbol: ${e}`);
    }
    return false;
  }
  if (!symbol) return false;

  let identType: ts.Type;
  try {
    identType = checker.getTypeOfSymbolAtLocation(symbol, ident);
  } catch (e) {
    if (isSfinaeAuditEnabled()) {
      console.error(`[SFINAE] checkImportedSymbol: ${e}`);
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
        if (isSfinaeAuditEnabled()) {
          console.error(`[SFINAE] checkImportedSymbol: ${e}`);
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
    if (isSfinaeAuditEnabled()) {
      console.error(`[SFINAE] checkImportedSymbol: ${e}`);
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
      if (isSfinaeAuditEnabled()) {
        console.error(`[SFINAE] checkImportedSymbol: ${e}`);
      }
      continue;
    }
  }

  return false;
}

// ===========================================================================
// Rule 3: NewtypeAssignment — suppress TS2322/TS2345 for Newtype<Base, Brand>
// ===========================================================================

/**
 * Pattern matching the escaped property name of the `__brand` unique symbol.
 * TypeScript encodes unique symbol properties as `__@variableName@uniqueId`.
 * The variable `__brand` gets an extra `_` from TS's internal `__` escaping,
 * yielding `__@___brand@<digits>`.
 */
const BRAND_PROP_PATTERN = /__brand/;

/**
 * Create the NewtypeAssignment SFINAE rule.
 *
 * Suppresses TS2322 ("Type 'X' is not assignable to type 'Y'") and TS2345
 * ("Argument of type 'X' is not assignable to parameter of type 'Y'") when
 * the assignment involves a `Newtype<Base, Brand>` and the other side is
 * assignable to `Base`.
 *
 * At runtime, a `Newtype<Base, Brand>` IS just `Base` — the brand exists
 * only in the type system and is erased by the transformer. So assignments
 * like `const id: UserId = 42` are safe (where `type UserId = Newtype<number, "UserId">`).
 */
export function createNewtypeAssignmentRule(): SfinaeRule {
  return {
    name: "NewtypeAssignment",
    errorCodes: [2322, 2345],

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

      // For TS2322 the diagnostic is on the variable/property being assigned to.
      // For TS2345 the diagnostic is on the argument expression.
      // In both cases we need source and target types from the assignment context.
      const types = extractAssignmentTypes(node, checker);
      if (!types) return false;

      const { sourceType, targetType } = types;

      // Check: target is Newtype, source assignable to ALL its base constituents
      const targetBases = extractNewtypeBaseTypes(targetType);
      if (
        targetBases.length > 0 &&
        targetBases.every((base) => checker.isTypeAssignableTo(sourceType, base))
      ) {
        return true;
      }

      // Check: source is Newtype, ALL its base constituents assignable to target
      const sourceBases = extractNewtypeBaseTypes(sourceType);
      if (
        sourceBases.length > 0 &&
        sourceBases.every((base) => checker.isTypeAssignableTo(base, targetType))
      ) {
        return true;
      }

      return false;
    },
  };
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
        if (isSfinaeAuditEnabled()) {
          console.error(`[SFINAE] extractAssignmentTypes: ${e}`);
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
        if (isSfinaeAuditEnabled()) {
          console.error(`[SFINAE] extractAssignmentTypes: ${e}`);
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
        if (isSfinaeAuditEnabled()) {
          console.error(`[SFINAE] extractAssignmentTypes: ${e}`);
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
        if (isSfinaeAuditEnabled()) {
          console.error(`[SFINAE] extractAssignmentTypes: ${e}`);
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
        if (isSfinaeAuditEnabled()) {
          console.error(`[SFINAE] extractAssignmentTypes: ${e}`);
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
    if (isSfinaeAuditEnabled()) {
      console.error(`[SFINAE] matchCallArgument: ${e}`);
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

/**
 * Check if a type has the `__brand` phantom field. Since `__brand` is a
 * unique symbol, TypeScript encodes it as `__@___brand@<id>` internally.
 * We match on the escaped property name rather than using `getProperty()`.
 */
function hasBrandProperty(type: ts.Type): boolean {
  return type.getProperties().some((p) => BRAND_PROP_PATTERN.test(p.escapedName as string));
}

/**
 * Check if a type is a `Newtype<Base, Brand>` and extract all base type
 * constituents.
 *
 * A Newtype is detected by the presence of a `__brand` property (the phantom
 * field declared as `readonly [__brand]: Brand`). The base types are the
 * intersection constituents minus the brand member — e.g., for
 * `Base1 & Base2 & { readonly [__brand]: Brand }`, returns `[Base1, Base2]`.
 *
 * The caller must check assignability against ALL returned types to correctly
 * handle multi-constituent bases.
 */
function extractNewtypeBaseTypes(type: ts.Type): ts.Type[] {
  if (!hasBrandProperty(type)) return [];

  if (type.isIntersection()) {
    return type.types.filter((t) => !hasBrandProperty(t));
  }

  return [];
}

// ===========================================================================
// Rule 2: TypeRewriteAssignment — suppress TS2322/TS2345/TS2355 for @opaque
// ===========================================================================

/**
 * Create the TypeRewriteAssignment SFINAE rule.
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
export function createTypeRewriteAssignmentRule(): SfinaeRule {
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
 */
function checkTypeRewriteAssignability(
  sourceType: ts.Type,
  targetType: ts.Type,
  checker: ts.TypeChecker
): boolean {
  const targetText = checker.typeToString(targetType);
  const sourceText = checker.typeToString(sourceType);

  // Collect candidate type names for the source, including widened forms.
  // e.g., for literal type "user@test.com" we also try "string".
  const sourceTexts = collectTypeTextVariants(sourceType, sourceText, checker);
  const targetTexts = collectTypeTextVariants(targetType, targetText, checker);

  for (const st of sourceTexts) {
    for (const tt of targetTexts) {
      if (checkRewritePair(st, tt, sourceTexts, targetTexts)) {
        return true;
      }
    }
  }

  return false;
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
    if (isSfinaeAuditEnabled()) {
      console.error(`[SFINAE] collectTypeTextVariants: ${e}`);
    }
  }

  return variants;
}

/**
 * Check a single (sourceText, targetText) pair against the type rewrite registry.
 */
function checkRewritePair(
  sourceText: string,
  targetText: string,
  allSourceTexts: string[],
  allTargetTexts: string[]
): boolean {
  // Case 1: target is an opaque type, source matches its underlying
  const targetEntry = findTypeRewrite(targetText);
  if (targetEntry) {
    for (const st of allSourceTexts) {
      if (targetEntry.matchesUnderlying && targetEntry.matchesUnderlying(st)) return true;
      if (isUnderlyingMatch(st, targetEntry.underlyingTypeText)) return true;
    }
  }

  // Case 2: source is an opaque type, target matches its underlying
  const sourceEntry = findTypeRewrite(sourceText);
  if (sourceEntry) {
    for (const tt of allTargetTexts) {
      if (sourceEntry.matchesUnderlying && sourceEntry.matchesUnderlying(tt)) return true;
      if (isUnderlyingMatch(tt, sourceEntry.underlyingTypeText)) return true;
    }
  }

  // Case 3: strip generic parameters and retry (e.g., "Option<number>" → "Option")
  const targetStripped = targetText.replace(/<.*>$/, "");
  if (targetStripped !== targetText) {
    const entry = findTypeRewrite(targetStripped);
    if (entry) {
      for (const st of allSourceTexts) {
        if (entry.matchesUnderlying && entry.matchesUnderlying(st)) return true;
        if (matchesUnderlyingWithTypeArgs(st, entry.underlyingTypeText, targetText)) return true;
      }
    }
  }

  const sourceStripped = sourceText.replace(/<.*>$/, "");
  if (sourceStripped !== sourceText) {
    const entry = findTypeRewrite(sourceStripped);
    if (entry) {
      for (const tt of allTargetTexts) {
        if (entry.matchesUnderlying && entry.matchesUnderlying(tt)) return true;
        if (matchesUnderlyingWithTypeArgs(tt, entry.underlyingTypeText, sourceText)) return true;
      }
    }
  }

  return false;
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

/**
 * For generic opaque types like `Option<number>`, substitute type arguments
 * into the underlying type pattern and compare.
 *
 * e.g., opaque "Option" with underlying "T | null", instantiated as
 * "Option<number>" → underlying becomes "number | null".
 */
function matchesUnderlyingWithTypeArgs(
  candidateText: string,
  underlyingTemplate: string,
  opaqueInstantiation: string
): boolean {
  // Extract type arguments from the opaque instantiation: "Option<number>" → "number"
  const argsContent = extractTypeArgumentsContent(opaqueInstantiation);
  if (!argsContent) return false;

  const typeArgs = splitTopLevelTypeArgs(argsContent);
  if (typeArgs.length === 0) return false;

  // Simple single-parameter substitution: replace "T" with the actual type arg
  // This covers the common case like Option<T> = T | null → Option<number> = number | null
  let substituted = underlyingTemplate;
  const typeParamNames = ["T", "U", "V", "W", "A", "B", "C"];
  for (let i = 0; i < typeArgs.length && i < typeParamNames.length; i++) {
    substituted = substituted.replace(new RegExp(`\\b${typeParamNames[i]}\\b`, "g"), typeArgs[i]);
  }

  return isUnderlyingMatch(candidateText, substituted);
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
]);

/**
 * Create the MacroDecorator SFINAE rule.
 *
 * Suppresses TS1206 ("Decorators are not valid here") when the decorator is a
 * known typesugar macro. TypeScript doesn't allow decorators on interfaces or
 * type aliases, but the typesugar transformer handles them at compile time.
 */
export function createMacroDecoratorRule(): SfinaeRule {
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
// Rule 6: OperatorOverload — suppress TS2365 for @op operator overloading
// ===========================================================================

/**
 * Create the OperatorOverload SFINAE rule.
 *
 * Suppresses TS2365 ("Operator 'X' cannot be applied to types 'A' and 'B'")
 * when at least one operand is a non-primitive type. The typesugar transformer
 * rewrites operators on custom types via @typeclass @op annotations — these
 * errors are artifacts of the pre-transform source.
 */
export function createOperatorOverloadRule(): SfinaeRule {
  return {
    name: "OperatorOverload",
    errorCodes: [2365],

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

      // Walk up to find a BinaryExpression
      let current: ts.Node | undefined = node;
      for (let i = 0; i < 5 && current; i++) {
        if (ts.isBinaryExpression(current)) {
          // Suppress if either operand is a non-primitive (object/class/interface)
          // type — these are the types that @op can apply to.
          try {
            const leftType = checker.getTypeAtLocation(current.left);
            const rightType = checker.getTypeAtLocation(current.right);
            if (isObjectLikeType(leftType) || isObjectLikeType(rightType)) {
              return true;
            }
          } catch {
            return false;
          }
        }
        current = current.parent;
      }

      return false;
    },
  };
}

function isObjectLikeType(type: ts.Type): boolean {
  // Object types (classes, interfaces, object literals)
  if (type.flags & ts.TypeFlags.Object) return true;
  // Union/intersection containing object types
  if (type.isUnionOrIntersection()) {
    return type.types.some(isObjectLikeType);
  }
  return false;
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
    const returnText = checker.typeToString(returnType);

    if (findTypeRewrite(returnText)) return true;

    const stripped = returnText.replace(/<.*>$/, "");
    if (stripped !== returnText && findTypeRewrite(stripped)) return true;
  } catch (e) {
    if (isSfinaeAuditEnabled()) {
      console.error(`[SFINAE] checkReturnTypeRewrite: ${e}`);
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
