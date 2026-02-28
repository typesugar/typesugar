/**
 * Higher-Kinded Types (HKT) via Phantom Kind Markers
 *
 * This module provides a lightweight, zero-cost HKT encoding for TypeScript
 * using phantom type markers. The encoding is designed for:
 *
 * - Fast type checking (no recursive type instantiation)
 * - Valid TypeScript (works without macros, just slower error messages)
 * - Zero runtime overhead (types only, no brand objects)
 * - Seamless macro expansion (preprocessor resolves to concrete types)
 *
 * ## Three-Layer Architecture
 *
 * 1. **Lexical** (`F<A>` with `F<_>` declaration):
 *    Custom syntax, requires preprocessor
 *
 * 2. **Intermediate** (`Kind<F, A>`):
 *    Valid TypeScript, fast to type-check (just an intersection)
 *    This is what the preprocessor emits
 *
 * 3. **Final** (`Option<A>`):
 *    Concrete type, after preprocessor resolution for known type functions
 *
 * ## How it works
 *
 * `Kind<F, A>` is a phantom type marker - it carries the type function F
 * and argument A without forcing TypeScript to compute the result:
 *
 * ```typescript
 * type Kind<F, A> = F & { readonly __kind__: A };
 * ```
 *
 * This is just an intersection type - TypeScript stores it without
 * recursive computation. The preprocessor then resolves:
 *
 * - `Kind<OptionF, number>` → `Option<number>` (known type function)
 * - `Kind<F, A>` → unchanged (F is a type parameter)
 *
 * ## Usage
 *
 * ```typescript
 * import { Kind } from "@typesugar/type-system";
 *
 * // Define a type-level function for your type
 * interface OptionF { _: Option<this["__kind__"]> }
 *
 * // Use in typeclass definitions (with F<_> syntax)
 * interface Functor<F<_>> {
 *   map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
 * }
 *
 * // Preprocessor converts to:
 * interface Functor<F> {
 *   map<A, B>(fa: Kind<F, A>, f: (a: A) => B): Kind<F, B>;
 * }
 *
 * // When instantiated with OptionF, resolves to:
 * interface Functor<OptionF> {
 *   map<A, B>(fa: Option<A>, f: (a: A) => B): Option<B>;
 * }
 * ```
 *
 * ## Multi-arity type constructors
 *
 * For type constructors with multiple parameters, fix all but one:
 *
 * ```typescript
 * // Either<E, A> - fix E, vary A
 * interface EitherF<E> { _: Either<E, this["__kind__"]> }
 *
 * // Kind<EitherF<string>, number> → Either<string, number>
 * ```
 */

// ============================================================================
// Core HKT Encoding
// ============================================================================

/**
 * Base interface for type-level functions.
 *
 * All type-level functions (like `OptionF`, `ArrayF`) should extend this
 * interface to properly support the phantom kind marker encoding.
 */
export interface TypeFunction {
  readonly __kind__: unknown;
  readonly _: unknown;
}

/**
 * Phantom kind marker for HKT.
 *
 * `Kind<F, A>` represents "the type function F applied to A" without
 * forcing TypeScript to compute the result. This is fast to type-check
 * because it's just an intersection type.
 *
 * The preprocessor resolves `Kind<OptionF, A>` → `Option<A>` for known
 * type functions, leaving generic usages like `Kind<F, A>` unchanged.
 *
 * @example
 * ```typescript
 * // After preprocessor:
 * const x: Kind<OptionF, number> = Some(1);  // Resolves to Option<number>
 * function id<F>(fa: Kind<F, number>): Kind<F, number> { return fa; }  // Stays as Kind<F, number>
 * ```
 */
export type Kind<F, A> = F & { readonly __kind__: A };

/**
 * Alias for `Kind<F, A>` — shorthand syntax.
 *
 * Both `$<F, A>` and `Kind<F, A>` are identical.
 * The preprocessor uses `Kind` internally, but `$` is available for brevity.
 */
export type $<F, A> = Kind<F, A>;

/**
 * Apply a type-level function to get the concrete type.
 *
 * This extracts the result type from a type-level function by looking up
 * the `_` property. Use this when you need the actual computed type:
 *
 * ```typescript
 * type Result = Apply<OptionF, number>;  // Option<number>
 * ```
 *
 * Note: The preprocessor automatically resolves `Kind<OptionF, A>` to
 * `Option<A>` for known type functions, so you rarely need `Apply` directly.
 */
export type Apply<F extends TypeFunction, A> = (F & { readonly __kind__: A })["_"];

// ============================================================================
// Built-in Type-Level Functions for Standard TypeScript Types
// ============================================================================

/**
 * Type-level function for `Array<A>`.
 *
 * @example
 * ```typescript
 * type Numbers = Apply<ArrayF, number>; // Array<number>
 * // Or after preprocessor resolution:
 * type Numbers = Kind<ArrayF, number>;  // → Array<number>
 * ```
 */
export interface ArrayF extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: Array<this["__kind__"]>;
}

/**
 * Type-level function for `Promise<A>`.
 *
 * @example
 * ```typescript
 * type AsyncNumber = Apply<PromiseF, number>; // Promise<number>
 * ```
 */
export interface PromiseF extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: Promise<this["__kind__"]>;
}

/**
 * Type-level function for `Set<A>`.
 *
 * @example
 * ```typescript
 * type NumberSet = Apply<SetF, number>; // Set<number>
 * ```
 */
export interface SetF extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: Set<this["__kind__"]>;
}

/**
 * Type-level function for `ReadonlyArray<A>`.
 *
 * @example
 * ```typescript
 * type RONumbers = Apply<ReadonlyArrayF, number>; // readonly number[]
 * ```
 */
export interface ReadonlyArrayF extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: ReadonlyArray<this["__kind__"]>;
}

/**
 * Type-level function for `Map<K, V>` with K fixed.
 *
 * @example
 * ```typescript
 * type StringToNumber = Apply<MapF<string>, number>; // Map<string, number>
 * ```
 */
export interface MapF<K> extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: Map<K, this["__kind__"]>;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Unsafe coercion between types.
 *
 * Use sparingly — this bypasses TypeScript's type checking.
 * Primarily useful in typeclass implementations where the
 * type system cannot track certain invariants.
 */
export function unsafeCoerce<A, B>(a: A): B {
  return a as unknown as B;
}

// ============================================================================
// Legacy Compatibility (deprecated, will be removed)
// ============================================================================

/**
 * @deprecated Use `ArrayF` instead. Legacy HKT brand for Array.
 */
export interface ArrayHKT {
  readonly _brand: "ArrayHKT";
}

/**
 * @deprecated Use `PromiseF` instead. Legacy HKT brand for Promise.
 */
export interface PromiseHKT {
  readonly _brand: "PromiseHKT";
}
