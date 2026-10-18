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
 * - Refinement types: `unsafeRefine` (not registered)
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
  isSyntheticNode,
} from "@typesugar/core";
import { checkEffectAnnotations, type EffectAnnotation, type EffectKind } from "./effects.js";

/**
 * Every macro in this file is scoped to this module (TSP-1): it only fires on an
 * identifier imported from `@typesugar/type-system`, never on a same-named
 * identifier from another library (e.g. superstruct's `refine`, or a `Max`/`Lt`
 * type from a type-arithmetic library).
 */
const TYPE_SYSTEM_MODULE = "@typesugar/type-system";

// ============================================================================
// Newtype Macros — Erase wrap/unwrap at compile time
// ============================================================================

export const wrapMacro = defineExpressionMacro({
  name: "wrap",
  module: TYPE_SYSTEM_MODULE,
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
  module: TYPE_SYSTEM_MODULE,
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
  module: TYPE_SYSTEM_MODULE,
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
 * // Generates (each `export`ed only if the interface is):
 * function packHandler<T>(witness: Handler<T>) { ... }   // CPS-encoded value
 * type AnyHandler = ReturnType<typeof packHandler>;
 * function useHandler<R>(ex: AnyHandler, f: (w: Handler<any>) => R): R { ... }
 * ```
 */
export const existentialAttribute = defineAttributeMacro({
  name: "existential",
  module: TYPE_SYSTEM_MODULE,
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

    // TSP-11: mirror the interface's own `export` (an unconditional `export`
    // is a syntax error inside a namespace/function block and turns a script
    // into a module), and never reference a name the user may not have in
    // scope (the old code named `Exists` bare). The generated helpers are
    // self-contained: `pack{Name}` builds the CPS object itself and
    // `Any{Name}` is derived from its return type, so the output type-checks
    // as-is and needs no import. (Delegating to the runtime `packExists` via
    // ensureImport is not safe here: `packExists` is itself a macro, so a user
    // import of it is removed by import cleanup and ensureImport would hand
    // back that now-unbound name.)
    const isExported = (ts.getModifiers(target) ?? []).some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword
    );
    const exportMods = (): ts.Modifier[] | undefined =>
      isExported ? [factory.createModifier(ts.SyntaxKind.ExportKeyword)] : undefined;

    const anyTypeName = `Any${name}`;
    const packFnName = `pack${name}`;
    const nameUnknown = () =>
      factory.createTypeReferenceNode(factory.createIdentifier(name), [
        factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword),
      ]);

    // Generate:
    //   function pack{Name}<T>(witness: {Name}<T>) {
    //     const w = witness as unknown as {Name}<unknown>;
    //     return { use: <R>(f: (w: {Name}<unknown>) => R): R => f(w) };
    //   }
    const rIdent = () => factory.createTypeReferenceNode(factory.createIdentifier("R"));
    const packFn = factory.createFunctionDeclaration(
      exportMods(),
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
      undefined,
      factory.createBlock(
        [
          factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList(
              [
                factory.createVariableDeclaration(
                  factory.createIdentifier("w"),
                  undefined,
                  undefined,
                  factory.createAsExpression(
                    factory.createAsExpression(
                      factory.createIdentifier("witness"),
                      factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword)
                    ),
                    nameUnknown()
                  )
                ),
              ],
              ts.NodeFlags.Const
            )
          ),
          factory.createReturnStatement(
            factory.createObjectLiteralExpression(
              [
                factory.createPropertyAssignment(
                  factory.createIdentifier("use"),
                  factory.createArrowFunction(
                    undefined,
                    [
                      factory.createTypeParameterDeclaration(
                        undefined,
                        factory.createIdentifier("R")
                      ),
                    ],
                    [
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
                              nameUnknown()
                            ),
                          ],
                          rIdent()
                        )
                      ),
                    ],
                    rIdent(),
                    factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                    factory.createCallExpression(factory.createIdentifier("f"), undefined, [
                      factory.createIdentifier("w"),
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

    // Generate: type Any{Name} = ReturnType<typeof pack{Name}>
    const anyTypeAlias = factory.createTypeAliasDeclaration(
      exportMods(),
      factory.createIdentifier(anyTypeName),
      undefined,
      factory.createTypeReferenceNode(factory.createIdentifier("ReturnType"), [
        factory.createTypeQueryNode(factory.createIdentifier(packFnName)),
      ])
    );

    // Generate: function use{Name}<R>(ex: Any{Name}, f: (w: {Name}<any>) => R): R
    const useFnName = `use${name}`;
    const useFn = factory.createFunctionDeclaration(
      exportMods(),
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
  module: TYPE_SYSTEM_MODULE,
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

    // Generate: ((w) => ({ use: (f) => f(w) }))(witness)
    //
    // TSP-3: the witness expression is passed as an ARGUMENT so it is
    // evaluated exactly once (like the runtime `packExists`). Inlining it into
    // the `use` arrow body re-evaluated it on every `.use` call (e.g.
    // `packExists(openConnection())` opened a connection per use). Keeping it
    // in argument position (rather than a `const` inside an IIFE body) also
    // keeps any `await`/`yield` in the witness in its original function.
    const factory = _ctx.factory;
    const fIdent = _ctx.generateUniqueName("f");
    const wIdent = _ctx.generateUniqueName("w");
    const packer = factory.createArrowFunction(
      undefined,
      undefined,
      [factory.createParameterDeclaration(undefined, undefined, wIdent)],
      undefined,
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      factory.createParenthesizedExpression(
        factory.createObjectLiteralExpression(
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
                  factory.createIdentifier(wIdent.text),
                ])
              )
            ),
          ],
          false
        )
      )
    );
    return factory.createCallExpression(factory.createParenthesizedExpression(packer), undefined, [
      args[0],
    ]);
  },
});

/**
 * useExists macro — at compile time, inlines the continuation call.
 */
export const useExistsMacro = defineExpressionMacro({
  name: "useExists",
  module: TYPE_SYSTEM_MODULE,
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
  module: TYPE_SYSTEM_MODULE,
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

// NOTE (TSP-1): there used to be a `refine` expression macro here, rewriting
// `refine(r, v)` to `r.refine(v)`. `@typesugar/type-system` has no runtime
// `refine` export, so that macro could only ever fire on SOMEONE ELSE's
// `refine` (e.g. superstruct's) and silently rewrite it. It was removed; use
// the refinement's own method (`Positive.refine(5)`).

/**
 * unsafeRefine macro — bypass validation (escape hatch).
 * The value is cast to the refined type without checking.
 * Use only when you've already validated externally.
 */
export const unsafeRefineMacro = defineExpressionMacro({
  name: "unsafeRefine",
  module: TYPE_SYSTEM_MODULE,
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

function extractNumericLiteral(
  ctx: MacroContext,
  typeNode: ts.TypeNode,
  typeRef: ts.TypeReferenceNode
): number | undefined {
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

  // Try to resolve via the type checker (for type aliases that resolve to
  // literals). A macro-generated (synthetic) type node is outside the checker's
  // contract (CLAUDE.md), so skip it — visibly — rather than risk a throw.
  if (isSyntheticNode(typeNode)) {
    ctx.reportWarning(
      typeRef,
      `${typeName(typeRef)}: a type argument was generated by another macro and cannot be ` +
        `resolved through the type checker; leaving ${typeName(typeRef)}<...> unevaluated`
    );
    return undefined;
  }
  try {
    const type = ctx.typeChecker.getTypeFromTypeNode(typeNode);
    if (type.isNumberLiteral()) {
      return type.value;
    }
  } catch (e) {
    ctx.reportWarning(
      typeRef,
      `${typeName(typeRef)}: type checker failed on a type argument (${(e as Error).message}); ` +
        `leaving ${typeName(typeRef)}<...> unevaluated`
    );
  }

  return undefined;
}

function typeName(typeRef: ts.TypeReferenceNode): string {
  return ts.isIdentifier(typeRef.typeName) ? typeRef.typeName.text : typeRef.typeName.right.text;
}

/**
 * Emit a numeric literal type for a computed result, or report an error when
 * the result is not a finite number (TSP-13: `Pow<-8, 0.5>` is NaN and
 * `Pow<10, 400>` is Infinity — neither is a valid literal type).
 */
function numericResult(
  ctx: MacroContext,
  typeRef: ts.TypeReferenceNode,
  value: number
): ts.TypeNode {
  if (!Number.isFinite(value)) {
    ctx.reportError(
      typeRef,
      `${typeName(typeRef)}<...> evaluates to ${value}, which is not a finite number literal type`
    );
    return typeRef;
  }
  return createNumericLiteralType(ctx.factory, value);
}

/** Report an error (and return false) unless every value is an integer. */
function requireIntegers(
  ctx: MacroContext,
  typeRef: ts.TypeReferenceNode,
  ...values: number[]
): boolean {
  if (values.every((v) => Number.isInteger(v))) return true;
  ctx.reportError(typeRef, `${typeName(typeRef)}<...> requires integer arguments`);
  return false;
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
  module: TYPE_SYSTEM_MODULE,
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

    const a = extractNumericLiteral(ctx, args[0], _typeRef);
    const b = extractNumericLiteral(ctx, args[1], _typeRef);

    if (a !== undefined && b !== undefined) {
      return numericResult(ctx, _typeRef, a + b);
    }

    // Can't resolve at compile time — return the original
    return _typeRef;
  },
});

/** Sub<A, B> — compile-time subtraction */
export const subTypeMacro = defineTypeMacro({
  name: "Sub",
  module: TYPE_SYSTEM_MODULE,
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

    const a = extractNumericLiteral(ctx, args[0], _typeRef);
    const b = extractNumericLiteral(ctx, args[1], _typeRef);

    if (a !== undefined && b !== undefined) {
      return numericResult(ctx, _typeRef, a - b);
    }

    return _typeRef;
  },
});

/** Mul<A, B> — compile-time multiplication */
export const mulTypeMacro = defineTypeMacro({
  name: "Mul",
  module: TYPE_SYSTEM_MODULE,
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

    const a = extractNumericLiteral(ctx, args[0], _typeRef);
    const b = extractNumericLiteral(ctx, args[1], _typeRef);

    if (a !== undefined && b !== undefined) {
      return numericResult(ctx, _typeRef, a * b);
    }

    return _typeRef;
  },
});

/** Div<A, B> — compile-time integer division */
export const divTypeMacro = defineTypeMacro({
  name: "Div",
  module: TYPE_SYSTEM_MODULE,
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

    const a = extractNumericLiteral(ctx, args[0], _typeRef);
    const b = extractNumericLiteral(ctx, args[1], _typeRef);

    if (a !== undefined && b !== undefined) {
      if (!requireIntegers(ctx, _typeRef, a, b)) return _typeRef;
      if (b === 0) {
        ctx.reportError(_typeRef, "Division by zero in Div<A, B>");
        return _typeRef;
      }
      return numericResult(ctx, _typeRef, Math.trunc(a / b));
    }

    return _typeRef;
  },
});

/** Mod<A, B> — compile-time modulo */
export const modTypeMacro = defineTypeMacro({
  name: "Mod",
  module: TYPE_SYSTEM_MODULE,
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

    const a = extractNumericLiteral(ctx, args[0], _typeRef);
    const b = extractNumericLiteral(ctx, args[1], _typeRef);

    if (a !== undefined && b !== undefined) {
      if (!requireIntegers(ctx, _typeRef, a, b)) return _typeRef;
      if (b === 0) {
        ctx.reportError(_typeRef, "Division by zero in Mod<A, B>");
        return _typeRef;
      }
      return numericResult(ctx, _typeRef, a % b);
    }

    return _typeRef;
  },
});

/** Pow<Base, Exp> — compile-time exponentiation */
export const powTypeMacro = defineTypeMacro({
  name: "Pow",
  module: TYPE_SYSTEM_MODULE,
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

    const base = extractNumericLiteral(ctx, args[0], _typeRef);
    const exp = extractNumericLiteral(ctx, args[1], _typeRef);

    if (base !== undefined && exp !== undefined) {
      return numericResult(ctx, _typeRef, Math.pow(base, exp));
    }

    return _typeRef;
  },
});

/** Negate<A> — compile-time negation */
export const negateTypeMacro = defineTypeMacro({
  name: "Negate",
  module: TYPE_SYSTEM_MODULE,
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

    const a = extractNumericLiteral(ctx, args[0], _typeRef);
    if (a !== undefined) {
      return numericResult(ctx, _typeRef, -a);
    }

    return _typeRef;
  },
});

/** Abs<A> — compile-time absolute value */
export const absTypeMacro = defineTypeMacro({
  name: "Abs",
  module: TYPE_SYSTEM_MODULE,
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

    const a = extractNumericLiteral(ctx, args[0], _typeRef);
    if (a !== undefined) {
      return numericResult(ctx, _typeRef, Math.abs(a));
    }

    return _typeRef;
  },
});

/** Max<A, B> — compile-time maximum */
export const maxTypeMacro = defineTypeMacro({
  name: "Max",
  module: TYPE_SYSTEM_MODULE,
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

    const a = extractNumericLiteral(ctx, args[0], _typeRef);
    const b = extractNumericLiteral(ctx, args[1], _typeRef);

    if (a !== undefined && b !== undefined) {
      return numericResult(ctx, _typeRef, Math.max(a, b));
    }

    return _typeRef;
  },
});

/** Min<A, B> — compile-time minimum */
export const minTypeMacro = defineTypeMacro({
  name: "Min",
  module: TYPE_SYSTEM_MODULE,
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

    const a = extractNumericLiteral(ctx, args[0], _typeRef);
    const b = extractNumericLiteral(ctx, args[1], _typeRef);

    if (a !== undefined && b !== undefined) {
      return numericResult(ctx, _typeRef, Math.min(a, b));
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
  module: TYPE_SYSTEM_MODULE,
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

    const a = extractNumericLiteral(ctx, args[0], _typeRef);
    const b = extractNumericLiteral(ctx, args[1], _typeRef);

    if (a !== undefined && b !== undefined) {
      return createBooleanLiteralType(ctx.factory, a < b);
    }

    return _typeRef;
  },
});

/** Lte<A, B> — compile-time less-than-or-equal */
export const lteTypeMacro = defineTypeMacro({
  name: "Lte",
  module: TYPE_SYSTEM_MODULE,
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

    const a = extractNumericLiteral(ctx, args[0], _typeRef);
    const b = extractNumericLiteral(ctx, args[1], _typeRef);

    if (a !== undefined && b !== undefined) {
      return createBooleanLiteralType(ctx.factory, a <= b);
    }

    return _typeRef;
  },
});

/** Gt<A, B> — compile-time greater-than */
export const gtTypeMacro = defineTypeMacro({
  name: "Gt",
  module: TYPE_SYSTEM_MODULE,
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

    const a = extractNumericLiteral(ctx, args[0], _typeRef);
    const b = extractNumericLiteral(ctx, args[1], _typeRef);

    if (a !== undefined && b !== undefined) {
      return createBooleanLiteralType(ctx.factory, a > b);
    }

    return _typeRef;
  },
});

/** Gte<A, B> — compile-time greater-than-or-equal */
export const gteTypeMacro = defineTypeMacro({
  name: "Gte",
  module: TYPE_SYSTEM_MODULE,
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

    const a = extractNumericLiteral(ctx, args[0], _typeRef);
    const b = extractNumericLiteral(ctx, args[1], _typeRef);

    if (a !== undefined && b !== undefined) {
      return createBooleanLiteralType(ctx.factory, a >= b);
    }

    return _typeRef;
  },
});

/** Eq<A, B> — compile-time numeric equality */
export const eqTypeMacro = defineTypeMacro({
  name: "NumEq",
  module: TYPE_SYSTEM_MODULE,
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

    const a = extractNumericLiteral(ctx, args[0], _typeRef);
    const b = extractNumericLiteral(ctx, args[1], _typeRef);

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
  module: TYPE_SYSTEM_MODULE,
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

    const a = extractNumericLiteral(ctx, args[0], _typeRef);
    if (a !== undefined) {
      return numericResult(ctx, _typeRef, a + 1);
    }

    return _typeRef;
  },
});

/** Decrement<A> — A - 1 */
export const decTypeMacro = defineTypeMacro({
  name: "Decrement",
  module: TYPE_SYSTEM_MODULE,
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

    const a = extractNumericLiteral(ctx, args[0], _typeRef);
    if (a !== undefined) {
      return numericResult(ctx, _typeRef, a - 1);
    }

    return _typeRef;
  },
});

/** IsEven<A> — check if a number is even */
export const isEvenTypeMacro = defineTypeMacro({
  name: "IsEven",
  module: TYPE_SYSTEM_MODULE,
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

    const a = extractNumericLiteral(ctx, args[0], _typeRef);
    if (a !== undefined) {
      if (!requireIntegers(ctx, _typeRef, a)) return _typeRef;
      return createBooleanLiteralType(ctx.factory, a % 2 === 0);
    }

    return _typeRef;
  },
});

/** IsOdd<A> — check if a number is odd */
export const isOddTypeMacro = defineTypeMacro({
  name: "IsOdd",
  module: TYPE_SYSTEM_MODULE,
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

    const a = extractNumericLiteral(ctx, args[0], _typeRef);
    if (a !== undefined) {
      if (!requireIntegers(ctx, _typeRef, a)) return _typeRef;
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
  module: TYPE_SYSTEM_MODULE,
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
  module: TYPE_SYSTEM_MODULE,
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
 * The macro walks the function body and reports an error for every call
 * whose callee is declared `@effect(...)`.
 *
 * TSP-5: the callee's annotation is read from its DECLARATION (resolved
 * through the type checker), not looked up by bare name in a module-global
 * registry. That makes checking order-independent across declarations and
 * files (no "the callee's decorator hasn't been expanded yet" problem), keyed
 * by symbol (`store.save()` no longer matches an unrelated `@effect`
 * function named `save`), and free of stale state across programs / watch
 * rebuilds (there is no compile-time registry left to go stale).
 */
export const pureAttribute = defineAttributeMacro({
  name: "pure",
  module: TYPE_SYSTEM_MODULE,
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

    const caller: EffectAnnotation = { name: declName(target), pure: true, effects: new Set() };
    if (target.body) {
      walkForEffectViolations(ctx, caller, target.body);
    }

    // Return the function unchanged (decorator is consumed)
    return target;
  },
});

/**
 * @effect("io", "async", ...) decorator — marks a function as having effects.
 *
 * The macro checks that every effect of every annotated callee is declared.
 */
export const effectAttribute = defineAttributeMacro({
  name: "effect",
  module: TYPE_SYSTEM_MODULE,
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

    const effects = effectKindsFromArgs(args);
    if (effects.length === 0) {
      ctx.reportWarning(target, '@effect requires at least one effect name, e.g. @effect("io")');
    }

    const caller: EffectAnnotation = {
      name: declName(target),
      pure: false,
      effects: new Set(effects),
    };
    if (target.body) {
      walkForEffectViolations(ctx, caller, target.body);
    }

    return target;
  },
});

function declName(decl: ts.FunctionDeclaration | ts.MethodDeclaration): string {
  if (!decl.name) return "anonymous";
  return ts.isIdentifier(decl.name) ? decl.name.text : decl.name.getText();
}

function effectKindsFromArgs(args: readonly ts.Expression[]): EffectKind[] {
  const effects: EffectKind[] = [];
  for (const arg of args) {
    if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
      effects.push(arg.text as EffectKind);
    }
  }
  return effects;
}

/**
 * Read the `@pure` / `@effect(...)` annotation written on a declaration's own
 * decorators (TypeScript keeps decorators on function declarations in
 * `modifiers`). Returns undefined for an unannotated declaration.
 */
function readEffectAnnotation(decl: ts.Declaration): EffectAnnotation | undefined {
  if (!ts.isFunctionDeclaration(decl) && !ts.isMethodDeclaration(decl)) return undefined;
  for (const mod of decl.modifiers ?? []) {
    if (!ts.isDecorator(mod)) continue;
    const expr = mod.expression;
    if (ts.isIdentifier(expr) && expr.text === "pure") {
      return { name: declName(decl), pure: true, effects: new Set() };
    }
    if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
      if (expr.expression.text === "effect") {
        return {
          name: declName(decl),
          pure: false,
          effects: new Set(effectKindsFromArgs(expr.arguments)),
        };
      }
      if (expr.expression.text === "pure") {
        return { name: declName(decl), pure: true, effects: new Set() };
      }
    }
  }
  return undefined;
}

/**
 * Walk a function body and check for effect violations.
 *
 * Each callee is resolved through the type checker to its declaration(s) and
 * the annotation is read there. Synthetic (macro-generated) call nodes are
 * outside the checker's contract (CLAUDE.md) and are skipped with a warning.
 */
function walkForEffectViolations(ctx: MacroContext, caller: EffectAnnotation, body: ts.Node): void {
  let warnedSynthetic = false;
  const visitor = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const calleeNode = ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name
        : node.expression;
      if (ts.isIdentifier(calleeNode)) {
        if (isSyntheticNode(calleeNode)) {
          if (!warnedSynthetic) {
            warnedSynthetic = true;
            ctx.reportWarning(
              body,
              `effect checking for '${caller.name}' skipped a macro-generated call ` +
                `(it cannot be resolved through the type checker)`
            );
          }
        } else {
          const callee = resolveCalleeAnnotation(ctx, calleeNode);
          if (callee) {
            const error = checkEffectAnnotations(caller, callee);
            if (error) ctx.reportError(node, error);
          }
        }
      }
    }
    ts.forEachChild(node, visitor);
  };

  ts.forEachChild(body, visitor);
}

function resolveCalleeAnnotation(
  ctx: MacroContext,
  calleeNode: ts.Identifier
): EffectAnnotation | undefined {
  let symbol: ts.Symbol | undefined;
  try {
    symbol = ctx.typeChecker.getSymbolAtLocation(calleeNode);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
      symbol = ctx.typeChecker.getAliasedSymbol(symbol);
    }
  } catch (e) {
    ctx.reportWarning(
      calleeNode,
      `effect checking skipped '${calleeNode.text}': type checker failed (${(e as Error).message})`
    );
    return undefined;
  }
  for (const decl of symbol?.declarations ?? []) {
    const ann = readEffectAnnotation(decl);
    if (ann) return ann;
  }
  return undefined;
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

  // Type-level arithmetic
  for (const macro of allTypeMacros) {
    globalRegistry.register(macro);
  }

  // Phantom state machines
  globalRegistry.register(phantomAttribute);
  globalRegistry.register(stateMachineMacro);

  // Effect annotations
  globalRegistry.register(pureAttribute);
  globalRegistry.register(effectAttribute);
}

// Auto-register on import (the transformer loads this entry for its side effects).
register();
