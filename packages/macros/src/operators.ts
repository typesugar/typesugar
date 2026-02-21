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
  TS9201,
  TS9203,
  TS9208,
  TS9215,
  TS9216,
  TS9802,
  TS9803,
} from "@typesugar/core";
import { MacroContext, AttributeTarget } from "@typesugar/core";
import { getSyntaxForOperator, findInstance } from "./typeclass.js";

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
 * Method-level operator mappings storage.
 * Maps type name -> operator symbol -> method name
 * Populated by @operator decorator on class methods.
 */
const methodOperatorMappings = new Map<string, Map<string, string>>();

/**
 * Custom operators handled by the preprocessor (not valid TypeScript syntax).
 * These must NOT be used with @operator - they go through __binop__ directly.
 */
const PREPROCESSOR_OPERATORS = new Set(["|>", "::", "<|"]);

/**
 * Clear all operator mappings (for testing)
 */
export function clearOperatorMappings(): void {
  operatorMappings.clear();
  methodOperatorMappings.clear();
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
 * Register a method-level operator mapping for a type.
 * Used by @operator decorator on class methods.
 */
export function registerMethodOperator(
  typeName: string,
  operator: string,
  methodName: string
): void {
  const typeMap = methodOperatorMappings.get(typeName) ?? new Map();
  typeMap.set(operator, methodName);
  methodOperatorMappings.set(typeName, typeMap);
}

/**
 * Get the method name for an operator on a type.
 * Falls back to checking well-known method names by convention
 * if no explicit mapping is registered.
 */
export function getOperatorMethod(typeName: string, operator: string): string | undefined {
  // Check method-level operators first (@operator decorator)
  const methodOp = methodOperatorMappings.get(typeName)?.get(operator);
  if (methodOp) return methodOp;

  // Check class-level operators (@operators decorator)
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
  module: "@typesugar/macros",
  description: "Define operator overloading mappings for a class",
  validTargets: ["class"] as AttributeTarget[],

  expand(
    ctx: MacroContext,
    decorator: ts.Decorator,
    target: ts.Declaration,
    args: readonly ts.Expression[]
  ): ts.Node | ts.Node[] {
    if (!ts.isClassDeclaration(target) || !target.name) {
      ctx
        .diagnostic(TS9203)
        .at(decorator)
        .withArgs({ decorator: "operators", validTargets: "named classes" })
        .emit();
      return target;
    }

    const className = target.name.text;

    // Parse the operator mappings from the decorator argument
    if (args.length !== 1 || !ts.isObjectLiteralExpression(args[0])) {
      ctx
        .diagnostic(TS9208)
        .at(decorator)
        .withArgs({ macro: "@operators", expected: "object literal" })
        .emit();
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
// @operator Method Decorator - Mark a method as an operator implementation
// ============================================================================

export const operatorMethodAttribute = defineAttributeMacro({
  name: "operator",
  module: "@typesugar/macros",
  description: "Mark a method as implementing a custom operator",
  validTargets: ["method"] as AttributeTarget[],

  expand(
    ctx: MacroContext,
    decorator: ts.Decorator,
    target: ts.Declaration,
    args: readonly ts.Expression[]
  ): ts.Node | ts.Node[] {
    if (!ts.isMethodDeclaration(target) || !target.name) {
      ctx
        .diagnostic(TS9203)
        .at(decorator)
        .withArgs({ decorator: "operator", validTargets: "named methods" })
        .emit();
      return target;
    }

    // Get the operator symbol from the decorator argument
    if (args.length !== 1 || !ts.isStringLiteral(args[0])) {
      ctx
        .diagnostic(TS9208)
        .at(decorator)
        .withArgs({ macro: "@operator", expected: "string literal" })
        .help('Example: @operator("===")')
        .emit();
      return target;
    }

    const operatorSymbol = args[0].text;

    // Reject preprocessor-handled operators - these must use typeclass instances
    if (PREPROCESSOR_OPERATORS.has(operatorSymbol)) {
      ctx.diagnostic(TS9802).at(decorator).withArgs({ operator: operatorSymbol }).emit();
      return target;
    }

    const methodName = ts.isIdentifier(target.name) ? target.name.text : target.name.getText();

    // Find the containing class
    const parent = target.parent;
    if (!ts.isClassDeclaration(parent) || !parent.name) {
      ctx.diagnostic(TS9215).at(decorator).withArgs({ decorator: "operator" }).emit();
      return target;
    }

    const className = parent.name.text;

    // Register the operator mapping
    registerMethodOperator(className, operatorSymbol, methodName);

    // Return the method unchanged (the mapping is used by __binop__ macro)
    return target;
  },
});

// ============================================================================
// __binop__() Expression Macro - Binary operator dispatch
// ============================================================================

/**
 * The __binop__ macro is emitted by the preprocessor for custom operators.
 * It resolves to the appropriate method call based on the left operand's type.
 *
 * Resolution order:
 * 1. Check methodOperatorMappings (@operator decorator)
 * 2. Check syntaxRegistry (typeclass Op<> annotations)
 * 3. Fall back to semantic defaults (|> = pipeline, :: = cons)
 *
 * __binop__(a, "|>", f) resolves to:
 * - a.pipe(f) if the type of a has @operator('|>')
 * - TypeclassInstance.method(a, f) if a typeclass has Op<"|>"> on a method
 * - f(a) as fallback for |> (pipeline semantics)
 * - [a, ...b] as fallback for :: (cons semantics)
 */
export const binopMacro = defineExpressionMacro({
  name: "__binop__",
  module: "@typesugar/macros",
  description: "Binary operator dispatch (generated by preprocessor)",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length !== 3) {
      ctx
        .diagnostic(TS9201)
        .at(callExpr)
        .withArgs({
          macro: "__binop__",
          expected: "3",
          actual: String(args.length),
        })
        .emit();
      return callExpr;
    }

    const [left, opArg, right] = args;

    // Get the operator symbol
    if (!ts.isStringLiteral(opArg)) {
      ctx
        .diagnostic(TS9208)
        .at(callExpr)
        .withArgs({
          macro: "__binop__",
          expected: "string literal for operator",
        })
        .emit();
      return callExpr;
    }

    const operator = opArg.text;

    // Get the type of the left operand
    const leftType = ctx.getTypeOf(left);
    const typeName = ctx.typeChecker.typeToString(leftType);
    const baseTypeName = typeName.split("<")[0].trim();

    // 1. Check for a registered method operator (@operator decorator)
    const method = getOperatorMethod(baseTypeName, operator);

    if (method) {
      // Transform to method call: left.method(right)
      return ctx.factory.createCallExpression(
        ctx.factory.createPropertyAccessExpression(left, method),
        undefined,
        [right]
      );
    }

    // 2. Check syntaxRegistry for typeclass-based operator (Op<> annotation)
    const syntaxEntries = getSyntaxForOperator(operator);
    if (syntaxEntries && syntaxEntries.length > 0) {
      // Try to find a typeclass instance for the left operand's type
      for (const entry of syntaxEntries) {
        const instance = findInstance(entry.typeclass, baseTypeName);
        if (instance) {
          // Transform to: TypeclassInstance.method(left, right)
          return ctx.factory.createCallExpression(
            ctx.factory.createPropertyAccessExpression(
              ctx.factory.createIdentifier(instance.instanceName),
              entry.method
            ),
            undefined,
            [left, right]
          );
        }
      }
    }

    // 3. Default fallbacks based on operator semantics
    const factory = ctx.factory;

    switch (operator) {
      case "|>":
        // Pipeline: f(a)
        return factory.createCallExpression(right, undefined, [left]);

      case "::":
        // Cons: [head, ...tail]
        return factory.createArrayLiteralExpression([left, factory.createSpreadElement(right)]);

      case "<|":
        // Reverse pipeline: f(a) but arguments flipped
        return factory.createCallExpression(left, undefined, [right]);

      default:
        // Unknown operator - leave as is (will fail at runtime)
        ctx.diagnostic(TS9803).at(callExpr).withArgs({ operator }).emit();
        return callExpr;
    }
  },
});

// ============================================================================
// ops() Expression Macro - Transform operators to method calls
// ============================================================================

export const opsMacro = defineExpressionMacro({
  name: "ops",
  module: "@typesugar/macros",
  description: "Transform operators into method calls",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length !== 1) {
      ctx
        .diagnostic(TS9201)
        .at(callExpr)
        .withArgs({ macro: "ops", expected: "1", actual: String(args.length) })
        .emit();
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
 * Convert a binary operator token to its string representation.
 * Covers all operators in OPERATOR_SYMBOLS.
 */
export function getOperatorString(kind: ts.SyntaxKind): string | undefined {
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
// pipe() and compose() - Functional composition macros
// ============================================================================

export const pipeMacro = defineExpressionMacro({
  name: "pipe",
  module: "@typesugar/macros",
  description: "Pipe a value through a series of functions",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length < 2) {
      ctx
        .diagnostic(TS9216)
        .at(callExpr)
        .withArgs({ macro: "pipe", min: "2" })
        .help("pipe(value, f, g, ...) applies functions left-to-right")
        .emit();
      return callExpr;
    }

    const factory = ctx.factory;

    // pipe(x, f, g, h) => h(g(f(x)))
    let result = args[0];

    for (let i = 1; i < args.length; i++) {
      result = factory.createCallExpression(args[i], undefined, [result]);
    }

    return result;
  },
});

export const composeMacro = defineExpressionMacro({
  name: "compose",
  module: "@typesugar/macros",
  description: "Compose functions right-to-left",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length < 1) {
      ctx
        .diagnostic(TS9216)
        .at(callExpr)
        .withArgs({ macro: "compose", min: "1" })
        .help("compose(f, g, ...) creates x => f(g(...(x)))")
        .emit();
      return callExpr;
    }

    const factory = ctx.factory;

    // compose(f, g, h) => (x) => f(g(h(x)))
    // Generate: (x) => f(g(h(x)))

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

// Register macros
globalRegistry.register(operatorsAttribute);
globalRegistry.register(operatorMethodAttribute);
globalRegistry.register(binopMacro);
globalRegistry.register(opsMacro);
globalRegistry.register(pipeMacro);
globalRegistry.register(composeMacro);
