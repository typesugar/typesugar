/**
 * Effect-TS HKT Encoding: TypeLambda with this-type
 *
 * Uses `this["Target"]` for type application via indexed access
 *
 * Characteristics:
 * - Explicit variance positions (In, Out1, Out2)
 * - More type computation per application
 * - Better IDE display (often shows concrete type)
 * - Used by Effect ecosystem
 */

// Core encoding - matches Effect's approach
export interface TypeLambda {
  readonly In: unknown;
  readonly Out2: unknown;
  readonly Out1: unknown;
  readonly Target: unknown;
}

// Kind type - resolves TypeLambda to concrete type
export type Kind<F extends TypeLambda, In, Out2, Out1, Target> = F extends {
  readonly type: unknown;
}
  ? (F & {
      readonly In: In;
      readonly Out2: Out2;
      readonly Out1: Out1;
      readonly Target: Target;
    })["type"]
  : {
      readonly F: F;
      readonly In: (_: In) => In;
      readonly Out2: () => Out2;
      readonly Out1: () => Out1;
      readonly Target: () => Target;
    };

// Variance markers (from Effect/Types.ts)
export declare const Covariant: unique symbol;
export type Covariant = typeof Covariant;

export declare const Contravariant: unique symbol;
export type Contravariant = typeof Contravariant;

export declare const Invariant: unique symbol;
export type Invariant = typeof Invariant;

// Type-level functions for common types
export interface OptionTypeLambda extends TypeLambda {
  readonly type: Option<this["Target"]>;
}

export interface ArrayTypeLambda extends TypeLambda {
  readonly type: Array<this["Target"]>;
}

// EitherTypeLambda uses Out2 for error type (covariant position)
export interface EitherTypeLambda extends TypeLambda {
  readonly type: Either<this["Out2"], this["Target"]>;
}

export interface PromiseTypeLambda extends TypeLambda {
  readonly type: Promise<this["Target"]>;
}

// Data types (same as typesugar version for fair comparison)
export type Option<A> = { readonly _tag: "Some"; readonly value: A } | { readonly _tag: "None" };
export type Either<E, A> =
  | { readonly _tag: "Left"; readonly left: E }
  | { readonly _tag: "Right"; readonly right: A };

// Constructors
export const Some = <A>(value: A): Option<A> => ({ _tag: "Some", value });
export const None: Option<never> = { _tag: "None" };
export const Left = <E>(left: E): Either<E, never> => ({ _tag: "Left", left });
export const Right = <A>(right: A): Either<never, A> => ({ _tag: "Right", right });
