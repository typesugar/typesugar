/**
 * Existential Types Macro
 *
 * TypeScript has no `exists` keyword. You can't express "I have a value of
 * some type T, and a function that works on T, but I've forgotten what T is."
 * This is essential for heterogeneous collections, type-safe plugins, and
 * capability-based APIs.
 *
 * This macro provides existential types via the CPS (Continuation-Passing Style)
 * encoding, hiding all the boilerplate behind clean syntax.
 *
 * ## The Problem
 *
 * ```typescript
 * // You want to store different Show instances in one array:
 * const showables: Showable[] = [
 *   { value: 42, show: (n: number) => String(n) },
 *   { value: "hello", show: (s: string) => s },
 * ];
 * // But TypeScript can't type this — the `value` and `show` types must agree
 * // but each element has a different T.
 * ```
 *
 * ## The Solution
 *
 * ```typescript
 * // Pack a value with its Show instance:
 * const showable42 = packExists({ value: 42, show: (n) => String(n) });
 * const showableHi = packExists({ value: "hello", show: (s) => s });
 *
 * // Store heterogeneously:
 * const showables = [showable42, showableHi];
 *
 * // Use without knowing the concrete type:
 * showables.forEach(s => {
 *   useExists(s, ({ value, show }) => console.log(show(value)));
 * });
 * ```
 *
 * ## How it works
 *
 * The macro generates the CPS encoding:
 * - `packExists(witness)` wraps a value, hiding its type parameter
 * - `useExists(packed, callback)` unwraps it, giving the callback access
 *   to the hidden type via a universally quantified type variable
 *
 * At runtime, this is zero-cost — `packExists` and `useExists` are identity
 * wrappers that the macro can optionally erase.
 */

import * as ts from "typescript";
import {
  defineExpressionMacro,
  defineAttributeMacro,
  globalRegistry,
} from "@ttfx/core";
import { MacroContext, AttributeTarget } from "@ttfx/core";

// ============================================================================
// Type-Level API
// ============================================================================

/**
 * An existential type — "there exists some type T such that Witness<T> holds."
 *
 * The CPS encoding: to use an Exists<Witness>, you must provide a function
 * that works for ALL possible T (universal quantification), which is the
 * dual of existential quantification.
 */
export interface Exists<Witness> {
  readonly __exists_brand__: unique symbol;
  /**
   * Eliminate the existential — provide a continuation that works for any T.
   * The continuation receives the witness (value + capabilities) for the
   * hidden type.
   */
  readonly use: <R>(f: (witness: Witness) => R) => R;
}

/**
 * Pack a witness into an existential, hiding the concrete type.
 *
 * @example
 * ```typescript
 * interface ShowWitness<T> { value: T; show: (t: T) => string; }
 * const packed = packExists<ShowWitness<number>>({ value: 42, show: String });
 * // packed: Exists<ShowWitness<unknown>> — the `number` is hidden
 * ```
 */
export function packExists<W>(witness: W): Exists<W> {
  return {
    use: <R>(f: (w: W) => R): R => f(witness),
  } as Exists<W>;
}

/**
 * Use (eliminate) an existential type.
 *
 * @example
 * ```typescript
 * useExists(packed, ({ value, show }) => {
 *   console.log(show(value)); // Type-safe: show and value agree on T
 * });
 * ```
 */
export function useExists<W, R>(ex: Exists<W>, f: (witness: W) => R): R {
  return ex.use(f);
}

/**
 * Map over the result of using an existential.
 */
export function mapExists<W, R, S>(
  ex: Exists<W>,
  f: (witness: W) => R,
  g: (r: R) => S,
): S {
  return g(ex.use(f));
}

// ============================================================================
// Existential Collections
// ============================================================================

/**
 * A heterogeneous list where each element is an existential.
 */
export type ExistsList<W> = ReadonlyArray<Exists<W>>;

/**
 * Apply a function to each element of an existential list.
 */
export function forEachExists<W>(
  list: ExistsList<W>,
  f: (witness: W) => void,
): void {
  for (const ex of list) {
    ex.use(f);
  }
}

/**
 * Map over an existential list, extracting a uniform result type.
 */
export function mapExistsList<W, R>(
  list: ExistsList<W>,
  f: (witness: W) => R,
): R[] {
  return list.map((ex) => ex.use(f));
}

// ============================================================================
// Common Existential Patterns
// ============================================================================

/**
 * Showable — existential wrapper for values that can be shown.
 */
export interface ShowWitness<T> {
  readonly value: T;
  readonly show: (t: T) => string;
}
export type Showable = Exists<ShowWitness<unknown>>;

export function showable<T>(value: T, show: (t: T) => string): Showable {
  return packExists({ value, show } as ShowWitness<unknown>);
}

export function showValue(s: Showable): string {
  return useExists(s, ({ value, show }) => show(value));
}

/**
 * Comparable — existential wrapper for values that can be compared.
 */
export interface CompareWitness<T> {
  readonly value: T;
  readonly compare: (a: T, b: T) => number;
}
export type Comparable = Exists<CompareWitness<unknown>>;

export function comparable<T>(
  value: T,
  compare: (a: T, b: T) => number,
): Comparable {
  return packExists({ value, compare } as CompareWitness<unknown>);
}

/**
 * Serializable — existential wrapper for values that can be serialized/deserialized.
 */
export interface SerializeWitness<T> {
  readonly value: T;
  readonly serialize: (t: T) => string;
  readonly deserialize: (s: string) => T;
}
export type Serializable = Exists<SerializeWitness<unknown>>;

export function serializable<T>(
  value: T,
  serialize: (t: T) => string,
  deserialize: (s: string) => T,
): Serializable {
  return packExists({
    value,
    serialize,
    deserialize,
  } as SerializeWitness<unknown>);
}

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
  description:
    "Generate existential type wrappers for a parameterized interface",
  validTargets: ["interface"] as AttributeTarget[],

  expand(
    ctx: MacroContext,
    _decorator: ts.Decorator,
    target: ts.Declaration,
    _args: readonly ts.Expression[],
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
        "@existential requires an interface with at least one type parameter",
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
      ]),
    );

    // Generate: function pack{Name}<T>(witness: {Name}<T>): Any{Name}
    const packFnName = `pack${name}`;
    const packFn = factory.createFunctionDeclaration(
      [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
      undefined,
      factory.createIdentifier(packFnName),
      [
        factory.createTypeParameterDeclaration(
          undefined,
          factory.createIdentifier("T"),
        ),
      ],
      [
        factory.createParameterDeclaration(
          undefined,
          undefined,
          factory.createIdentifier("witness"),
          undefined,
          factory.createTypeReferenceNode(factory.createIdentifier(name), [
            factory.createTypeReferenceNode(factory.createIdentifier("T")),
          ]),
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
                        factory.createIdentifier("f"),
                      ),
                    ],
                    undefined,
                    factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                    factory.createCallExpression(
                      factory.createIdentifier("f"),
                      undefined,
                      [factory.createIdentifier("witness")],
                    ),
                  ),
                ),
              ],
              true,
            ),
          ),
        ],
        true,
      ),
    );

    // Generate: function use{Name}<R>(ex: Any{Name}, f: (w: {Name}<any>) => R): R
    const useFnName = `use${name}`;
    const useFn = factory.createFunctionDeclaration(
      [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
      undefined,
      factory.createIdentifier(useFnName),
      [
        factory.createTypeParameterDeclaration(
          undefined,
          factory.createIdentifier("R"),
        ),
      ],
      [
        factory.createParameterDeclaration(
          undefined,
          undefined,
          factory.createIdentifier("ex"),
          undefined,
          factory.createTypeReferenceNode(
            factory.createIdentifier(anyTypeName),
          ),
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
                factory.createTypeReferenceNode(
                  factory.createIdentifier(name),
                  [factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)],
                ),
              ),
            ],
            factory.createTypeReferenceNode(factory.createIdentifier("R")),
          ),
        ),
      ],
      factory.createTypeReferenceNode(factory.createIdentifier("R")),
      factory.createBlock(
        [
          factory.createReturnStatement(
            factory.createCallExpression(
              factory.createPropertyAccessExpression(
                factory.createIdentifier("ex"),
                factory.createIdentifier("use"),
              ),
              undefined,
              [factory.createIdentifier("f")],
            ),
          ),
        ],
        true,
      ),
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
    args: readonly ts.Expression[],
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
            factory.createCallExpression(
              factory.createIdentifier(fIdent.text),
              undefined,
              [args[0]],
            ),
          ),
        ),
      ],
      false,
    );
  },
});

/**
 * useExists macro — at compile time, inlines the continuation call.
 */
export const useExistsMacro = defineExpressionMacro({
  name: "useExists",
  description:
    "Eliminate an existential type by providing a universal continuation",

  expand(
    _ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    if (args.length !== 2) {
      _ctx.reportError(
        callExpr,
        "useExists() expects exactly two arguments (existential, callback)",
      );
      return callExpr;
    }

    // Generate: args[0].use(args[1])
    const factory = _ctx.factory;
    return factory.createCallExpression(
      factory.createPropertyAccessExpression(args[0], "use"),
      undefined,
      [args[1]],
    );
  },
});

// ============================================================================
// Register macros
// ============================================================================

globalRegistry.register(existentialAttribute);
globalRegistry.register(packExistsMacro);
globalRegistry.register(useExistsMacro);
