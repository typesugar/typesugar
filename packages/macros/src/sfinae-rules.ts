/**
 * Built-in SFINAE Rules for @typesugar/macros
 *
 * Rule 1 (ExtensionMethodCall): Suppresses TS2339 ("Property 'X' does not exist
 * on type 'Y'") when an extension method named 'X' is resolvable for type 'Y'
 * through the standalone extension registry or import-scoped resolution.
 *
 * @see PEP-011 Wave 3
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
