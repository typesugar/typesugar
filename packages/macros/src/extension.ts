/**
 * Standalone Extension Methods for Concrete Types
 *
 * Scala 3 has two extension mechanisms:
 * 1. Typeclass-derived extensions (e.g., Show[A] adds .show() to any A with an instance)
 * 2. Standalone extensions on concrete types (e.g., `extension (n: Int) def isEven = ...`)
 *
 * typesugar's typeclass system handles (1). This module handles (2): enriching concrete
 * types with methods that don't go through typeclass instance resolution.
 *
 * The rewrite is simpler than typeclass extensions — there's no summon/instance
 * lookup, just a direct call to the registered function.
 *
 * Usage:
 *   registerExtensions("number", NumberExt);
 *   extend(42).clamp(0, 100)  // → NumberExt.clamp(42, 0, 100)
 *
 *   registerExtension("number", clamp);
 *   extend(42).clamp(0, 100)  // → clamp(42, 0, 100)
 */

import ts from "typescript";
import type {
  MacroContext,
  ExpressionMacro,
  AttributeMacro,
  StandaloneExtensionInfo,
} from "@typesugar/core";
import { defineExpressionMacro, defineAttributeMacro } from "@typesugar/core";
import { globalRegistry } from "@typesugar/core";
import { TS9206, TS9402, TS9403, hasExportModifier } from "@typesugar/core";
import {
  standaloneExtensionRegistry,
  registerStandaloneExtensionEntry,
  findStandaloneExtension,
  getStandaloneExtensionsForType,
  getAllStandaloneExtensions,
  buildStandaloneExtensionCall,
} from "@typesugar/core";

// Re-export from core for backwards compatibility
export type { StandaloneExtensionInfo } from "@typesugar/core";
export {
  standaloneExtensionRegistry,
  registerStandaloneExtensionEntry,
  findStandaloneExtension,
  getStandaloneExtensionsForType,
  getAllStandaloneExtensions,
  buildStandaloneExtensionCall,
} from "@typesugar/core";

// ============================================================================
// @extension — attribute macro for marking functions as extension methods
// ============================================================================
//
// Usage:
//   @extension
//   export function head<A>(arr: readonly A[]): A | undefined { return arr[0]; }
//
// The @extension decorator marks a function as an extension method.
// The first parameter type determines which types can use this as a method.
// This is a metadata-only decorator — the function is returned unchanged.
//
// For namespaces:
//   @extension
//   namespace ArrayExt { ... }
//
// Registers all callable properties as extension methods.
// ============================================================================

export const extensionAttribute: AttributeMacro = defineAttributeMacro({
  name: "extension",
  module: "typesugar",
  cacheable: true,
  description: "Mark a function as an extension method (first param becomes receiver)",
  validTargets: ["function", "property"],

  expand(
    ctx: MacroContext,
    _decorator: ts.Decorator,
    target: ts.Declaration,
    _args: readonly ts.Expression[]
  ): ts.Node | ts.Node[] {
    // Handle function declarations
    if (ts.isFunctionDeclaration(target)) {
      const name = target.name?.text;
      if (!name) {
        ctx
          .diagnostic(TS9206)
          .at(target)
          .withArgs({ macro: "@extension" })
          .help("Give the function a name: @extension function myMethod(...) { ... }")
          .emit();
        return target;
      }

      const params = target.parameters;
      if (params.length === 0) {
        ctx
          .diagnostic(TS9206)
          .at(target)
          .withArgs({ macro: "@extension" })
          .note("Extension functions use the first parameter as the receiver type")
          .help(`Add a receiver parameter: function ${name}(self: MyType, ...) { ... }`)
          .emit();
        return target;
      }

      // Get the first parameter's type
      const firstParam = params[0];
      let forType: string;

      if (firstParam.type) {
        // Use the type annotation if present
        forType = getBaseTypeName(ctx, firstParam.type);
      } else {
        // Try to infer from type checker
        const paramType = ctx.typeChecker.getTypeAtLocation(firstParam);
        forType = ctx.typeChecker.typeToString(paramType);
      }

      // Register at compile time (for same-file usage)
      registerStandaloneExtensionEntry({
        methodName: name,
        forType,
        qualifier: undefined,
      });

      // Emit registration call in output so it persists in dist
      // (only for exported functions — internal ones don't need runtime registration)
      if (hasExportModifier(target)) {
        const regCall = createRegistrationCall(ctx.factory, name, forType, undefined);
        return [target, regCall];
      }
      return target;
    }

    // Handle variable declarations (const fn = ...)
    if (ts.isVariableDeclaration(target)) {
      const name = ts.isIdentifier(target.name) ? target.name.text : undefined;
      if (!name) {
        ctx.reportError(target, "@extension variable must have an identifier name");
        return target;
      }

      // Get the type of the variable
      const varType = ctx.typeChecker.getTypeAtLocation(target);
      const callSignatures = varType.getCallSignatures();

      if (callSignatures.length === 0) {
        ctx.reportError(target, "@extension variable must be a function");
        return target;
      }

      const firstSignature = callSignatures[0];
      const params = firstSignature.getParameters();

      if (params.length === 0) {
        ctx.reportError(
          target,
          "@extension function must have at least one parameter (the receiver type)"
        );
        return target;
      }

      // Get the first parameter's type
      const firstParam = params[0];
      const paramType = ctx.typeChecker.getTypeOfSymbolAtLocation(firstParam, target);
      const forType = ctx.typeChecker.typeToString(paramType);

      registerStandaloneExtensionEntry({
        methodName: name,
        forType,
        qualifier: undefined,
      });

      return target;
    }

    // Handle module (namespace) declarations
    if (ts.isModuleDeclaration(target) && target.body && ts.isModuleBlock(target.body)) {
      const namespaceName = target.name.text;

      // Enumerate all exported functions in the namespace
      for (const stmt of target.body.statements) {
        if (ts.isFunctionDeclaration(stmt) && stmt.name && hasExportModifier(stmt)) {
          const fnName = stmt.name.text;
          const params = stmt.parameters;

          if (params.length === 0) continue;

          const firstParam = params[0];
          let forType: string;

          if (firstParam.type) {
            forType = getBaseTypeName(ctx, firstParam.type);
          } else {
            const paramType = ctx.typeChecker.getTypeAtLocation(firstParam);
            forType = ctx.typeChecker.typeToString(paramType);
          }

          registerStandaloneExtensionEntry({
            methodName: fnName,
            forType,
            qualifier: namespaceName,
          });
        }
      }

      // Emit runtime registration calls for exported namespaces so the
      // extension registry persists in the dist output.
      if (hasExportModifier(target)) {
        const regCalls: ts.Statement[] = [];
        for (const stmt of target.body.statements) {
          if (ts.isFunctionDeclaration(stmt) && stmt.name && hasExportModifier(stmt)) {
            const fnName = stmt.name.text;
            const params = stmt.parameters;
            if (params.length === 0) continue;

            const firstParam = params[0];
            let forType: string;
            if (firstParam.type) {
              forType = getBaseTypeName(ctx, firstParam.type);
            } else {
              const paramType = ctx.typeChecker.getTypeAtLocation(firstParam);
              forType = ctx.typeChecker.typeToString(paramType);
            }

            regCalls.push(createRegistrationCall(ctx.factory, fnName, forType, namespaceName));
          }
        }
        if (regCalls.length > 0) {
          return [target, ...regCalls];
        }
      }

      return target;
    }

    ctx.reportError(
      target,
      "@extension can only be applied to functions, arrow function variables, or namespaces"
    );
    return target;
  },
});

/**
 * Extract the base type name from a TypeNode, stripping generics and array brackets.
 */
function getBaseTypeName(ctx: MacroContext, typeNode: ts.TypeNode): string {
  // Handle arrays: A[] or Array<A> -> base element type for registration
  if (ts.isArrayTypeNode(typeNode)) {
    return "Array";
  }

  if (ts.isTypeReferenceNode(typeNode)) {
    const typeName = typeNode.typeName;
    if (ts.isIdentifier(typeName)) {
      // Handle Array<T> -> "Array"
      if (typeName.text === "Array" || typeName.text === "ReadonlyArray") {
        return "Array";
      }
      return typeName.text;
    }
    // Qualified name (e.g., Foo.Bar)
    return typeName.getText();
  }

  // For other types, use type checker
  const type = ctx.typeChecker.getTypeFromTypeNode(typeNode);
  const str = ctx.typeChecker.typeToString(type);
  // Strip generics from type string
  return str.replace(/<.*>$/, "");
}

/**
 * Create a runtime registration call statement that persists in dist.
 *
 * Emits: globalThis.__typesugar_registerExtension?.({...})
 *
 * The hook is set up by @typesugar/core at load time. Using globalThis avoids
 * needing an import in the target file (which may not import @typesugar/core).
 */
export function createRegistrationCall(
  factory: ts.NodeFactory,
  methodName: string,
  forType: string,
  qualifier: string | undefined
): ts.Statement {
  const props: ts.PropertyAssignment[] = [
    factory.createPropertyAssignment("methodName", factory.createStringLiteral(methodName)),
    factory.createPropertyAssignment("forType", factory.createStringLiteral(forType)),
  ];
  if (qualifier) {
    props.push(
      factory.createPropertyAssignment("qualifier", factory.createStringLiteral(qualifier))
    );
  }

  // globalThis.__typesugar_registerExtension?.({ methodName, forType, qualifier })
  const hook = factory.createPropertyAccessExpression(
    factory.createIdentifier("globalThis"),
    "__typesugar_registerExtension"
  );

  return factory.createExpressionStatement(
    factory.createCallChain(hook, factory.createToken(ts.SyntaxKind.QuestionDotToken), undefined, [
      factory.createObjectLiteralExpression(props, false),
    ])
  );
}

// ============================================================================
// registerExtensions — batch registration from a namespace object
// ============================================================================

export const registerExtensionsMacro: ExpressionMacro = defineExpressionMacro({
  name: "registerExtensions",
  description:
    "Register all methods of a namespace object as extension methods for a concrete type",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length < 2) {
      ctx
        .diagnostic(TS9402)
        .at(callExpr)
        .help('Usage: registerExtensions("number", NumberOps)')
        .emit();
      return ctx.factory.createVoidZero();
    }

    const typeNameArg = args[0];
    const namespaceArg = args[1];

    // Extract type name from string literal
    if (!ts.isStringLiteral(typeNameArg)) {
      ctx
        .diagnostic(TS9402)
        .at(typeNameArg)
        .note("First argument must be a string literal type name")
        .help('Usage: registerExtensions("number", NumberOps)')
        .emit();
      return ctx.factory.createVoidZero();
    }
    const forType = typeNameArg.text;

    // Get the qualifier name (the identifier used for the namespace)
    let qualifierName: string | undefined;
    if (ts.isIdentifier(namespaceArg)) {
      qualifierName = namespaceArg.text;
    }

    // Use type checker to enumerate properties of the namespace object
    const namespaceType = ctx.typeChecker.getTypeAtLocation(namespaceArg);
    const properties = namespaceType.getProperties();

    for (const prop of properties) {
      const propType = ctx.typeChecker.getTypeOfSymbolAtLocation(prop, namespaceArg);

      // Only register callable properties (functions)
      const callSignatures = propType.getCallSignatures();
      if (callSignatures.length === 0) continue;

      registerStandaloneExtensionEntry({
        methodName: prop.name,
        forType,
        qualifier: qualifierName,
      });
    }

    // Compile away to nothing
    return ctx.factory.createVoidZero();
  },
});

// ============================================================================
// registerExtension — single function registration
// ============================================================================

export const registerExtensionMacro: ExpressionMacro = defineExpressionMacro({
  name: "registerExtension",
  description: "Register a single function as an extension method for a concrete type",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length < 2) {
      ctx
        .diagnostic(TS9403)
        .at(callExpr)
        .help('Usage: registerExtension("string", capitalize)')
        .emit();
      return ctx.factory.createVoidZero();
    }

    const typeNameArg = args[0];
    const fnArg = args[1];

    if (!ts.isStringLiteral(typeNameArg)) {
      ctx
        .diagnostic(TS9403)
        .at(typeNameArg)
        .note("First argument must be a string literal type name")
        .help('Usage: registerExtension("string", capitalize)')
        .emit();
      return ctx.factory.createVoidZero();
    }
    const forType = typeNameArg.text;

    // The function name is the method name
    let methodName: string | undefined;
    if (ts.isIdentifier(fnArg)) {
      methodName = fnArg.text;
    }

    if (!methodName) {
      ctx
        .diagnostic(TS9403)
        .at(fnArg)
        .note("Second argument must be a named function identifier")
        .help('Usage: registerExtension("string", capitalize)')
        .emit();
      return ctx.factory.createVoidZero();
    }

    registerStandaloneExtensionEntry({
      methodName,
      forType,
      qualifier: undefined, // bare function call
    });

    return ctx.factory.createVoidZero();
  },
});

// ============================================================================
// Registration
// ============================================================================

globalRegistry.register(extensionAttribute);
globalRegistry.register(registerExtensionsMacro);
globalRegistry.register(registerExtensionMacro);
