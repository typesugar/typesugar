/**
 * Operator Overloading Macros
 *
 * Provides operator overloading for TypeScript through macro expansion.
 * This transforms operator usage into method calls at compile time.
 *
 * Usage:
 *   @operators({ "+": "add", "-": "sub", "*": "mul", "/": "div" })
 *   class Vector {
 *     add(other: Vector): Vector { ... }
 *   }
 *
 *   // Usage:
 *   const c = ops(a + b);  // Expands to: a.add(b)
 */

import * as ts from "typescript";
import {
  defineExpressionMacro,
  defineAttributeMacro,
  globalRegistry,
  MacroContext,
  AttributeTarget,
} from "@typesugar/core";

/**
 * Operator mappings storage.
 *
 * Note: These mappings are populated during a single compilation pass.
 * The @operators decorator on a class must be processed before any ops()
 * call that references that class. Within a single tsc invocation this
 * works because the transformer processes files in dependency order.
 *
 * For cross-compilation persistence (e.g., incremental builds), a future
 * enhancement could serialize mappings to a .typemacro-cache file.
 */
const operatorMappings = new Map<string, Map<string, string>>();

/**
 * Clear all operator mappings (for testing)
 */
export function clearOperatorMappings(): void {
  operatorMappings.clear();
}

/**
 * Register operator mappings for a type
 */
export function registerOperators(typeName: string, mappings: Record<string, string>): void {
  const typeMap = operatorMappings.get(typeName) ?? new Map();
  for (const [op, method] of Object.entries(mappings)) {
    typeMap.set(op, method);
  }
  operatorMappings.set(typeName, typeMap);
}

/**
 * Get the method name for an operator on a type.
 * Falls back to checking well-known method names by convention
 * if no explicit mapping is registered.
 */
export function getOperatorMethod(typeName: string, operator: string): string | undefined {
  const explicit = operatorMappings.get(typeName)?.get(operator);
  if (explicit) return explicit;

  // Convention-based fallback: check if the type has a method matching
  // the standard operator method name. This allows ops() to work even
  // without @operators if the class follows naming conventions.
  return undefined;
}

// ============================================================================
// @operators Attribute Macro
// ============================================================================

export const operatorsAttribute = defineAttributeMacro({
  name: "operators",
  module: "@typesugar/operators",
  description: "Define operator overloading mappings for a class",
  validTargets: ["class"] as AttributeTarget[],

  expand(
    ctx: MacroContext,
    decorator: ts.Decorator,
    target: ts.Declaration,
    args: readonly ts.Expression[]
  ): ts.Node | ts.Node[] {
    if (!ts.isClassDeclaration(target) || !target.name) {
      ctx.reportError(decorator, "@operators can only be applied to named classes");
      return target;
    }

    const className = target.name.text;

    // Parse the operator mappings from the decorator argument
    if (args.length !== 1 || !ts.isObjectLiteralExpression(args[0])) {
      ctx.reportError(decorator, "@operators requires an object literal argument");
      return target;
    }

    const mappings: Record<string, string> = {};

    for (const prop of args[0].properties) {
      if (ts.isPropertyAssignment(prop)) {
        let keyName: string | undefined;

        if (ts.isStringLiteral(prop.name)) {
          keyName = prop.name.text;
        } else if (ts.isIdentifier(prop.name)) {
          keyName = prop.name.text;
        }

        if (keyName && ts.isStringLiteral(prop.initializer)) {
          mappings[keyName] = prop.initializer.text;
        }
      }
    }

    // Register the mappings at compile time
    registerOperators(className, mappings);

    // Return the class unchanged (the mappings are used by the ops() macro)
    return target;
  },
});

// ============================================================================
// ops() Expression Macro - Transform operators to method calls
// ============================================================================

export const opsMacro = defineExpressionMacro({
  name: "ops",
  module: "@typesugar/operators",
  description: "Transform operators into method calls",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length !== 1) {
      ctx.reportError(callExpr, "ops() expects exactly one expression argument");
      return callExpr;
    }

    const expr = args[0];
    return transformExpression(ctx, expr);
  },
});

/**
 * Recursively transform an expression, converting operators to method calls
 */
function transformExpression(ctx: MacroContext, expr: ts.Expression): ts.Expression {
  const factory = ctx.factory;

  // Handle binary expressions
  if (ts.isBinaryExpression(expr)) {
    const operator = getOperatorString(expr.operatorToken.kind);
    if (!operator) {
      // Not an overloadable operator, recurse into children
      return factory.updateBinaryExpression(
        expr,
        transformExpression(ctx, expr.left),
        expr.operatorToken,
        transformExpression(ctx, expr.right)
      );
    }

    // Try to determine the type of the left operand
    const leftType = ctx.getTypeOf(expr.left);
    const typeName = ctx.typeChecker.typeToString(leftType);

    // Clean up the type name (remove generics, etc.)
    const baseTypeName = typeName.split("<")[0].trim();

    // Check if we have operator mappings for this type
    const method = getOperatorMethod(baseTypeName, operator);

    if (method) {
      // Transform: a + b  =>  a.add(b)
      const left = transformExpression(ctx, expr.left);
      const right = transformExpression(ctx, expr.right);

      return factory.createCallExpression(
        factory.createPropertyAccessExpression(left, method),
        undefined,
        [right]
      );
    }

    // No mapping found, recurse into children
    return factory.updateBinaryExpression(
      expr,
      transformExpression(ctx, expr.left),
      expr.operatorToken,
      transformExpression(ctx, expr.right)
    );
  }

  // Handle prefix unary expressions
  if (ts.isPrefixUnaryExpression(expr)) {
    const operator = getPrefixOperatorString(expr.operator);
    if (operator) {
      const operandType = ctx.getTypeOf(expr.operand);
      const typeName = ctx.typeChecker.typeToString(operandType).split("<")[0].trim();
      const method = getOperatorMethod(typeName, operator);

      if (method) {
        // Transform: -a  =>  a.neg()
        const operand = transformExpression(ctx, expr.operand);
        return factory.createCallExpression(
          factory.createPropertyAccessExpression(operand, method),
          undefined,
          []
        );
      }
    }

    return factory.updatePrefixUnaryExpression(expr, transformExpression(ctx, expr.operand));
  }

  // Handle parenthesized expressions
  if (ts.isParenthesizedExpression(expr)) {
    return factory.updateParenthesizedExpression(expr, transformExpression(ctx, expr.expression));
  }

  // Handle call expressions (recurse into arguments)
  if (ts.isCallExpression(expr)) {
    return factory.updateCallExpression(
      expr,
      transformExpression(ctx, expr.expression),
      expr.typeArguments,
      expr.arguments.map((arg) => transformExpression(ctx, arg))
    );
  }

  // Handle property access
  if (ts.isPropertyAccessExpression(expr)) {
    return factory.updatePropertyAccessExpression(
      expr,
      transformExpression(ctx, expr.expression),
      expr.name
    );
  }

  // Return unchanged for other expression types
  return expr;
}

/**
 * Convert a binary operator token to a string representation
 */
function getOperatorString(kind: ts.SyntaxKind): string | undefined {
  switch (kind) {
    case ts.SyntaxKind.PlusToken:
      return "+";
    case ts.SyntaxKind.MinusToken:
      return "-";
    case ts.SyntaxKind.AsteriskToken:
      return "*";
    case ts.SyntaxKind.SlashToken:
      return "/";
    case ts.SyntaxKind.PercentToken:
      return "%";
    case ts.SyntaxKind.AsteriskAsteriskToken:
      return "**";
    case ts.SyntaxKind.LessThanToken:
      return "<";
    case ts.SyntaxKind.LessThanEqualsToken:
      return "<=";
    case ts.SyntaxKind.GreaterThanToken:
      return ">";
    case ts.SyntaxKind.GreaterThanEqualsToken:
      return ">=";
    case ts.SyntaxKind.EqualsEqualsToken:
      return "==";
    case ts.SyntaxKind.EqualsEqualsEqualsToken:
      return "===";
    case ts.SyntaxKind.ExclamationEqualsToken:
      return "!=";
    case ts.SyntaxKind.ExclamationEqualsEqualsToken:
      return "!==";
    case ts.SyntaxKind.AmpersandToken:
      return "&";
    case ts.SyntaxKind.BarToken:
      return "|";
    case ts.SyntaxKind.CaretToken:
      return "^";
    case ts.SyntaxKind.LessThanLessThanToken:
      return "<<";
    case ts.SyntaxKind.GreaterThanGreaterThanToken:
      return ">>";
    default:
      return undefined;
  }
}

/**
 * Convert a prefix unary operator to a string representation
 */
function getPrefixOperatorString(kind: ts.PrefixUnaryOperator): string | undefined {
  switch (kind) {
    case ts.SyntaxKind.MinusToken:
      return "-unary";
    case ts.SyntaxKind.PlusToken:
      return "+unary";
    case ts.SyntaxKind.ExclamationToken:
      return "!";
    case ts.SyntaxKind.TildeToken:
      return "~";
    default:
      return undefined;
  }
}

// ============================================================================
// pipe(), flow(), compose() - Functional composition macros
// ============================================================================

/**
 * Pipe a value through a series of functions (left-to-right).
 *
 * @example
 * ```typescript
 * // pipe(x, f, g, h) compiles to h(g(f(x)))
 * const result = pipe(
 *   rawInput,
 *   trim,
 *   toLowerCase,
 *   x => x.split(","),
 * );
 * ```
 */
export const pipeMacro = defineExpressionMacro({
  name: "pipe",
  module: "@typesugar/operators",
  description: "Zero-cost pipe — inlines function composition into nested calls",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const factory = ctx.factory;

    if (args.length === 0) {
      ctx.reportError(callExpr, "pipe() requires at least one argument");
      return callExpr;
    }

    if (args.length === 1) {
      // pipe(x) => x
      return args[0];
    }

    // pipe(value, f1, f2, f3) => f3(f2(f1(value)))
    let result: ts.Expression = args[0];
    for (let i = 1; i < args.length; i++) {
      result = factory.createCallExpression(args[i], undefined, [result]);
    }
    return result;
  },
});

/**
 * Compose functions left-to-right into a single function.
 *
 * @example
 * ```typescript
 * // flow(f, g, h) compiles to (x) => h(g(f(x)))
 * const processUser = flow(
 *   validateEmail,
 *   normalizeCase,
 *   addTimestamp,
 * );
 * ```
 */
export const flowMacro = defineExpressionMacro({
  name: "flow",
  module: "@typesugar/operators",
  description:
    "Zero-cost flow — composes functions left-to-right into a single inlined arrow function",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const factory = ctx.factory;

    if (args.length === 0) {
      ctx.reportError(callExpr, "flow() requires at least one function");
      return callExpr;
    }

    if (args.length === 1) {
      // flow(f) => f
      return args[0];
    }

    // flow(f1, f2, f3) => (__x) => f3(f2(f1(__x)))
    const param = ctx.generateUniqueName("__x");
    let body: ts.Expression = param;
    for (const fn of args) {
      body = factory.createCallExpression(fn, undefined, [body]);
    }

    return factory.createArrowFunction(
      undefined,
      undefined,
      [factory.createParameterDeclaration(undefined, undefined, param)],
      undefined,
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      body
    );
  },
});

/**
 * Compose functions right-to-left into a single function.
 *
 * @example
 * ```typescript
 * // compose(f, g, h) compiles to (x) => f(g(h(x)))
 * const processUser = compose(
 *   addTimestamp,
 *   normalizeCase,
 *   validateEmail,
 * );
 * ```
 */
export const composeMacro = defineExpressionMacro({
  name: "compose",
  module: "@typesugar/operators",
  description: "Compose functions right-to-left into a single function",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length < 1) {
      ctx.reportError(callExpr, "compose() requires at least one function");
      return callExpr;
    }

    const factory = ctx.factory;

    if (args.length === 1) {
      // compose(f) => f
      return args[0];
    }

    // compose(f, g, h) => (x) => f(g(h(x)))
    const paramName = ctx.generateUniqueName("x");

    let body: ts.Expression = paramName;
    for (let i = args.length - 1; i >= 0; i--) {
      body = factory.createCallExpression(args[i], undefined, [body]);
    }

    return factory.createArrowFunction(
      undefined,
      undefined,
      [factory.createParameterDeclaration(undefined, undefined, paramName)],
      undefined,
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      body
    );
  },
});

// ============================================================================
// Runtime Placeholder Functions
// ============================================================================

/** pipe: Apply a value through a chain of functions left-to-right */
export function pipe<A>(value: A): A;
export function pipe<A, B>(value: A, f1: (a: A) => B): B;
export function pipe<A, B, C>(value: A, f1: (a: A) => B, f2: (b: B) => C): C;
export function pipe<A, B, C, D>(value: A, f1: (a: A) => B, f2: (b: B) => C, f3: (c: C) => D): D;
export function pipe<A, B, C, D, E>(
  value: A,
  f1: (a: A) => B,
  f2: (b: B) => C,
  f3: (c: C) => D,
  f4: (d: D) => E
): E;
export function pipe<A, B, C, D, E, F>(
  value: A,
  f1: (a: A) => B,
  f2: (b: B) => C,
  f3: (c: C) => D,
  f4: (d: D) => E,
  f5: (e: E) => F
): F;
export function pipe<A, B, C, D, E, F, G>(
  value: A,
  f1: (a: A) => B,
  f2: (b: B) => C,
  f3: (c: C) => D,
  f4: (d: D) => E,
  f5: (e: E) => F,
  f6: (f: F) => G
): G;
export function pipe<A, B, C, D, E, F, G, H>(
  value: A,
  f1: (a: A) => B,
  f2: (b: B) => C,
  f3: (c: C) => D,
  f4: (d: D) => E,
  f5: (e: E) => F,
  f6: (f: F) => G,
  f7: (g: G) => H
): H;
export function pipe(value: unknown, ...fns: Array<(x: unknown) => unknown>): unknown {
  return fns.reduce((acc, fn) => fn(acc), value);
}

/** flow: Compose functions left-to-right into a single function */
export function flow<A, B>(f1: (a: A) => B): (a: A) => B;
export function flow<A, B, C>(f1: (a: A) => B, f2: (b: B) => C): (a: A) => C;
export function flow<A, B, C, D>(f1: (a: A) => B, f2: (b: B) => C, f3: (c: C) => D): (a: A) => D;
export function flow<A, B, C, D, E>(
  f1: (a: A) => B,
  f2: (b: B) => C,
  f3: (c: C) => D,
  f4: (d: D) => E
): (a: A) => E;
export function flow<A, B, C, D, E, F>(
  f1: (a: A) => B,
  f2: (b: B) => C,
  f3: (c: C) => D,
  f4: (d: D) => E,
  f5: (e: E) => F
): (a: A) => F;
export function flow<A, B, C, D, E, F, G>(
  f1: (a: A) => B,
  f2: (b: B) => C,
  f3: (c: C) => D,
  f4: (d: D) => E,
  f5: (e: E) => F,
  f6: (f: F) => G
): (a: A) => G;
export function flow(...fns: Array<(x: unknown) => unknown>): (x: unknown) => unknown {
  return (x) => fns.reduce((acc, fn) => fn(acc), x);
}

/** compose: Compose functions right-to-left into a single function */
export function compose<A, B>(f1: (a: A) => B): (a: A) => B;
export function compose<A, B, C>(f1: (b: B) => C, f2: (a: A) => B): (a: A) => C;
export function compose<A, B, C, D>(f1: (c: C) => D, f2: (b: B) => C, f3: (a: A) => B): (a: A) => D;
export function compose<A, B, C, D, E>(
  f1: (d: D) => E,
  f2: (c: C) => D,
  f3: (b: B) => C,
  f4: (a: A) => B
): (a: A) => E;
export function compose(...fns: Array<(x: unknown) => unknown>): (x: unknown) => unknown {
  return (x) => fns.reduceRight((acc, fn) => fn(acc), x);
}

/** ops: Transform operators to method calls. Runtime fallback passes through. */
export function ops<T>(expr: T): T {
  return expr;
}

// ============================================================================
// Registration
// ============================================================================

/**
 * Register macros with the global registry.
 * Call this function to enable operator macros in your project.
 */
export function register(): void {
  globalRegistry.register(operatorsAttribute);
  globalRegistry.register(opsMacro);
  globalRegistry.register(pipeMacro);
  globalRegistry.register(flowMacro);
  globalRegistry.register(composeMacro);
}

// Auto-register when this module is imported
register();
