/**
 * Zero-Cost Newtype - Branded types that compile away completely
 *
 * Newtypes provide type-safe wrappers around primitive types at zero runtime
 * cost. The brand exists only in the type system — at runtime, the value is
 * just the underlying primitive. The macro erases all wrap/unwrap calls.
 *
 * ## The Branding Spectrum
 *
 * This module provides `Newtype` — the simplest form of type branding:
 *
 * - **Newtype** (this module) — Pure branding, zero runtime cost.
 *   Use when you just need type-level discrimination.
 *   Example: `UserId`, `Meters`, `Seconds`
 *
 * - **Opaque** (./opaque.ts) — Module-scoped access control.
 *   Use when you need to hide representation details.
 *   Example: `Password` (can't be inspected outside auth module)
 *
 * - **Refined** (./refined.ts) — Runtime validation with predicates.
 *   Use when values must satisfy invariants.
 *   Example: `Email`, `Port`, `NonEmpty<string>`
 *
 * Inspired by Haskell's newtype and Rust's newtype pattern.
 *
 * @example
 * ```typescript
 * // Define branded types:
 * type UserId = Newtype<number, "UserId">;
 * type Email = Newtype<string, "Email">;
 * type Meters = Newtype<number, "Meters">;
 * type Seconds = Newtype<number, "Seconds">;
 *
 * // Source (what you write):
 * const id = wrap<UserId>(42);
 * const raw = unwrap(id);
 * const email = wrap<Email>("user@example.com");
 *
 * // Compiled output (what runs):
 * const id = 42;
 * const raw = id;
 * const email = "user@example.com";
 *
 * // Type errors at compile time:
 * function getUser(id: UserId): User { ... }
 * getUser(42);                    // Error: number is not UserId
 * getUser(wrap<UserId>(42));      // OK — compiles to getUser(42)
 *
 * // Prevent mixing up similar types:
 * function move(distance: Meters, duration: Seconds): void { ... }
 * const d = wrap<Meters>(100);
 * const t = wrap<Seconds>(10);
 * move(d, t);  // OK
 * move(t, d);  // Error: Seconds is not Meters
 * ```
 */

import * as ts from "typescript";
import {
  defineExpressionMacro,
  globalRegistry,
  MacroContext,
} from "@ttfx/core";

// ============================================================================
// Type-Level API
// ============================================================================

/** Brand symbol for newtype discrimination */
declare const __brand: unique symbol;

/**
 * A branded type that wraps Base with a phantom Brand tag.
 * At runtime this is just Base — the brand exists only in the type system.
 */
export type Newtype<Base, Brand extends string> = Base & {
  readonly [__brand]: Brand;
};

/**
 * Extract the base type from a Newtype.
 */
export type UnwrapNewtype<T> = T extends Newtype<infer Base, string> ? Base : T;

/**
 * Wrap a value in a Newtype. Compiles away to nothing.
 *
 * @example
 * const userId = wrap<UserId>(42); // Compiles to: const userId = 42;
 */
export function wrap<T>(value: UnwrapNewtype<T>): T {
  return value as T;
}

/**
 * Unwrap a Newtype to its base value. Compiles away to nothing.
 *
 * @example
 * const raw = unwrap(userId); // Compiles to: const raw = userId;
 */
export function unwrap<T>(value: T): UnwrapNewtype<T> {
  return value as UnwrapNewtype<T>;
}

/**
 * Create a constructor function for a Newtype.
 * The constructor itself compiles away — it's just the identity function.
 *
 * @example
 * const UserId = newtypeCtor<UserId>();
 * const id = UserId(42); // Compiles to: const id = 42;
 */
export function newtypeCtor<T>(): (value: UnwrapNewtype<T>) => T {
  return (value) => value as T;
}

/**
 * Create a validated constructor for a Newtype.
 * The validation runs at runtime, but the wrapping is zero-cost.
 *
 * @example
 * const Email = validatedNewtype<Email>((s: string) => s.includes("@"));
 * const email = Email("user@example.com"); // Validates then returns the string
 */
export function validatedNewtype<T>(
  validate: (value: UnwrapNewtype<T>) => boolean,
  errorMessage?: string,
): (value: UnwrapNewtype<T>) => T {
  return (value) => {
    if (!validate(value)) {
      throw new Error(errorMessage ?? `Invalid value for newtype: ${value}`);
    }
    return value as T;
  };
}

// ============================================================================
// Newtype Macros - Erase wrap/unwrap at compile time
// ============================================================================

export const wrapMacro = defineExpressionMacro({
  name: "wrap",
  module: "@ttfx/type-system",
  description: "Zero-cost newtype wrap — compiles away to the raw value",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
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
  module: "@ttfx/type-system",
  description: "Zero-cost newtype unwrap — compiles away to the raw value",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
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
  module: "@ttfx/type-system",
  description:
    "Zero-cost newtype constructor factory — the returned function compiles to identity",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    _args: readonly ts.Expression[],
  ): ts.Expression {
    // newtypeCtor<UserId>() => (v) => v
    // Which further inlines at call sites
    const factory = ctx.factory;
    const vIdent = ctx.generateUniqueName("v");
    const param = factory.createParameterDeclaration(
      undefined,
      undefined,
      vIdent,
    );
    return factory.createArrowFunction(
      undefined,
      undefined,
      [param],
      undefined,
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      factory.createIdentifier(vIdent.text),
    );
  },
});

// Register macros
globalRegistry.register(wrapMacro);
globalRegistry.register(unwrapMacro);
globalRegistry.register(newtypeCtorMacro);
