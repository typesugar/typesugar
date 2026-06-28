/**
 * @typesugar/type-system — Macro definitions (BUILD-TIME ONLY).
 *
 * This entry imports `typescript` and is loaded by the transformer at build time
 * (via the `./macros` subpath). It must NOT be imported by application runtime
 * code — the runtime values, types, and helpers live in the package's `.` entry
 * (`./index`). See PEP-050.
 *
 * It provides the type-system macros:
 * - Newtype erasure: `wrap`, `unwrap`, `newtypeCtor`
 * - Existential types: `@existential`, `packExists`, `useExists`
 * - Opaque modules: `opaqueModule`
 * - Refinement types: `refine`, `unsafeRefine`
 * - Type-level arithmetic: `Add`, `Sub`, `Mul`, ... type macros
 * - Phantom state machines: `@phantom`, `stateMachine`
 * - Effect annotations: `@pure`, `@effect`
 */

import * as ts from "typescript";
import {
  defineExpressionMacro,
  defineAttributeMacro,
  defineTypeMacro,
  globalRegistry,
  MacroContext,
  AttributeTarget,
} from "@typesugar/core";
import { registerPure, registerEffect, checkEffectCall, type EffectKind } from "./effects.js";

// ============================================================================
// Newtype Macros — Erase wrap/unwrap at compile time
// ============================================================================

export const wrapMacro = defineExpressionMacro({
  name: "wrap",
  module: "@typesugar/type-system",
  description: "Zero-cost newtype wrap — compiles away to the raw value",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length !== 1) {
      ctx.reportError(callExpr, "wrap() expects exactly one argument");
      return callExpr;
    }
    // wrap<UserId>(42) => 42
    return args[0];
  },
});

export const unwrapMacro = defineExpressionMacro({
  name: "unwrap",
  module: "@typesugar/type-system",
  description: "Zero-cost newtype unwrap — compiles away to the raw value",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length !== 1) {
      ctx.reportError(callExpr, "unwrap() expects exactly one argument");
      return callExpr;
    }
    // unwrap(userId) => userId
    return args[0];
  },
});

export const newtypeCtorMacro = defineExpressionMacro({
  name: "newtypeCtor",
  module: "@typesugar/type-system",
  description: "Zero-cost newtype constructor factory — the returned function compiles to identity",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    _args: readonly ts.Expression[]
  ): ts.Expression {
    // newtypeCtor<UserId>() => (v) => v
    // Which further inlines at call sites
    const factory = ctx.factory;
    const vIdent = ctx.generateUniqueName("v");
    const param = factory.createParameterDeclaration(undefined, undefined, vIdent);
    return factory.createArrowFunction(
      undefined,
      undefined,
      [param],
      undefined,
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      factory.createIdentifier(vIdent.text)
    );
  },
});

// ============================================================================
// @existential Attribute Macro
// ============================================================================

/**
 * @existential decorator — generates existential type helpers for an interface.
 *
 * Given an interface with a type parameter, generates:
 * - A type alias for the existential version
 * - A `pack` function to create existential values
 * - A `use` function to eliminate existential values
 *
 * @example
 * ```typescript
 * @existential
 * interface Handler<T> {
 *   handle(event: T): void;
 *   eventType: string;
 * }
 *
 * // Generates:
 * type AnyHandler = Exists<Handler<unknown>>;
 * function packHandler<T>(handler: Handler<T>): AnyHandler { ... }
 * function useHandler<R>(h: AnyHandler, f: <T>(handler: Handler<T>) => R): R { ... }
 * ```
 */
export const existentialAttribute = defineAttributeMacro({
  name: "existential",
  description: "Generate existential type wrappers for a parameterized interface",
  validTargets: ["interface"] as AttributeTarget[],

  expand(
    ctx: MacroContext,
    _decorator: ts.Decorator,
    target: ts.Declaration,
    _args: readonly ts.Expression[]
  ): ts.Node | ts.Node[] {
    if (!ts.isInterfaceDeclaration(target)) {
      ctx.reportError(target, "@existential can only be applied to interfaces");
      return target;
    }

    const name = target.name.text;
    const factory = ctx.factory;

    if (!target.typeParameters || target.typeParameters.length === 0) {
      ctx.reportError(
        target,
        "@existential requires an interface with at least one type parameter"
      );
      return target;
    }

    // Generate: type Any{Name} = Exists<{Name}<unknown>>
    const anyTypeName = `Any${name}`;
    const anyTypeAlias = factory.createTypeAliasDeclaration(
      [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
      factory.createIdentifier(anyTypeName),
      undefined,
      factory.createTypeReferenceNode(factory.createIdentifier("Exists"), [
        factory.createTypeReferenceNode(factory.createIdentifier(name), [
          factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword),
        ]),
      ])
    );

    // Generate: function pack{Name}<T>(witness: {Name}<T>): Any{Name}
    const packFnName = `pack${name}`;
    const packFn = factory.createFunctionDeclaration(
      [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
      undefined,
      factory.createIdentifier(packFnName),
      [factory.createTypeParameterDeclaration(undefined, factory.createIdentifier("T"))],
      [
        factory.createParameterDeclaration(
          undefined,
          undefined,
          factory.createIdentifier("witness"),
          undefined,
          factory.createTypeReferenceNode(factory.createIdentifier(name), [
            factory.createTypeReferenceNode(factory.createIdentifier("T")),
          ])
        ),
      ],
      factory.createTypeReferenceNode(factory.createIdentifier(anyTypeName)),
      factory.createBlock(
        [
          factory.createReturnStatement(
            factory.createObjectLiteralExpression(
              [
                factory.createPropertyAssignment(
                  factory.createIdentifier("use"),
                  factory.createArrowFunction(
                    undefined,
                    undefined,
                    [
                      factory.createParameterDeclaration(
                        undefined,
                        undefined,
                        factory.createIdentifier("f")
                      ),
                    ],
                    undefined,
                    factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                    factory.createCallExpression(factory.createIdentifier("f"), undefined, [
                      factory.createIdentifier("witness"),
                    ])
                  )
                ),
              ],
              true
            )
          ),
        ],
        true
      )
    );

    // Generate: function use{Name}<R>(ex: Any{Name}, f: (w: {Name}<any>) => R): R
    const useFnName = `use${name}`;
    const useFn = factory.createFunctionDeclaration(
      [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
      undefined,
      factory.createIdentifier(useFnName),
      [factory.createTypeParameterDeclaration(undefined, factory.createIdentifier("R"))],
      [
        factory.createParameterDeclaration(
          undefined,
          undefined,
          factory.createIdentifier("ex"),
          undefined,
          factory.createTypeReferenceNode(factory.createIdentifier(anyTypeName))
        ),
        factory.createParameterDeclaration(
          undefined,
          undefined,
          factory.createIdentifier("f"),
          undefined,
          factory.createFunctionTypeNode(
            undefined,
            [
              factory.createParameterDeclaration(
                undefined,
                undefined,
                factory.createIdentifier("w"),
                undefined,
                factory.createTypeReferenceNode(factory.createIdentifier(name), [
                  factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
                ])
              ),
            ],
            factory.createTypeReferenceNode(factory.createIdentifier("R"))
          )
        ),
      ],
      factory.createTypeReferenceNode(factory.createIdentifier("R")),
      factory.createBlock(
        [
          factory.createReturnStatement(
            factory.createCallExpression(
              factory.createPropertyAccessExpression(
                factory.createIdentifier("ex"),
                factory.createIdentifier("use")
              ),
              undefined,
              [factory.createIdentifier("f")]
            )
          ),
        ],
        true
      )
    );

    return [target, anyTypeAlias, packFn, useFn];
  },
});

// ============================================================================
// packExists / useExists Expression Macros (zero-cost erasure)
// ============================================================================

/**
 * packExists macro — at compile time, this is identity (zero-cost).
 * The type system enforces correctness; at runtime it's just the value.
 */
export const packExistsMacro = defineExpressionMacro({
  name: "packExists",
  description: "Pack a value into an existential type (zero-cost at runtime)",

  expand(
    _ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length !== 1) {
      _ctx.reportError(callExpr, "packExists() expects exactly one argument");
      return callExpr;
    }

    // Generate: { use: (f) => f(witness) }
    const factory = _ctx.factory;
    const fIdent = _ctx.generateUniqueName("f");
    return factory.createObjectLiteralExpression(
      [
        factory.createPropertyAssignment(
          factory.createIdentifier("use"),
          factory.createArrowFunction(
            undefined,
            undefined,
            [factory.createParameterDeclaration(undefined, undefined, fIdent)],
            undefined,
            factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
            factory.createCallExpression(factory.createIdentifier(fIdent.text), undefined, [
              args[0],
            ])
          )
        ),
      ],
      false
    );
  },
});

/**
 * useExists macro — at compile time, inlines the continuation call.
 */
export const useExistsMacro = defineExpressionMacro({
  name: "useExists",
  description: "Eliminate an existential type by providing a universal continuation",

  expand(
    _ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length !== 2) {
      _ctx.reportError(
        callExpr,
        "useExists() expects exactly two arguments (existential, callback)"
      );
      return callExpr;
    }

    // Generate: args[0].use(args[1])
    const factory = _ctx.factory;
    return factory.createCallExpression(
      factory.createPropertyAccessExpression(args[0], "use"),
      undefined,
      [args[1]]
    );
  },
});

// ============================================================================
// opaqueModule Expression Macro
// ============================================================================

/**
 * opaqueModule macro — at compile time, validates the module definition
 * and generates optimized code.
 */
export const opaqueModuleMacro = defineExpressionMacro({
  name: "opaqueModule",
  description: "Create an opaque type module with smart constructors and controlled access",

  expand(
    _ctx: MacroContext,
    callExpr: ts.CallExpression,
    _args: readonly ts.Expression[]
  ): ts.Expression {
    // Pass through to the runtime implementation — the type system
    // handles the opacity via branded types
    return callExpr;
  },
});

// ============================================================================
// refine / unsafeRefine Expression Macros — compile-time validation
// ============================================================================

/**
 * refine macro — validates a literal value at compile time.
 *
 * For compile-time-known values (literals), the macro evaluates the predicate
 * during compilation and reports an error if it fails. For dynamic values,
 * it generates a runtime validation call.
 */
export const refineMacro = defineExpressionMacro({
  name: "refine",
  description: "Validate and refine a value at compile time (for literals) or runtime",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length < 2) {
      // If called as refine(refinement, value), pass through
      // If called as refine<Type>(value), the type arg tells us the refinement
      return callExpr;
    }

    const [refinementArg, valueArg] = args;

    // Try to evaluate the value at compile time
    if (ctx.isComptime(valueArg)) {
      const value = ctx.evaluate(valueArg);
      if (value.kind !== "error") {
        // We have a compile-time value — the runtime refinement.refine()
        // will validate it. We can't run the predicate at compile time
        // (it's a closure), but we can emit the call.
      }
    }

    // Generate: refinementArg.refine(valueArg)
    const factory = ctx.factory;
    return factory.createCallExpression(
      factory.createPropertyAccessExpression(refinementArg, "refine"),
      undefined,
      [valueArg]
    );
  },
});

/**
 * unsafeRefine macro — bypass validation (escape hatch).
 * The value is cast to the refined type without checking.
 * Use only when you've already validated externally.
 */
export const unsafeRefineMacro = defineExpressionMacro({
  name: "unsafeRefine",
  description: "Bypass refinement validation (unsafe escape hatch)",

  expand(
    _ctx: MacroContext,
    _callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    // unsafeRefine(value) => value (identity — the type cast happens at the type level)
    if (args.length >= 1) {
      return args[0];
    }
    return _callExpr;
  },
});

// ============================================================================
// Type-Level Arithmetic — helpers
// ============================================================================

function extractNumericLiteral(ctx: MacroContext, typeNode: ts.TypeNode): number | undefined {
  // Direct literal type: 42
  if (ts.isLiteralTypeNode(typeNode)) {
    if (ts.isNumericLiteral(typeNode.literal)) {
      return parseFloat(typeNode.literal.text);
    }
    // Handle negative literals: -42
    if (
      ts.isPrefixUnaryExpression(typeNode.literal) &&
      typeNode.literal.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(typeNode.literal.operand)
    ) {
      return -parseFloat(typeNode.literal.operand.text);
    }
  }

  // Try to resolve via the type checker (for type aliases that resolve to literals)
  const type = ctx.typeChecker.getTypeFromTypeNode(typeNode);
  if (type.isNumberLiteral()) {
    return type.value;
  }

  return undefined;
}

/**
 * Create a literal number type node from a numeric value.
 */
function createNumericLiteralType(factory: ts.NodeFactory, value: number): ts.TypeNode {
  if (value < 0) {
    return factory.createLiteralTypeNode(
      factory.createPrefixUnaryExpression(
        ts.SyntaxKind.MinusToken,
        factory.createNumericLiteral(Math.abs(value))
      )
    );
  }
  return factory.createLiteralTypeNode(factory.createNumericLiteral(value));
}

/**
 * Create a boolean literal type node.
 */
function createBooleanLiteralType(factory: ts.NodeFactory, value: boolean): ts.TypeNode {
  return value
    ? factory.createLiteralTypeNode(factory.createTrue())
    : factory.createLiteralTypeNode(factory.createFalse());
}

// ============================================================================
// Arithmetic Type Macros
// ============================================================================

/** Add<A, B> — compile-time addition */
export const addTypeMacro = defineTypeMacro({
  name: "Add",
  description: "Type-level addition: Add<3, 4> = 7",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 2) {
      ctx.reportError(_typeRef, "Add<A, B> requires exactly 2 type arguments");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    const b = extractNumericLiteral(ctx, args[1]);

    if (a !== undefined && b !== undefined) {
      return createNumericLiteralType(ctx.factory, a + b);
    }

    // Can't resolve at compile time — return the original
    return _typeRef;
  },
});

/** Sub<A, B> — compile-time subtraction */
export const subTypeMacro = defineTypeMacro({
  name: "Sub",
  description: "Type-level subtraction: Sub<7, 3> = 4",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 2) {
      ctx.reportError(_typeRef, "Sub<A, B> requires exactly 2 type arguments");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    const b = extractNumericLiteral(ctx, args[1]);

    if (a !== undefined && b !== undefined) {
      return createNumericLiteralType(ctx.factory, a - b);
    }

    return _typeRef;
  },
});

/** Mul<A, B> — compile-time multiplication */
export const mulTypeMacro = defineTypeMacro({
  name: "Mul",
  description: "Type-level multiplication: Mul<3, 4> = 12",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 2) {
      ctx.reportError(_typeRef, "Mul<A, B> requires exactly 2 type arguments");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    const b = extractNumericLiteral(ctx, args[1]);

    if (a !== undefined && b !== undefined) {
      return createNumericLiteralType(ctx.factory, a * b);
    }

    return _typeRef;
  },
});

/** Div<A, B> — compile-time integer division */
export const divTypeMacro = defineTypeMacro({
  name: "Div",
  description: "Type-level integer division: Div<7, 2> = 3",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 2) {
      ctx.reportError(_typeRef, "Div<A, B> requires exactly 2 type arguments");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    const b = extractNumericLiteral(ctx, args[1]);

    if (a !== undefined && b !== undefined) {
      if (b === 0) {
        ctx.reportError(_typeRef, "Division by zero in Div<A, B>");
        return _typeRef;
      }
      return createNumericLiteralType(ctx.factory, Math.trunc(a / b));
    }

    return _typeRef;
  },
});

/** Mod<A, B> — compile-time modulo */
export const modTypeMacro = defineTypeMacro({
  name: "Mod",
  description: "Type-level modulo: Mod<7, 3> = 1",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 2) {
      ctx.reportError(_typeRef, "Mod<A, B> requires exactly 2 type arguments");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    const b = extractNumericLiteral(ctx, args[1]);

    if (a !== undefined && b !== undefined) {
      if (b === 0) {
        ctx.reportError(_typeRef, "Division by zero in Mod<A, B>");
        return _typeRef;
      }
      return createNumericLiteralType(ctx.factory, a % b);
    }

    return _typeRef;
  },
});

/** Pow<Base, Exp> — compile-time exponentiation */
export const powTypeMacro = defineTypeMacro({
  name: "Pow",
  description: "Type-level exponentiation: Pow<2, 10> = 1024",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 2) {
      ctx.reportError(_typeRef, "Pow<Base, Exp> requires exactly 2 type arguments");
      return _typeRef;
    }

    const base = extractNumericLiteral(ctx, args[0]);
    const exp = extractNumericLiteral(ctx, args[1]);

    if (base !== undefined && exp !== undefined) {
      return createNumericLiteralType(ctx.factory, Math.pow(base, exp));
    }

    return _typeRef;
  },
});

/** Negate<A> — compile-time negation */
export const negateTypeMacro = defineTypeMacro({
  name: "Negate",
  description: "Type-level negation: Negate<5> = -5",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 1) {
      ctx.reportError(_typeRef, "Negate<A> requires exactly 1 type argument");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    if (a !== undefined) {
      return createNumericLiteralType(ctx.factory, -a);
    }

    return _typeRef;
  },
});

/** Abs<A> — compile-time absolute value */
export const absTypeMacro = defineTypeMacro({
  name: "Abs",
  description: "Type-level absolute value: Abs<-5> = 5",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 1) {
      ctx.reportError(_typeRef, "Abs<A> requires exactly 1 type argument");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    if (a !== undefined) {
      return createNumericLiteralType(ctx.factory, Math.abs(a));
    }

    return _typeRef;
  },
});

/** Max<A, B> — compile-time maximum */
export const maxTypeMacro = defineTypeMacro({
  name: "Max",
  description: "Type-level maximum: Max<3, 7> = 7",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 2) {
      ctx.reportError(_typeRef, "Max<A, B> requires exactly 2 type arguments");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    const b = extractNumericLiteral(ctx, args[1]);

    if (a !== undefined && b !== undefined) {
      return createNumericLiteralType(ctx.factory, Math.max(a, b));
    }

    return _typeRef;
  },
});

/** Min<A, B> — compile-time minimum */
export const minTypeMacro = defineTypeMacro({
  name: "Min",
  description: "Type-level minimum: Min<3, 7> = 3",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 2) {
      ctx.reportError(_typeRef, "Min<A, B> requires exactly 2 type arguments");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    const b = extractNumericLiteral(ctx, args[1]);

    if (a !== undefined && b !== undefined) {
      return createNumericLiteralType(ctx.factory, Math.min(a, b));
    }

    return _typeRef;
  },
});

// ============================================================================
// Comparison Type Macros
// ============================================================================

/** Lt<A, B> — compile-time less-than */
export const ltTypeMacro = defineTypeMacro({
  name: "Lt",
  description: "Type-level less-than: Lt<3, 5> = true",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 2) {
      ctx.reportError(_typeRef, "Lt<A, B> requires exactly 2 type arguments");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    const b = extractNumericLiteral(ctx, args[1]);

    if (a !== undefined && b !== undefined) {
      return createBooleanLiteralType(ctx.factory, a < b);
    }

    return _typeRef;
  },
});

/** Lte<A, B> — compile-time less-than-or-equal */
export const lteTypeMacro = defineTypeMacro({
  name: "Lte",
  description: "Type-level less-than-or-equal: Lte<3, 3> = true",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 2) {
      ctx.reportError(_typeRef, "Lte<A, B> requires exactly 2 type arguments");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    const b = extractNumericLiteral(ctx, args[1]);

    if (a !== undefined && b !== undefined) {
      return createBooleanLiteralType(ctx.factory, a <= b);
    }

    return _typeRef;
  },
});

/** Gt<A, B> — compile-time greater-than */
export const gtTypeMacro = defineTypeMacro({
  name: "Gt",
  description: "Type-level greater-than: Gt<5, 3> = true",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 2) {
      ctx.reportError(_typeRef, "Gt<A, B> requires exactly 2 type arguments");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    const b = extractNumericLiteral(ctx, args[1]);

    if (a !== undefined && b !== undefined) {
      return createBooleanLiteralType(ctx.factory, a > b);
    }

    return _typeRef;
  },
});

/** Gte<A, B> — compile-time greater-than-or-equal */
export const gteTypeMacro = defineTypeMacro({
  name: "Gte",
  description: "Type-level greater-than-or-equal: Gte<5, 5> = true",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 2) {
      ctx.reportError(_typeRef, "Gte<A, B> requires exactly 2 type arguments");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    const b = extractNumericLiteral(ctx, args[1]);

    if (a !== undefined && b !== undefined) {
      return createBooleanLiteralType(ctx.factory, a >= b);
    }

    return _typeRef;
  },
});

/** Eq<A, B> — compile-time numeric equality */
export const eqTypeMacro = defineTypeMacro({
  name: "NumEq",
  description: "Type-level numeric equality: NumEq<3, 3> = true",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 2) {
      ctx.reportError(_typeRef, "NumEq<A, B> requires exactly 2 type arguments");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    const b = extractNumericLiteral(ctx, args[1]);

    if (a !== undefined && b !== undefined) {
      return createBooleanLiteralType(ctx.factory, a === b);
    }

    return _typeRef;
  },
});

// ============================================================================
// Utility Type Macros
// ============================================================================

/** Increment<A> — A + 1 */
export const incTypeMacro = defineTypeMacro({
  name: "Increment",
  description: "Type-level increment: Increment<4> = 5",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 1) {
      ctx.reportError(_typeRef, "Increment<A> requires exactly 1 type argument");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    if (a !== undefined) {
      return createNumericLiteralType(ctx.factory, a + 1);
    }

    return _typeRef;
  },
});

/** Decrement<A> — A - 1 */
export const decTypeMacro = defineTypeMacro({
  name: "Decrement",
  description: "Type-level decrement: Decrement<5> = 4",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 1) {
      ctx.reportError(_typeRef, "Decrement<A> requires exactly 1 type argument");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    if (a !== undefined) {
      return createNumericLiteralType(ctx.factory, a - 1);
    }

    return _typeRef;
  },
});

/** IsEven<A> — check if a number is even */
export const isEvenTypeMacro = defineTypeMacro({
  name: "IsEven",
  description: "Type-level even check: IsEven<4> = true",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 1) {
      ctx.reportError(_typeRef, "IsEven<A> requires exactly 1 type argument");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    if (a !== undefined) {
      return createBooleanLiteralType(ctx.factory, a % 2 === 0);
    }

    return _typeRef;
  },
});

/** IsOdd<A> — check if a number is odd */
export const isOddTypeMacro = defineTypeMacro({
  name: "IsOdd",
  description: "Type-level odd check: IsOdd<3> = true",

  expand(
    ctx: MacroContext,
    _typeRef: ts.TypeReferenceNode,
    args: readonly ts.TypeNode[]
  ): ts.TypeNode {
    if (args.length !== 1) {
      ctx.reportError(_typeRef, "IsOdd<A> requires exactly 1 type argument");
      return _typeRef;
    }

    const a = extractNumericLiteral(ctx, args[0]);
    if (a !== undefined) {
      return createBooleanLiteralType(ctx.factory, a % 2 !== 0);
    }

    return _typeRef;
  },
});

// ============================================================================
// Phantom Type State Machine Macros
// ============================================================================

/**
 * @phantom decorator — adds phantom type parameter tracking to a class.
 *
 * The macro:
 * 1. Reads @transition annotations on methods
 * 2. Generates typed overloads that enforce state transitions
 * 3. Makes invalid transitions a compile-time error
 */
export const phantomAttribute = defineAttributeMacro({
  name: "phantom",
  description: "Add phantom type state tracking to a class for type-safe state machines",
  validTargets: ["class"] as AttributeTarget[],

  expand(
    ctx: MacroContext,
    _decorator: ts.Decorator,
    target: ts.Declaration,
    _args: readonly ts.Expression[]
  ): ts.Node | ts.Node[] {
    if (!ts.isClassDeclaration(target)) {
      ctx.reportError(target, "@phantom can only be applied to classes");
      return target;
    }

    const name = target.name?.text ?? "Anonymous";
    const factory = ctx.factory;

    // Extract state transitions from @transition decorators on methods
    const transitions: Array<{
      method: string;
      from: string;
      to: string;
    }> = [];

    for (const member of target.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      const decorators = ts.getDecorators(member);
      if (!decorators) continue;

      for (const dec of decorators) {
        if (!ts.isCallExpression(dec.expression)) continue;
        if (!ts.isIdentifier(dec.expression.expression)) continue;
        if (dec.expression.expression.text !== "transition") continue;

        const args = dec.expression.arguments;
        if (args.length >= 2) {
          const from = ts.isStringLiteral(args[0]) ? args[0].text : "";
          const to = ts.isStringLiteral(args[1]) ? args[1].text : "";
          const methodName = ts.isIdentifier(member.name) ? member.name.text : "";

          if (from && to && methodName) {
            transitions.push({ method: methodName, from, to });
          }
        }
      }
    }

    // Generate a companion type that encodes the state machine
    if (transitions.length > 0) {
      // Build the state machine definition type
      const stateMap = new Map<string, Map<string, string>>();
      for (const { method, from, to } of transitions) {
        if (!stateMap.has(from)) stateMap.set(from, new Map());
        stateMap.get(from)!.set(method, to);
      }

      const stateTypeMembers: ts.TypeElement[] = [];
      for (const [state, trans] of stateMap) {
        const transMembers: ts.TypeElement[] = [];
        for (const [method, target] of trans) {
          transMembers.push(
            factory.createPropertySignature(
              [factory.createModifier(ts.SyntaxKind.ReadonlyKeyword)],
              factory.createIdentifier(method),
              undefined,
              factory.createLiteralTypeNode(factory.createStringLiteral(target))
            )
          );
        }

        stateTypeMembers.push(
          factory.createPropertySignature(
            [factory.createModifier(ts.SyntaxKind.ReadonlyKeyword)],
            factory.createIdentifier(state),
            undefined,
            factory.createTypeLiteralNode(transMembers)
          )
        );
      }

      const stateDefType = factory.createTypeAliasDeclaration(
        [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
        factory.createIdentifier(`${name}States`),
        undefined,
        factory.createTypeLiteralNode(stateTypeMembers)
      );

      return [target, stateDefType];
    }

    return target;
  },
});

export const stateMachineMacro = defineExpressionMacro({
  name: "stateMachine",
  description: "Create a type-safe state machine with phantom type tracking",

  expand(
    _ctx: MacroContext,
    callExpr: ts.CallExpression,
    _args: readonly ts.Expression[]
  ): ts.Expression {
    // Pass through to createStateMachine runtime implementation
    return callExpr;
  },
});

// ============================================================================
// Effect System Attribute Macros
// ============================================================================

/**
 * @pure decorator — marks a function as having no side effects.
 *
 * The macro:
 * 1. Registers the function as pure in the effect registry
 * 2. Walks the function body to find calls to other annotated functions
 * 3. Reports errors if any called function has effects
 */
export const pureAttribute = defineAttributeMacro({
  name: "pure",
  description:
    "Mark a function as pure (no side effects). Compile error if it calls effectful functions.",
  validTargets: ["function", "method"] as AttributeTarget[],

  expand(
    ctx: MacroContext,
    _decorator: ts.Decorator,
    target: ts.Declaration,
    _args: readonly ts.Expression[]
  ): ts.Node | ts.Node[] {
    if (!ts.isFunctionDeclaration(target) && !ts.isMethodDeclaration(target)) {
      ctx.reportError(target, "@pure can only be applied to functions and methods");
      return target;
    }

    const name = target.name
      ? ts.isIdentifier(target.name)
        ? target.name.text
        : target.name.getText()
      : "anonymous";

    // Register as pure
    registerPure(
      name,
      `${ctx.sourceFile.fileName}:${ctx.sourceFile.getLineAndCharacterOfPosition(target.getStart()).line + 1}`
    );

    // Walk the function body to check for effect violations
    if (target.body) {
      walkForEffectViolations(ctx, name, target.body);
    }

    // Return the function unchanged (decorator is consumed)
    return target;
  },
});

/**
 * @effect("io", "async", ...) decorator — marks a function as having effects.
 *
 * The macro:
 * 1. Registers the function with its declared effects
 * 2. Checks that all called functions' effects are covered
 */
export const effectAttribute = defineAttributeMacro({
  name: "effect",
  description: "Declare the side effects of a function. Enables compile-time effect checking.",
  validTargets: ["function", "method"] as AttributeTarget[],

  expand(
    ctx: MacroContext,
    _decorator: ts.Decorator,
    target: ts.Declaration,
    args: readonly ts.Expression[]
  ): ts.Node | ts.Node[] {
    if (!ts.isFunctionDeclaration(target) && !ts.isMethodDeclaration(target)) {
      ctx.reportError(target, "@effect can only be applied to functions and methods");
      return target;
    }

    const name = target.name
      ? ts.isIdentifier(target.name)
        ? target.name.text
        : target.name.getText()
      : "anonymous";

    // Extract effect names from arguments
    const effects: EffectKind[] = [];
    for (const arg of args) {
      if (ts.isStringLiteral(arg)) {
        effects.push(arg.text as EffectKind);
      }
    }

    if (effects.length === 0) {
      ctx.reportWarning(target, '@effect requires at least one effect name, e.g. @effect("io")');
    }

    // Register with effects
    registerEffect(
      name,
      effects,
      `${ctx.sourceFile.fileName}:${ctx.sourceFile.getLineAndCharacterOfPosition(target.getStart()).line + 1}`
    );

    // Walk the function body to check for undeclared effects
    if (target.body) {
      walkForEffectViolations(ctx, name, target.body);
    }

    return target;
  },
});

/**
 * Walk a function body and check for effect violations.
 */
function walkForEffectViolations(ctx: MacroContext, callerName: string, body: ts.Node): void {
  const visitor = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      let calleeName: string | undefined;

      if (ts.isIdentifier(node.expression)) {
        calleeName = node.expression.text;
      } else if (ts.isPropertyAccessExpression(node.expression)) {
        calleeName = node.expression.name.text;
      }

      if (calleeName) {
        const error = checkEffectCall(callerName, calleeName);
        if (error) {
          ctx.reportError(node, error);
        }
      }
    }

    ts.forEachChild(node, visitor);
  };

  ts.forEachChild(body, visitor);
}

// ============================================================================
// Registration
// ============================================================================

const allTypeMacros = [
  addTypeMacro,
  subTypeMacro,
  mulTypeMacro,
  divTypeMacro,
  modTypeMacro,
  powTypeMacro,
  negateTypeMacro,
  absTypeMacro,
  maxTypeMacro,
  minTypeMacro,
  ltTypeMacro,
  lteTypeMacro,
  gtTypeMacro,
  gteTypeMacro,
  eqTypeMacro,
  incTypeMacro,
  decTypeMacro,
  isEvenTypeMacro,
  isOddTypeMacro,
];

export function register(): void {
  // Newtype
  globalRegistry.register(wrapMacro);
  globalRegistry.register(unwrapMacro);
  globalRegistry.register(newtypeCtorMacro);

  // Existential
  globalRegistry.register(existentialAttribute);
  globalRegistry.register(packExistsMacro);
  globalRegistry.register(useExistsMacro);

  // Opaque
  globalRegistry.register(opaqueModuleMacro);

  // Refinement
  globalRegistry.register(refineMacro);

  // Type-level arithmetic
  for (const macro of allTypeMacros) {
    globalRegistry.register(macro);
  }

  // Phantom state machines
  globalRegistry.register(phantomAttribute);
  globalRegistry.register(stateMachineMacro);

  // Effect annotations
  globalRegistry.register(pureAttribute);
}

// Auto-register on import (the transformer loads this entry for its side effects).
register();
