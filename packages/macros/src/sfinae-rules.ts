/**
 * Built-in SFINAE Rules for @typesugar/macros
 *
 * Rule 1 (ExtensionMethodCall): Suppresses TS2339 ("Property 'X' does not exist
 * on type 'Y'") when an extension method named 'X' is resolvable for type 'Y'
 * through the standalone extension registry or import-scoped resolution.
 *
 * Rule 3 (NewtypeAssignment): Suppresses TS2322/TS2345 when a `Newtype<Base, Brand>`
 * is involved in an assignment and the other side is assignable to `Base`. Since
 * newtypes erase to their base type at runtime, these assignments are safe.
 *
 * @see PEP-011 Waves 3-4
 */

import ts from "typescript";
import type { SfinaeRule } from "@typesugar/core";
import { findStandaloneExtension } from "@typesugar/core";

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
      } catch {
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
  } catch {
    // getBaseTypeOfLiteralType may not be available in all TS versions
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
  } catch {
    return false;
  }
  if (!symbol) return false;

  let identType: ts.Type;
  try {
    identType = checker.getTypeOfSymbolAtLocation(symbol, ident);
  } catch {
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
      } catch {
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
  } catch {
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
    } catch {
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

      // Check: target is Newtype, source assignable to its base
      const targetBase = extractNewtypeBase(targetType, checker);
      if (targetBase && checker.isTypeAssignableTo(sourceType, targetBase)) {
        return true;
      }

      // Check: source is Newtype, target assignable from its base
      const sourceBase = extractNewtypeBase(sourceType, checker);
      if (sourceBase && checker.isTypeAssignableTo(sourceBase, targetType)) {
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
      } catch {
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
      } catch {
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
      } catch {
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
      } catch {
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
      } catch {
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
  } catch {
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
 * Check if a type is a `Newtype<Base, Brand>` and extract the base type.
 *
 * A Newtype is detected by the presence of a `__brand` property (the phantom
 * field declared as `readonly [__brand]: Brand`). The base type is the
 * intersection type minus the brand member — i.e., the non-brand constituent
 * of the intersection `Base & { readonly [__brand]: Brand }`.
 */
function extractNewtypeBase(type: ts.Type, _checker: ts.TypeChecker): ts.Type | undefined {
  if (!hasBrandProperty(type)) return undefined;

  // The type is an intersection: Base & { readonly [__brand]: Brand }
  // Extract the non-brand constituent(s) as the base type.
  if (type.isIntersection()) {
    const baseConstituents = type.types.filter((t) => !hasBrandProperty(t));
    if (baseConstituents.length === 1) {
      return baseConstituents[0];
    }
    if (baseConstituents.length > 1) {
      return baseConstituents[0];
    }
  }

  return undefined;
}
