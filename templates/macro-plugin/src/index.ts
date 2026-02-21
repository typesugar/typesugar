/**
 * My typesugar Macros
 *
 * This package provides custom macros for typesugar.
 *
 * ## Runtime API (for users)
 *
 * Import from the main entry point:
 *
 * ```typescript
 * import { logged, memo, DeriveValidation } from "my-typesugar-macros";
 * ```
 *
 * ## Macro Registration (for transformer)
 *
 * The transformer will automatically load macros from:
 *
 * ```typescript
 * import "my-typesugar-macros/macros";
 * ```
 */

// Runtime placeholder functions
// These are replaced at compile-time by the transformer

/**
 * Wraps a function with console logging of inputs and outputs.
 *
 * @example
 * const add = logged((a: number, b: number) => a + b);
 * add(1, 2); // logs: "add(1, 2) => 3"
 */
export declare function logged<F extends (...args: unknown[]) => unknown>(fn: F): F;

/**
 * Memoizes a pure function.
 *
 * @example
 * const fib = memo((n: number): number => {
 *   if (n <= 1) return n;
 *   return fib(n - 1) + fib(n - 2);
 * });
 */
export declare function memo<F extends (...args: unknown[]) => unknown>(fn: F): F;

/**
 * Derive macro that generates validation for a class.
 *
 * @example
 * @derive(Validation)
 * class User {
 *   @validate.email
 *   email: string;
 *
 *   @validate.min(0)
 *   age: number;
 * }
 */
export const Validation = Symbol("Validation");
