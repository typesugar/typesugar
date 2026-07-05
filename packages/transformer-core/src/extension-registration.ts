/**
 * PEP-027: emit extension self-registration calls for "use extension" files.
 *
 * When a source file carries the "use extension" directive, every exported
 * function whose first parameter's type names a concrete receiver type is
 * a standalone extension method (e.g. `export function head(self: Array<T>)`).
 * At the end of the per-file transform, this appends
 * `globalThis.__typesugar_registerExtension?.({ methodName, forType })` calls
 * so the compiled dist self-registers its extensions at module load time --
 * consumers importing the compiled package (not the macro-transformed source)
 * still get standalone-extension lookup working via the runtime registry.
 */

import * as ts from "typescript";
import { hasExportModifier } from "@typesugar/core";
import { createRegistrationCall } from "@typesugar/macros";

/**
 * Extract the `forType` string from the first parameter's type annotation.
 * Returns the normalized type name, or undefined if there's no type
 * annotation or the type is a bare generic parameter (e.g. `T`, `A`).
 */
function extractForTypeFromParam(param: ts.ParameterDeclaration): string | undefined {
  let typeNode = param.type;
  if (!typeNode) return undefined;

  // Unwrap `readonly T[]` → T[]
  if (ts.isTypeOperatorNode(typeNode) && typeNode.operator === ts.SyntaxKind.ReadonlyKeyword) {
    typeNode = typeNode.type;
  }

  // Keyword types: number, string, boolean
  switch (typeNode.kind) {
    case ts.SyntaxKind.NumberKeyword:
      return "number";
    case ts.SyntaxKind.StringKeyword:
      return "string";
    case ts.SyntaxKind.BooleanKeyword:
      return "boolean";
    case ts.SyntaxKind.ObjectKeyword:
      return "object";
  }

  // Array type: T[] → "Array"
  if (ts.isArrayTypeNode(typeNode)) {
    return "Array";
  }

  // Type reference: Array<T>, Map<K,V>, Set<T>, MyType, etc.
  if (ts.isTypeReferenceNode(typeNode)) {
    const typeName = typeNode.typeName;
    if (ts.isIdentifier(typeName)) {
      const name = typeName.text;
      // Skip if this name is a type parameter on the enclosing function
      if (isTypeParamOfEnclosingFunction(param, name)) return undefined;
      return name;
    }
    if (ts.isQualifiedName(typeName)) {
      return typeName.right.text;
    }
  }

  // Union, intersection, or other complex types — skip
  return undefined;
}

/** Check if `name` is declared as a type parameter on the function that owns `param`. */
function isTypeParamOfEnclosingFunction(param: ts.ParameterDeclaration, name: string): boolean {
  const fn = param.parent;
  if (!ts.isFunctionDeclaration(fn) && !ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) {
    return false;
  }
  return fn.typeParameters?.some((tp) => tp.name.text === name) === true;
}

/**
 * For a "use extension" source file, scan its output statements for exported
 * functions and build `globalThis.__typesugar_registerExtension?.({ methodName, forType })`
 * calls so the compiled dist self-registers its extensions at module load time.
 */
export function emitExtensionRegistrations(
  factory: ts.NodeFactory,
  statements: readonly ts.Statement[]
): ts.Statement[] {
  const registrations: ts.Statement[] = [];

  for (const stmt of statements) {
    // Handle: export function foo(self: Type, ...): RetType { ... }
    if (
      ts.isFunctionDeclaration(stmt) &&
      hasExportModifier(stmt) &&
      stmt.name &&
      stmt.parameters.length > 0
    ) {
      const forType = extractForTypeFromParam(stmt.parameters[0]);
      if (forType) {
        registrations.push(createRegistrationCall(factory, stmt.name.text, forType, undefined));
      }
    }

    // Handle: export const foo = (self: Type, ...) => { ... }
    if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) &&
          decl.initializer.parameters.length > 0
        ) {
          const forType = extractForTypeFromParam(decl.initializer.parameters[0]);
          if (forType) {
            registrations.push(createRegistrationCall(factory, decl.name.text, forType, undefined));
          }
        }
      }
    }
  }

  return registrations;
}
