/**
 * @ttfx/effect
 *
 * Effect-TS adapter providing macros for working with Effect.
 *
 * ## Do-Notation (via @ttfx/std)
 *
 * The `let:/yield:` syntax is provided by @ttfx/std's generic do-notation macro.
 * This package registers a `FlatMap` instance for Effect that enables this syntax:
 *
 * ```ts
 * import "@ttfx/effect"; // Registers FlatMap instance for Effect
 *
 * // Labeled block syntax (compiles to Effect.flatMap chain)
 * let: {
 *   user << getUserById(id)
 *   posts << getPostsForUser(user.id)
 * }
 * yield: { user, posts }
 *
 * // Compiles to:
 * Effect.flatMap(getUserById(id), (user) =>
 *   Effect.flatMap(getPostsForUser(user.id), (posts) =>
 *     Effect.succeed({ user, posts })
 *   )
 * );
 * ```
 *
 * ## Additional Macros
 *
 * - `gen$(fn)` — Shorthand for `Effect.gen(fn)`
 * - `map$(effect, fn)` — Shorthand for `Effect.map(effect, fn)`
 * - `flatMap$(effect, fn)` — Shorthand for `Effect.flatMap(effect, fn)`
 * - `pipe$(value, ...fns)` — Shorthand for `Effect.pipe(value, ...fns)`
 *
 * @module
 */

import * as ts from "typescript";
import {
  type ExpressionMacro,
  type MacroContext,
  defineExpressionMacro,
  globalRegistry,
} from "@ttfx/core";
import { registerFlatMap } from "@ttfx/std/typeclasses/flatmap";

// ============================================================================
// Effect FlatMap Instance (for @ttfx/std do-notation)
// ============================================================================

/**
 * FlatMap instance for Effect-TS.
 *
 * Delegates to Effect.map and Effect.flatMap from the Effect module.
 * This enables the generic `let:/yield:` syntax from @ttfx/std.
 *
 * Note: Effect is loaded lazily from the 'effect' peer dependency.
 * Ensure 'effect' is installed in your project.
 *
 * The instance is typed as `any` to work around HKT type complexity.
 * Runtime behavior is correct - Effect.map and Effect.flatMap are called
 * with the appropriate arguments.
 */
let _Effect: any;
function getEffectModule(): any {
  if (!_Effect) {
    try {
      _Effect = require("effect").Effect;
    } catch {
      throw new Error(
        "@ttfx/effect requires 'effect' as a peer dependency. " +
        "Install it with: npm install effect",
      );
    }
  }
  return _Effect;
}

export const flatMapEffect = {
  map: <A, B>(fa: unknown, f: (a: A) => B): unknown => {
    return getEffectModule().map(fa, f);
  },
  flatMap: <A, B>(fa: unknown, f: (a: A) => unknown): unknown => {
    return getEffectModule().flatMap(fa, f);
  },
};

// ============================================================================
// Effect Gen Macro (Expression Macro)
// ============================================================================

/**
 * gen$ macro - shorthand for Effect.gen with yield* syntax
 *
 * ```ts
 * const result = gen$((function* () {
 *   const x = yield* getX();
 *   const y = yield* getY(x);
 *   return { x, y };
 * }));
 * ```
 *
 * Compiles to:
 *
 * ```ts
 * const result = Effect.gen(function* () {
 *   const x = yield* getX();
 *   const y = yield* getY(x);
 *   return { x, y };
 * });
 * ```
 */
export const genMacro: ExpressionMacro = defineExpressionMacro({
  name: "gen$",
  expand(
    ctx: MacroContext,
    node: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    const { factory } = ctx;

    if (args.length !== 1) {
      ctx.reportError(
        node,
        "gen$ expects exactly one argument: a generator function",
      );
      return node;
    }

    let genFn = args[0];
    // Unwrap if it's a parenthesized expression
    if (ts.isParenthesizedExpression(genFn)) {
      genFn = genFn.expression;
    }

    // Wrap in Effect.gen
    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier("Effect"),
        factory.createIdentifier("gen"),
      ),
      undefined,
      [genFn],
    );
  },
});

// ============================================================================
// Effect Map Macro (Expression Macro)
// ============================================================================

/**
 * map$ macro - Effect.map shorthand
 *
 * ```ts
 * const result = map$(getUser(), user => user.name);
 * ```
 *
 * Compiles to:
 *
 * ```ts
 * const result = Effect.map(getUser(), user => user.name);
 * ```
 */
export const mapMacro: ExpressionMacro = defineExpressionMacro({
  name: "map$",
  expand(
    ctx: MacroContext,
    node: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    const { factory } = ctx;

    if (args.length !== 2) {
      ctx.reportError(
        node,
        "map$ expects exactly two arguments: effect and mapper function",
      );
      return node;
    }

    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier("Effect"),
        factory.createIdentifier("map"),
      ),
      undefined,
      [args[0], args[1]],
    );
  },
});

// ============================================================================
// Effect FlatMap Macro (Expression Macro)
// ============================================================================

/**
 * flatMap$ macro - Effect.flatMap shorthand
 *
 * ```ts
 * const result = flatMap$(getUser(), user => getPosts(user.id));
 * ```
 *
 * Compiles to:
 *
 * ```ts
 * const result = Effect.flatMap(getUser(), user => getPosts(user.id));
 * ```
 */
export const flatMapMacro: ExpressionMacro = defineExpressionMacro({
  name: "flatMap$",
  expand(
    ctx: MacroContext,
    node: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    const { factory } = ctx;

    if (args.length !== 2) {
      ctx.reportError(
        node,
        "flatMap$ expects exactly two arguments: effect and flatMapper function",
      );
      return node;
    }

    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier("Effect"),
        factory.createIdentifier("flatMap"),
      ),
      undefined,
      [args[0], args[1]],
    );
  },
});

// ============================================================================
// Effect Pipe Macro (Expression Macro)
// ============================================================================

/**
 * pipe$ macro - Effect.pipe shorthand
 *
 * ```ts
 * const result = pipe$(
 *   getUser(),
 *   Effect.flatMap(user => getPosts(user.id)),
 *   Effect.map(posts => posts.length)
 * );
 * ```
 *
 * Compiles to:
 *
 * ```ts
 * const result = Effect.pipe(
 *   getUser(),
 *   Effect.flatMap(user => getPosts(user.id)),
 *   Effect.map(posts => posts.length)
 * );
 * ```
 */
export const pipeMacro: ExpressionMacro = defineExpressionMacro({
  name: "pipe$",
  expand(
    ctx: MacroContext,
    node: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    const { factory } = ctx;

    if (args.length < 2) {
      ctx.reportError(
        node,
        "pipe$ expects at least two arguments: initial value and pipe functions",
      );
      return node;
    }

    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier("Effect"),
        factory.createIdentifier("pipe"),
      ),
      undefined,
      [...args],
    );
  },
});

// ============================================================================
// Registration
// ============================================================================

/**
 * Register all Effect adapter macros with the global registry.
 */
export function register(): void {
  // Register FlatMap instance for Effect (enables let:/yield: from @ttfx/std)
  registerFlatMap("Effect", flatMapEffect);

  // Register expression macros
  globalRegistry.register(genMacro);
  globalRegistry.register(mapMacro);
  globalRegistry.register(flatMapMacro);
  globalRegistry.register(pipeMacro);
}

// Auto-register on import
register();

/**
 * Runtime placeholder for gen$ (should be transformed at compile time)
 */
export function gen$<T>(_fn: () => Generator<unknown, T, unknown>): never {
  throw new Error(
    "gen$ was not transformed at compile time. " +
      "Make sure @ttfx/effect is registered with the transformer.",
  );
}

/**
 * Runtime placeholder for map$ (should be transformed at compile time)
 */
export function map$<A, B>(_effect: unknown, _fn: (a: A) => B): never {
  throw new Error(
    "map$ was not transformed at compile time. " +
      "Make sure @ttfx/effect is registered with the transformer.",
  );
}

/**
 * Runtime placeholder for flatMap$ (should be transformed at compile time)
 */
export function flatMap$<A, B>(
  _effect: unknown,
  _fn: (a: A) => unknown,
): never {
  throw new Error(
    "flatMap$ was not transformed at compile time. " +
      "Make sure @ttfx/effect is registered with the transformer.",
  );
}

/**
 * Runtime placeholder for pipe$ (should be transformed at compile time)
 */
export function pipe$<A>(
  _initial: A,
  ..._fns: Array<(a: unknown) => unknown>
): never {
  throw new Error(
    "pipe$ was not transformed at compile time. " +
      "Make sure @ttfx/effect is registered with the transformer.",
  );
}
