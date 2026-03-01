/**
 * Preprocessed output: No HKT, just concrete types
 *
 * This is what typesugar's preprocessor outputs when it resolves
 * all Kind<F, A> applications to their concrete types.
 *
 * Characteristics:
 * - No type-level computation for Kind resolution
 * - Direct types everywhere
 * - Fastest type-checking (baseline)
 * - What macros compile to at runtime
 */

// Data types (same as other versions)
export type Option<A> = { readonly _tag: "Some"; readonly value: A } | { readonly _tag: "None" };
export type Either<E, A> =
  | { readonly _tag: "Left"; readonly left: E }
  | { readonly _tag: "Right"; readonly right: A };

// Constructors
export const Some = <A>(value: A): Option<A> => ({ _tag: "Some", value });
export const None: Option<never> = { _tag: "None" };
export const Left = <E>(left: E): Either<E, never> => ({ _tag: "Left", left });
export const Right = <A>(right: A): Either<never, A> => ({ _tag: "Right", right });
