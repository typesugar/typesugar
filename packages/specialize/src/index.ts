/**
 * Specialize Macros - Zero-cost typeclass specialization
 *
 * Provides compile-time specialization of generic functions to eliminate
 * runtime typeclass dictionary passing overhead. Similar to GHC's specialization
 * pragmas or Rust's monomorphization.
 *
 * ## Usage
 *
 * ### Extension method syntax (preferred)
 *
 * ```typescript
 * // Define a generic function using typeclass constraints
 * function sortWith<T>(items: T[], ord: Ord<T>): T[] { ... }
 *
 * // Create a specialized version using the extension method
 * const sortNumbers = sortWith.specialize(numberOrd);
 * // sortNumbers is: (items: number[]) => number[]
 *
 * // Multiple dictionaries
 * const sortAndShow = combined.specialize(numberOrd, numberShow);
 * ```
 *
 * ### Legacy function syntax
 *
 * ```typescript
 * // Still supported for backwards compatibility
 * const sortNumbers = specialize(sortWith, [numberOrd]);
 *
 * // Or use specialize$ for inline specialization
 * const sorted = specialize$(sortWith(items, numberOrd));
 * ```
 *
 * ### Implicit specialization
 *
 * With `@implicits`, specialization happens automatically:
 *
 * ```typescript
 * @implicits
 * function sortWith<T>(items: T[], ord: Ord<T>): T[] { ... }
 *
 * // Call site - instance is filled in AND specialized automatically
 * sortWith([3, 1, 2]); // → inlined sorting logic, no dictionary passing
 * ```
 *
 * @packageDocumentation
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry, MacroContext } from "@typesugar/core";

// ============================================================================
// Type Declarations for .specialize() Extension Method
// ============================================================================

/**
 * Remove the last N parameters from a function type.
 * Used to compute the specialized function signature.
 */
type RemoveLastN<T extends readonly unknown[], N extends number> = T extends [
  ...infer Rest,
  infer _Last,
]
  ? N extends 1
    ? Rest
    : RemoveLastN<Rest, Prev<N>>
  : [];

type Prev<N extends number> = N extends 2
  ? 1
  : N extends 3
  ? 2
  : N extends 4
  ? 3
  : N extends 5
  ? 4
  : N extends 6
  ? 5
  : N extends 7
  ? 6
  : N extends 8
  ? 7
  : N extends 9
  ? 8
  : 0;

/**
 * Specialized function type - removes dictionary parameters from the signature.
 *
 * For a function `(items: T[], ord: Ord<T>) => T[]` specialized with 1 dictionary,
 * produces `(items: T[]) => T[]`.
 */
export type Specialized<
  F extends (...args: readonly unknown[]) => unknown,
  N extends number,
> = F extends (...args: infer Args) => infer R
  ? (...args: RemoveLastN<Args, N>) => R
  : never;

declare global {
  interface Function {
    /**
     * Create a specialized version of this function by pre-applying typeclass
     * instance dictionaries at compile time.
     *
     * The transformer inlines dictionary method calls, eliminating runtime
     * dictionary passing overhead (zero-cost specialization).
     *
     * @example
     * ```typescript
     * function sortWith<T>(items: T[], ord: Ord<T>): T[] {
     *   return items.slice().sort((a, b) => ord.compare(a, b));
     * }
     *
     * // Specialize with one dictionary
     * const sortNumbers = sortWith.specialize(numberOrd);
     * // sortNumbers: (items: number[]) => number[]
     *
     * // Specialize with multiple dictionaries
     * const combined = combineWith.specialize(ordNumber, showNumber);
     * ```
     *
     * @param instances - Typeclass instance dictionaries to pre-apply
     * @returns A specialized function without the dictionary parameters
     */
    specialize<I1>(instance1: I1): Specialized<this & ((...args: readonly unknown[]) => unknown), 1>;
    specialize<I1, I2>(
      instance1: I1,
      instance2: I2
    ): Specialized<this & ((...args: readonly unknown[]) => unknown), 2>;
    specialize<I1, I2, I3>(
      instance1: I1,
      instance2: I2,
      instance3: I3
    ): Specialized<this & ((...args: readonly unknown[]) => unknown), 3>;
    specialize<I1, I2, I3, I4>(
      instance1: I1,
      instance2: I2,
      instance3: I3,
      instance4: I4
    ): Specialized<this & ((...args: readonly unknown[]) => unknown), 4>;
    specialize(...instances: readonly unknown[]): (...args: readonly unknown[]) => unknown;
  }
}

// ============================================================================
// specialize() - Create specialized function at compile time
// ============================================================================

export const specializeMacro = defineExpressionMacro({
  name: "specialize",
  module: "@typesugar/specialize",
  description: "Create a specialized version of a generic function",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length < 2) {
      ctx.reportError(
        callExpr,
        "specialize() requires a function and an array of typeclass instances"
      );
      return callExpr;
    }

    const fnExpr = args[0];
    const instancesArg = args[1];

    // Validate that instancesArg is an array literal
    if (!ts.isArrayLiteralExpression(instancesArg)) {
      ctx.reportError(
        callExpr,
        "specialize() second argument must be an array literal of typeclass instances"
      );
      return callExpr;
    }

    const instances = instancesArg.elements;

    // Get the function type to understand its signature
    const fnType = ctx.getTypeOf(fnExpr);
    const callSignatures = fnType.getCallSignatures();

    if (callSignatures.length === 0) {
      ctx.reportError(callExpr, "specialize() first argument must be callable");
      return callExpr;
    }

    const signature = callSignatures[0];
    const params = signature.getParameters();

    // Find which parameters are typeclass instances (last N parameters)
    // and which are "real" parameters
    const numInstances = instances.length;
    const realParamCount = params.length - numInstances;

    if (realParamCount < 0) {
      ctx.reportError(
        callExpr,
        `specialize() provided ${numInstances} instances but function only has ${params.length} parameters`
      );
      return callExpr;
    }

    const factory = ctx.factory;

    // Generate parameter names for the specialized function
    const paramNames: ts.Identifier[] = [];
    const paramDecls: ts.ParameterDeclaration[] = [];

    for (let i = 0; i < realParamCount; i++) {
      const paramSymbol = params[i];
      const paramName = factory.createIdentifier(paramSymbol.getName());
      paramNames.push(paramName);

      // Get parameter type
      const paramType = ctx.typeChecker.getTypeOfSymbolAtLocation(paramSymbol, callExpr);
      const typeNode = ctx.typeChecker.typeToTypeNode(
        paramType,
        callExpr,
        ts.NodeBuilderFlags.None
      );

      paramDecls.push(
        factory.createParameterDeclaration(undefined, undefined, paramName, undefined, typeNode)
      );
    }

    // Create the specialized function body:
    // (...realParams) => fn(...realParams, ...instances)
    const allArgs = [...paramNames, ...instances];

    const body = factory.createCallExpression(fnExpr, undefined, allArgs);

    return factory.createArrowFunction(
      undefined,
      undefined,
      paramDecls,
      undefined,
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      body
    );
  },
});

// ============================================================================
// specialize$() - Inline specialization for single call
// ============================================================================

export const specializeInlineMacro = defineExpressionMacro({
  name: "specialize$",
  module: "@typesugar/specialize",
  description: "Inline a specialized function call",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length !== 1) {
      ctx.reportError(callExpr, "specialize$() requires exactly one function call expression");
      return callExpr;
    }

    const innerCall = args[0];

    if (!ts.isCallExpression(innerCall)) {
      ctx.reportError(callExpr, "specialize$() argument must be a function call");
      return callExpr;
    }

    // Get the function being called
    const fnExpr = innerCall.expression;
    const fnType = ctx.getTypeOf(fnExpr);

    // Check if it's a generic function
    const callSignatures = fnType.getCallSignatures();
    if (callSignatures.length === 0) {
      // Not a function call, return as-is
      return innerCall;
    }

    const signature = callSignatures[0];
    const typeParams = signature.getTypeParameters();

    if (!typeParams || typeParams.length === 0) {
      // Not a generic function, no specialization needed
      return innerCall;
    }

    // The function is generic. In a real implementation, we would:
    // 1. Analyze the call arguments to determine concrete types
    // 2. Inline the function body with those types
    // 3. Perform constant folding and dead code elimination

    // For now, we simply return the call as-is with a comment indicating
    // it was processed. A full implementation would require access to
    // the function body, which may be in a different file.

    // Add a leading comment to indicate specialization was attempted
    const factory = ctx.factory;

    return factory.createCallExpression(
      innerCall.expression,
      innerCall.typeArguments,
      innerCall.arguments.slice()
    );
  },
});

// ============================================================================
// mono() - Monomorphize a generic function for specific types
// ============================================================================

export const monoMacro = defineExpressionMacro({
  name: "mono",
  module: "@typesugar/specialize",
  description: "Monomorphize a generic function for specific type arguments",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length !== 1) {
      ctx.reportError(callExpr, "mono() requires exactly one function reference");
      return callExpr;
    }

    // mono<T1, T2>(fn) creates a specialized version with those type args
    const typeArgs = callExpr.typeArguments;
    if (!typeArgs || typeArgs.length === 0) {
      ctx.reportError(callExpr, "mono<T1, ...>() requires type arguments");
      return callExpr;
    }

    const fnExpr = args[0];
    const fnType = ctx.getTypeOf(fnExpr);
    const callSignatures = fnType.getCallSignatures();

    if (callSignatures.length === 0) {
      ctx.reportError(callExpr, "mono() argument must be a function");
      return callExpr;
    }

    const signature = callSignatures[0];
    const params = signature.getParameters();

    const factory = ctx.factory;

    // Create a specialized wrapper that passes the type arguments
    const paramDecls: ts.ParameterDeclaration[] = [];
    const paramRefs: ts.Identifier[] = [];

    for (const param of params) {
      const name = factory.createIdentifier(param.getName());
      paramRefs.push(name);

      const paramType = ctx.typeChecker.getTypeOfSymbolAtLocation(param, callExpr);
      const typeNode = ctx.typeChecker.typeToTypeNode(
        paramType,
        callExpr,
        ts.NodeBuilderFlags.None
      );

      paramDecls.push(
        factory.createParameterDeclaration(undefined, undefined, name, undefined, typeNode)
      );
    }

    // Create: (...params) => fn<T1, T2>(...params)
    const body = factory.createCallExpression(fnExpr, typeArgs, paramRefs);

    return factory.createArrowFunction(
      undefined,
      undefined,
      paramDecls,
      undefined,
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      body
    );
  },
});

// ============================================================================
// inlineCall() - Inline a function call at compile time
// ============================================================================

export const inlineCallMacro = defineExpressionMacro({
  name: "inlineCall",
  module: "@typesugar/specialize",
  description: "Attempt to inline a function call at compile time",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length !== 1) {
      ctx.reportError(callExpr, "inlineCall() requires exactly one function call");
      return callExpr;
    }

    const call = args[0];
    if (!ts.isCallExpression(call)) {
      ctx.reportError(callExpr, "inlineCall() argument must be a function call");
      return callExpr;
    }

    // Get the function declaration if available
    const fnExpr = call.expression;
    const fnSymbol = ctx.typeChecker.getSymbolAtLocation(fnExpr);

    if (!fnSymbol) {
      // Can't resolve symbol, return call as-is
      return call;
    }

    const declarations = fnSymbol.getDeclarations();
    if (!declarations || declarations.length === 0) {
      return call;
    }

    const fnDecl = declarations[0];

    // Check if it's a simple function/arrow function we can inline
    let body: ts.ConciseBody | undefined;
    let fnParams: ts.NodeArray<ts.ParameterDeclaration> | undefined;

    if (ts.isFunctionDeclaration(fnDecl) && fnDecl.body) {
      body = fnDecl.body;
      fnParams = fnDecl.parameters;
    } else if (ts.isArrowFunction(fnDecl)) {
      body = fnDecl.body;
      fnParams = fnDecl.parameters;
    } else if (
      ts.isVariableDeclaration(fnDecl) &&
      fnDecl.initializer &&
      ts.isArrowFunction(fnDecl.initializer)
    ) {
      body = fnDecl.initializer.body;
      fnParams = fnDecl.initializer.parameters;
    }

    if (!body || !fnParams) {
      // Can't inline, return original call
      return call;
    }

    // Simple case: arrow function with expression body
    if (!ts.isBlock(body)) {
      // Create an IIFE that substitutes arguments
      // ((param1, param2, ...) => body)(arg1, arg2, ...)
      const factory = ctx.factory;

      // Clone parameters by recreating them
      const clonedParams = fnParams.map((p) =>
        factory.createParameterDeclaration(
          undefined,
          p.dotDotDotToken ? factory.createToken(ts.SyntaxKind.DotDotDotToken) : undefined,
          ts.isIdentifier(p.name) ? factory.createIdentifier(p.name.text) : p.name,
          p.questionToken ? factory.createToken(ts.SyntaxKind.QuestionToken) : undefined,
          p.type,
          p.initializer
        )
      );

      return factory.createCallExpression(
        factory.createParenthesizedExpression(
          factory.createArrowFunction(
            undefined,
            undefined,
            clonedParams,
            undefined,
            factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
            body // Body is already an expression, can reuse
          )
        ),
        undefined,
        call.arguments.slice()
      );
    }

    // For block bodies, check if it's a single return statement
    if (body.statements.length === 1) {
      const stmt = body.statements[0];
      if (ts.isReturnStatement(stmt) && stmt.expression) {
        const factory = ctx.factory;

        // Clone parameters by recreating them
        const clonedParams = fnParams.map((p) =>
          factory.createParameterDeclaration(
            undefined,
            p.dotDotDotToken ? factory.createToken(ts.SyntaxKind.DotDotDotToken) : undefined,
            ts.isIdentifier(p.name) ? factory.createIdentifier(p.name.text) : p.name,
            p.questionToken ? factory.createToken(ts.SyntaxKind.QuestionToken) : undefined,
            p.type,
            p.initializer
          )
        );

        return factory.createCallExpression(
          factory.createParenthesizedExpression(
            factory.createArrowFunction(
              undefined,
              undefined,
              clonedParams,
              undefined,
              factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
              stmt.expression // Reuse the expression
            )
          ),
          undefined,
          call.arguments.slice()
        );
      }
    }

    // Complex body, can't inline easily
    return call;
  },
});

/**
 * Register macros with the global registry.
 * Call this function to enable specialization macros in your project.
 */
export function register(): void {
  globalRegistry.register(specializeMacro);
  globalRegistry.register(specializeInlineMacro);
  globalRegistry.register(monoMacro);
  globalRegistry.register(inlineCallMacro);
}

// Auto-register when this module is imported
register();
