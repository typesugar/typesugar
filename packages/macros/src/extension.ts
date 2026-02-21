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
import type { MacroContext, ExpressionMacro, StandaloneExtensionInfo } from "@typesugar/core";
import { defineExpressionMacro, globalRegistry, TS9402, TS9403, TS9208 } from "@typesugar/core";
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
      ctx.diagnostic(TS9402).at(callExpr).emit();
      return ctx.factory.createVoidZero();
    }

    const typeNameArg = args[0];
    const namespaceArg = args[1];

    // Extract type name from string literal
    if (!ts.isStringLiteral(typeNameArg)) {
      ctx
        .diagnostic(TS9208)
        .at(typeNameArg)
        .withArgs({ macro: "registerExtensions", expected: "string literal" })
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
      ctx.diagnostic(TS9403).at(callExpr).emit();
      return ctx.factory.createVoidZero();
    }

    const typeNameArg = args[0];
    const fnArg = args[1];

    if (!ts.isStringLiteral(typeNameArg)) {
      ctx
        .diagnostic(TS9208)
        .at(typeNameArg)
        .withArgs({ macro: "registerExtension", expected: "string literal" })
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
        .diagnostic(TS9208)
        .at(fnArg)
        .withArgs({
          macro: "registerExtension",
          expected: "function identifier",
        })
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

globalRegistry.register(registerExtensionsMacro);
globalRegistry.register(registerExtensionMacro);
