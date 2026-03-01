/**
 * typesugar HKT Encoding: Phantom Intersection with Apply
 *
 * Kind<F, A> = F & { __kind__: A }
 * Apply<F, A> = extracts the concrete type
 *
 * Key insight: This encoding is designed for preprocessing.
 * The preprocessor rewrites Kind<OptionF, number> → Option<number>
 * So at type-check time, there's no HKT overhead.
 *
 * For benchmarking WITHOUT preprocessing, we use Apply<> explicitly.
 */

// Core encoding
export interface TypeFunction {
  readonly _: unknown;
}

export type Kind<F extends TypeFunction, A> = F & { readonly __kind__: A };

// Apply extracts the concrete type from a type function
// This is what the preprocessor does automatically
export type Apply<F extends TypeFunction, A> = (F & { readonly __kind__: A })["_"];

// Type-level functions for common types
export interface OptionF extends TypeFunction {
  readonly _: Option<this extends { __kind__: infer A } ? A : unknown>;
}

export interface ArrayF extends TypeFunction {
  readonly _: Array<this extends { __kind__: infer A } ? A : unknown>;
}

export interface EitherF<E> extends TypeFunction {
  readonly _: Either<E, this extends { __kind__: infer A } ? A : unknown>;
}

// Data types
export type Option<A> = { readonly _tag: "Some"; readonly value: A } | { readonly _tag: "None" };
export type Either<E, A> =
  | { readonly _tag: "Left"; readonly left: E }
  | { readonly _tag: "Right"; readonly right: A };

// Constructors
export const Some = <A>(value: A): Option<A> => ({ _tag: "Some", value });
export const None: Option<never> = { _tag: "None" };
export const Left = <E>(left: E): Either<E, never> => ({ _tag: "Left", left });
export const Right = <A>(right: A): Either<never, A> => ({ _tag: "Right", right });
