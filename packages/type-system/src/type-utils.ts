/**
 * Type-Level Boolean Utilities
 *
 * Pure type-level constructs for compile-time type assertions and comparisons.
 * These are the canonical definitions — other packages should re-export from here.
 *
 * @example
 * ```typescript
 * import { Equal, Extends, Not, And, Or, IsNever, IsAny, IsUnknown } from "@typesugar/type-system";
 *
 * // Type-level equality check
 * type Test1 = Equal<string, string>;  // true
 * type Test2 = Equal<string, number>;  // false
 *
 * // Subtype check
 * type Test3 = Extends<"hello", string>;  // true
 *
 * // Boolean combinators
 * type Test4 = And<true, true>;   // true
 * type Test5 = Or<false, true>;   // true
 * type Test6 = Not<false>;        // true
 *
 * // Special type checks
 * type Test7 = IsNever<never>;    // true
 * type Test8 = IsAny<any>;        // true
 * type Test9 = IsUnknown<unknown>; // true
 * ```
 */

/**
 * Type-level equality check.
 *
 * Uses the distributive conditional type trick to accurately detect
 * type equality, including edge cases like `any` vs `unknown`.
 *
 * This is the "strong" formulation that correctly handles:
 * - `Equal<any, unknown>` → false
 * - `Equal<never, never>` → true
 * - `Equal<1 | 2, 2 | 1>` → true
 */
export type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/**
 * Type-level subtype check.
 *
 * Returns `true` if `A` extends `B`.
 */
export type Extends<A, B> = A extends B ? true : false;

/**
 * Type-level NOT.
 *
 * Negates a boolean type.
 */
export type Not<T extends boolean> = T extends true ? false : true;

/**
 * Type-level AND.
 *
 * Returns `true` only if both `A` and `B` are `true`.
 */
export type And<A extends boolean, B extends boolean> = A extends true
  ? B extends true
    ? true
    : false
  : false;

/**
 * Type-level OR.
 *
 * Returns `true` if either `A` or `B` is `true`.
 */
export type Or<A extends boolean, B extends boolean> = A extends true
  ? true
  : B extends true
    ? true
    : false;

/**
 * Check if a type is exactly `never`.
 *
 * Uses the tuple trick to avoid distributive conditional types.
 */
export type IsNever<T> = [T] extends [never] ? true : false;

/**
 * Check if a type is `any`.
 *
 * Exploits the fact that `0 extends 1 & any` is true (since `any` absorbs everything).
 */
export type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * Check if a type is `unknown`.
 *
 * Returns true only for `unknown`, not for `any`.
 */
export type IsUnknown<T> = IsAny<T> extends true ? false : unknown extends T ? true : false;

/**
 * Assert that two types are equal (deprecated alias).
 *
 * @deprecated Use `Equal<A, B>` instead. This alias exists for backward
 * compatibility with code that used `Equals` from @typesugar/zero-cost.
 */
export type Equals<A, B> = Equal<A, B>;
