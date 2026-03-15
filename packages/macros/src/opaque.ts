/**
 * @opaque Attribute Macro (PEP-012 Wave 2)
 *
 * Registers an interface as an opaque type whose methods are erased to
 * standalone function calls at compile time.
 *
 * Usage:
 *   /** @opaque A | null *\/
 *   export interface Option<A> {
 *     map<B>(f: (a: A) => B): Option<B>;
 *     flatMap<B>(f: (a: A) => Option<B>): Option<B>;
 *   }
 *
 * The JSDoc `@opaque` tag declares the underlying runtime type. The macro:
 * 1. Parses the underlying type from the tag argument
 * 2. Scans the interface for method signatures
 * 3. Finds companion standalone functions in the same source file
 * 4. Registers a {@link TypeRewriteEntry} with methods, constructors, accessors
 *
 * @see PEP-012 — Type Macros
 * @see PEP-011 — SFINAE Diagnostic Resolution
 */

import ts from "typescript";
import type { MacroContext, AttributeMacro } from "@typesugar/core";
import { defineAttributeMacro, globalRegistry } from "@typesugar/core";
import {
  registerTypeRewrite,
  type TypeRewriteEntry,
  type ConstructorRewrite,
} from "@typesugar/core";

/**
 * Extract the `@opaque` JSDoc tag comment from an interface declaration.
 *
 * @returns The underlying type text (e.g., "A | null"), or undefined if no tag found
 */
function extractOpaqueTag(node: ts.InterfaceDeclaration): string | undefined {
  const tags = ts.getJSDocTags(node);
  for (const tag of tags) {
    if (tag.tagName.text === "opaque") {
      const comment =
        typeof tag.comment === "string" ? tag.comment : ts.getTextOfJSDocComment(tag.comment);
      return comment?.trim() || undefined;
    }
  }
  return undefined;
}

/**
 * Collect method names from an interface declaration.
 *
 * Only includes method signatures (not property signatures, index signatures, etc).
 */
function collectInterfaceMethods(iface: ts.InterfaceDeclaration): string[] {
  const methods: string[] = [];
  for (const member of iface.members) {
    if (ts.isMethodSignature(member) && member.name && ts.isIdentifier(member.name)) {
      methods.push(member.name.text);
    }
  }
  return methods;
}

/**
 * Find exported standalone functions in the same source file.
 *
 * Returns a Set of function names that are exported from the file.
 */
function findExportedFunctions(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && hasExportModifier(stmt)) {
      names.add(stmt.name.text);
    }
    if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          names.add(decl.name.text);
        }
      }
    }
  }
  return names;
}

/**
 * Determine if a standalone function is a constructor for the opaque type.
 *
 * Heuristic: a function whose return type references the interface name
 * and is NOT a method name on the interface is treated as a constructor.
 * Constructors are PascalCase by convention.
 */
function isConstructorLike(name: string): boolean {
  return name.length > 0 && name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase();
}

/**
 * Determine if an exported variable is a constant constructor (like `None`).
 *
 * Checks whether the variable's type references the opaque interface name.
 */
function isConstantForType(
  checker: ts.TypeChecker,
  decl: ts.VariableDeclaration,
  typeName: string
): boolean {
  const type = checker.getTypeAtLocation(decl);
  const typeStr = checker.typeToString(type);
  return typeStr.includes(typeName);
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}

/**
 * Find exported constants (variable declarations) whose type references the
 * opaque type name. These are treated as constant constructors (e.g., `None`).
 */
function findConstantConstructors(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  typeName: string,
  methodNames: Set<string>
): Map<string, ConstructorRewrite> {
  const constructors = new Map<string, ConstructorRewrite>();

  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt) || !hasExportModifier(stmt)) continue;

    const isConst = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;

    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      const name = decl.name.text;

      if (methodNames.has(name)) continue;
      if (!isConstructorLike(name)) continue;
      if (!isConstantForType(checker, decl, typeName)) continue;

      if (isConst && decl.initializer) {
        const initText = decl.initializer.getText();
        if (initText === "null" || initText.includes("as unknown as")) {
          constructors.set(name, {
            kind: "constant",
            value: extractConstantValue(decl.initializer),
          });
        } else {
          constructors.set(name, { kind: "constant", value: initText });
        }
      }
    }
  }

  return constructors;
}

/**
 * Extract the constant value from an initializer, stripping type assertions.
 */
function extractConstantValue(expr: ts.Expression): string {
  if (ts.isAsExpression(expr)) {
    return extractConstantValue(expr.expression);
  }
  if (ts.isParenthesizedExpression(expr)) {
    return extractConstantValue(expr.expression);
  }
  if (expr.kind === ts.SyntaxKind.NullKeyword) {
    return "null";
  }
  if (ts.isIdentifier(expr) && expr.text === "undefined") {
    return "undefined";
  }
  return expr.getText();
}

/**
 * Find exported function declarations that return the opaque type and are
 * PascalCase — treated as identity constructors (e.g., `Some`).
 */
function findFunctionConstructors(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  typeName: string,
  methodNames: Set<string>
): Map<string, ConstructorRewrite> {
  const constructors = new Map<string, ConstructorRewrite>();

  for (const stmt of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(stmt) || !stmt.name || !hasExportModifier(stmt)) continue;

    const name = stmt.name.text;
    if (methodNames.has(name)) continue;
    if (!isConstructorLike(name)) continue;

    const sig = checker.getSignatureFromDeclaration(stmt);
    if (!sig) continue;

    const returnType = checker.getReturnTypeOfSignature(sig);
    const returnTypeStr = checker.typeToString(returnType);

    if (returnTypeStr.includes(typeName)) {
      constructors.set(name, { kind: "identity" });
    }
  }

  return constructors;
}

/**
 * Resolve the source module specifier for the current file.
 *
 * Attempts to use the file's path relative to the package to construct
 * a reasonable module identifier. Falls back to the file path.
 */
function resolveSourceModule(sourceFile: ts.SourceFile): string {
  return sourceFile.fileName;
}

// ============================================================================
// @opaque — attribute macro
// ============================================================================

/**
 * The `@opaque` attribute macro for declaring opaque types.
 *
 * Applied via JSDoc on an interface declaration:
 * ```typescript
 * /** @opaque A | null *\/
 * export interface Option<A> { ... }
 * ```
 *
 * Registers a {@link TypeRewriteEntry} mapping interface methods to
 * companion standalone functions in the same file.
 */
export const opaqueAttribute: AttributeMacro = defineAttributeMacro({
  name: "opaque",
  module: "typesugar",
  cacheable: false,
  description: "Declare an opaque type with method-to-function rewriting",
  validTargets: ["interface"],

  expand(
    ctx: MacroContext,
    _decorator: ts.Decorator,
    target: ts.Declaration,
    _args: readonly ts.Expression[]
  ): ts.Node | ts.Node[] {
    if (!ts.isInterfaceDeclaration(target)) {
      ctx.reportError(target, "@opaque can only be applied to interface declarations");
      return target;
    }

    const typeName = target.name.text;

    // 1. Parse @opaque tag from JSDoc
    const underlyingTypeText = extractOpaqueTag(target);
    if (!underlyingTypeText) {
      ctx.reportError(
        target,
        `@opaque interface '${typeName}' is missing the underlying type in its JSDoc. ` +
          `Use: /** @opaque <underlying-type> */`
      );
      return target;
    }

    // 2. Collect method signatures from the interface
    const methodNames = collectInterfaceMethods(target);
    const methodNameSet = new Set(methodNames);

    // 3. Find companion functions in the same file
    const exportedFunctions = findExportedFunctions(ctx.sourceFile);

    // 4. Match interface methods to standalone functions
    const methods = new Map<string, string>();
    for (const methodName of methodNames) {
      if (exportedFunctions.has(methodName)) {
        methods.set(methodName, methodName);
      }
    }

    // 5. Find constructors (PascalCase functions/constants that return the type)
    const fnConstructors = findFunctionConstructors(
      ctx.sourceFile,
      ctx.typeChecker,
      typeName,
      methodNameSet
    );
    const constConstructors = findConstantConstructors(
      ctx.sourceFile,
      ctx.typeChecker,
      typeName,
      methodNameSet
    );
    const constructors = new Map<string, ConstructorRewrite>([
      ...fnConstructors,
      ...constConstructors,
    ]);

    // 6. Register the TypeRewriteEntry
    const entry: TypeRewriteEntry = {
      typeName,
      underlyingTypeText,
      sourceModule: resolveSourceModule(ctx.sourceFile),
      methods: methods.size > 0 ? methods : undefined,
      constructors: constructors.size > 0 ? constructors : undefined,
      accessors: undefined,
      transparent: true,
    };

    registerTypeRewrite(entry);

    // The interface declaration is returned unchanged — @opaque is metadata-only
    return target;
  },
});

// ============================================================================
// Registration
// ============================================================================

globalRegistry.register(opaqueAttribute);
