/**
 * Option Data Type (Zero-Cost Implementation)
 *
 * Option represents an optional value: every Option<A> is either a value A or null.
 * This is a safer alternative to null/undefined that:
 * - Has zero runtime overhead (no wrapper objects)
 * - Provides type-safe operations via utility functions
 * - Is fully compatible with the HKT/typeclass system
 *
 * ## Runtime Representation
 *
 * ```typescript
 * Option<number>  // At runtime: number | null
 * Some(42)        // At runtime: 42
 * None            // At runtime: null
 * ```
 */

import type { Eq, Ord, Ordering } from "../typeclasses/eq.js";
import type { Show } from "../typeclasses/show.js";
import type { Semigroup, Monoid } from "../typeclasses/semigroup.js";

// ============================================================================
// Option Type Definition (Zero-Cost)
// ============================================================================

/**
 * Option data type - either a value A or null
 *
 * This is a true zero-cost abstraction: at runtime, Some(42) is just 42,
 * and None is just null. No wrapper objects are allocated.
 */
export type Option<A> = A | null;

/**
 * Some type - represents presence of a non-null value
 * This is a type-level alias; at runtime it's just A
 */
export type Some<A> = A;

/**
 * None type - represents absence of value
 * This is a type-level alias; at runtime it's null
 */
export type None = null;

// ============================================================================
// Constructors
// ============================================================================

/**
 * Create a Some value (just returns the value as-is)
 */
export function Some<A>(value: A): Option<A> {
  return value;
}

/**
 * The None value (null)
 */
export const None: Option<never> = null;

/**
 * Create an Option from a nullable value
 * Identity function - Option<A> is already A | null
 */
export function fromNullable<A>(value: A | null | undefined): Option<A> {
  return value === undefined ? null : value;
}

/**
 * Create an Option from a predicate
 */
export function fromPredicate<A>(
  value: A,
  predicate: (a: A) => boolean,
): Option<A> {
  return predicate(value) ? value : null;
}

/**
 * Create an Option from a try/catch
 */
export function tryCatch<A>(f: () => A): Option<A> {
  try {
    return f();
  } catch {
    return null;
  }
}

/**
 * Create Some(a) if defined, None otherwise
 */
export function of<A>(a: A): Option<A> {
  return a;
}

/**
 * Create None
 */
export function none<A = never>(): Option<A> {
  return null;
}

/**
 * Create Some(a)
 */
export function some<A>(a: A): Option<A> {
  return a;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if Option is Some (has a value)
 */
export function isSome<A>(opt: Option<A>): opt is A {
  return opt !== null;
}

/**
 * Check if Option is None (is null)
 */
export function isNone<A>(opt: Option<A>): opt is null {
  return opt === null;
}

// ============================================================================
// Operations
// ============================================================================

/**
 * Map over the Option value
 */
export function map<A, B>(opt: Option<A>, f: (a: A) => B): Option<B> {
  return opt !== null ? f(opt) : null;
}

/**
 * FlatMap over the Option value
 */
export function flatMap<A, B>(
  opt: Option<A>,
  f: (a: A) => Option<B>,
): Option<B> {
  return opt !== null ? f(opt) : null;
}

/**
 * Apply a function in Option to a value in Option
 */
export function ap<A, B>(
  optF: Option<(a: A) => B>,
  optA: Option<A>,
): Option<B> {
  return optF !== null && optA !== null ? optF(optA) : null;
}

/**
 * Fold over Option - provide handlers for both cases
 */
export function fold<A, B>(
  opt: Option<A>,
  onNone: () => B,
  onSome: (a: A) => B,
): B {
  return opt !== null ? onSome(opt) : onNone();
}

/**
 * Match over Option (alias for fold with object syntax)
 */
export function match<A, B>(
  opt: Option<A>,
  patterns: { None: () => B; Some: (a: A) => B },
): B {
  return opt !== null ? patterns.Some(opt) : patterns.None();
}

/**
 * Get the value or a default
 */
export function getOrElse<A>(opt: Option<A>, defaultValue: () => A): A {
  return opt !== null ? opt : defaultValue();
}

/**
 * Get the value or a default (strict version)
 */
export function getOrElseStrict<A>(opt: Option<A>, defaultValue: A): A {
  return opt !== null ? opt : defaultValue;
}

/**
 * Get the value or throw
 */
export function getOrThrow<A>(opt: Option<A>, message?: string): A {
  if (opt !== null) return opt;
  throw new Error(message ?? "Called getOrThrow on None");
}

/**
 * Return the first Some, or evaluate the fallback
 */
export function orElse<A>(
  opt: Option<A>,
  fallback: () => Option<A>,
): Option<A> {
  return opt !== null ? opt : fallback();
}

/**
 * Filter the Option value
 */
export function filter<A>(
  opt: Option<A>,
  predicate: (a: A) => boolean,
): Option<A> {
  return opt !== null && predicate(opt) ? opt : null;
}

/**
 * Filter the Option value (inverted)
 */
export function filterNot<A>(
  opt: Option<A>,
  predicate: (a: A) => boolean,
): Option<A> {
  return filter(opt, (a) => !predicate(a));
}

/**
 * Check if the value satisfies a predicate
 */
export function exists<A>(
  opt: Option<A>,
  predicate: (a: A) => boolean,
): boolean {
  return opt !== null && predicate(opt);
}

/**
 * Check if all values satisfy a predicate (vacuously true for None)
 */
export function forall<A>(
  opt: Option<A>,
  predicate: (a: A) => boolean,
): boolean {
  return opt === null || predicate(opt);
}

/**
 * Check if the Option contains a specific value
 */
export function contains<A>(
  opt: Option<A>,
  value: A,
  eq: (a: A, b: A) => boolean = (a, b) => a === b,
): boolean {
  return opt !== null && eq(opt, value);
}

/**
 * Convert Option to Either
 */
export function toEither<E, A>(opt: Option<A>, left: () => E): Either<E, A> {
  return opt !== null ? Right(opt) : Left(left());
}

// Simple Either for toEither
type Either<E, A> =
  | { readonly _tag: "Left"; readonly left: E }
  | { readonly _tag: "Right"; readonly right: A };
const Left = <E, A>(left: E): Either<E, A> => ({ _tag: "Left", left });
const Right = <E, A>(right: A): Either<E, A> => ({ _tag: "Right", right });

/**
 * Convert Option to array
 */
export function toArray<A>(opt: Option<A>): A[] {
  return opt !== null ? [opt] : [];
}

/**
 * Convert Option to nullable (identity for null-based Option)
 */
export function toNullable<A>(opt: Option<A>): A | null {
  return opt;
}

/**
 * Convert Option to undefined
 */
export function toUndefined<A>(opt: Option<A>): A | undefined {
  return opt !== null ? opt : undefined;
}

/**
 * Zip two Options
 */
export function zip<A, B>(optA: Option<A>, optB: Option<B>): Option<[A, B]> {
  return optA !== null && optB !== null ? [optA, optB] : null;
}

/**
 * Zip with a function
 */
export function zipWith<A, B, C>(
  optA: Option<A>,
  optB: Option<B>,
  f: (a: A, b: B) => C,
): Option<C> {
  return optA !== null && optB !== null ? f(optA, optB) : null;
}

/**
 * Unzip an Option of tuple
 */
export function unzip<A, B>(opt: Option<[A, B]>): [Option<A>, Option<B>] {
  return opt !== null ? [opt[0], opt[1]] : [null, null];
}

/**
 * Flatten a nested Option
 */
export function flatten<A>(opt: Option<Option<A>>): Option<A> {
  return opt !== null ? opt : null;
}

/**
 * Tap - perform a side effect and return the original Option
 */
export function tap<A>(opt: Option<A>, f: (a: A) => void): Option<A> {
  if (opt !== null) {
    f(opt);
  }
  return opt;
}

/**
 * Traverse with a function that returns an Option
 */
export function traverse<A, B>(arr: A[], f: (a: A) => Option<B>): Option<B[]> {
  const results: B[] = [];
  for (const a of arr) {
    const opt = f(a);
    if (opt === null) return null;
    results.push(opt);
  }
  return results;
}

/**
 * Sequence an array of Options
 */
export function sequence<A>(opts: Option<A>[]): Option<A[]> {
  return traverse(opts, (opt) => opt);
}

/**
 * Check if Option is defined (has value)
 */
export function isDefined<A>(opt: Option<A>): boolean {
  return opt !== null;
}

/**
 * Check if Option is empty
 */
export function isEmpty<A>(opt: Option<A>): boolean {
  return opt === null;
}

// ============================================================================
// Typeclass Instances
// ============================================================================

/**
 * Eq instance for Option
 */
export function getEq<A>(E: Eq<A>): Eq<Option<A>> {
  return {
    eqv: (x, y) => {
      if (x === null && y === null) return true;
      if (x !== null && y !== null) return E.eqv(x, y);
      return false;
    },
  };
}

/**
 * Ord instance for Option (None < Some)
 */
export function getOrd<A>(O: Ord<A>): Ord<Option<A>> {
  return {
    eqv: getEq(O).eqv,
    compare: (x, y) => {
      if (x === null && y === null) return 0 as Ordering;
      if (x === null) return -1 as Ordering;
      if (y === null) return 1 as Ordering;
      return O.compare(x, y);
    },
  };
}

/**
 * Show instance for Option
 */
export function getShow<A>(S: Show<A>): Show<Option<A>> {
  return {
    show: (opt) => (opt !== null ? `Some(${S.show(opt)})` : "None"),
  };
}

/**
 * Semigroup instance for Option (combines inner values)
 */
export function getSemigroup<A>(S: Semigroup<A>): Semigroup<Option<A>> {
  return {
    combine: (x, y) => {
      if (x === null) return y;
      if (y === null) return x;
      return S.combine(x, y);
    },
  };
}

/**
 * Monoid instance for Option
 */
export function getMonoid<A>(S: Semigroup<A>): Monoid<Option<A>> {
  return {
    ...getSemigroup(S),
    empty: null,
  };
}

/**
 * Alternative monoid - first Some wins
 */
export function getFirstMonoid<A>(): Monoid<Option<A>> {
  return {
    combine: (x, y) => (x !== null ? x : y),
    empty: null,
  };
}

/**
 * Alternative monoid - last Some wins
 */
export function getLastMonoid<A>(): Monoid<Option<A>> {
  return {
    combine: (x, y) => (y !== null ? y : x),
    empty: null,
  };
}

// ============================================================================
// Do-notation Support
// ============================================================================

/**
 * Start a do-comprehension with Option
 */
export const Do: Option<{}> = {};

/**
 * Bind a value in do-notation style
 */
export function bind<N extends string, A extends object, B>(
  name: Exclude<N, keyof A>,
  f: (a: A) => Option<B>,
): (opt: Option<A>) => Option<A & { readonly [K in N]: B }> {
  return (opt) => {
    if (opt === null) return null;
    const b = f(opt);
    if (b === null) return null;
    return { ...opt, [name]: b } as A & { readonly [K in N]: B };
  };
}

/**
 * Let - bind a non-effectful value
 */
export function let_<N extends string, A extends object, B>(
  name: Exclude<N, keyof A>,
  f: (a: A) => B,
): (opt: Option<A>) => Option<A & { readonly [K in N]: B }> {
  return (opt) => {
    if (opt === null) return null;
    return { ...opt, [name]: f(opt) } as A & { readonly [K in N]: B };
  };
}

// ============================================================================
// Fluent API (Option class)
// ============================================================================

/**
 * Option with fluent methods
 *
 * Note: The fluent wrapper does add a small allocation overhead.
 * For zero-cost operations, use the standalone functions directly.
 */
export class OptionImpl<A> {
  private constructor(private readonly opt: Option<A>) {}

  static some<A>(value: A): OptionImpl<A> {
    return new OptionImpl(value);
  }

  static none<A>(): OptionImpl<A> {
    return new OptionImpl(null as Option<A>);
  }

  static fromNullable<A>(value: A | null | undefined): OptionImpl<A> {
    return new OptionImpl(fromNullable(value));
  }

  static fromPredicate<A>(
    value: A,
    predicate: (a: A) => boolean,
  ): OptionImpl<A> {
    return new OptionImpl(fromPredicate(value, predicate));
  }

  get value(): Option<A> {
    return this.opt;
  }

  isSome(): boolean {
    return this.opt !== null;
  }

  isNone(): boolean {
    return this.opt === null;
  }

  map<B>(f: (a: A) => B): OptionImpl<B> {
    return new OptionImpl(map(this.opt, f));
  }

  flatMap<B>(f: (a: A) => Option<B>): OptionImpl<B> {
    return new OptionImpl(flatMap(this.opt, f));
  }

  chain<B>(f: (a: A) => OptionImpl<B>): OptionImpl<B> {
    return new OptionImpl(flatMap(this.opt, (a) => f(a).value));
  }

  ap<B>(this: OptionImpl<(a: A) => B>, optA: OptionImpl<A>): OptionImpl<B> {
    return new OptionImpl(ap(this.opt, optA.opt));
  }

  fold<B>(onNone: () => B, onSome: (a: A) => B): B {
    return fold(this.opt, onNone, onSome);
  }

  getOrElse(defaultValue: () => A): A {
    return getOrElse(this.opt, defaultValue);
  }

  getOrElseValue(defaultValue: A): A {
    return getOrElseStrict(this.opt, defaultValue);
  }

  getOrThrow(message?: string): A {
    return getOrThrow(this.opt, message);
  }

  orElse(fallback: () => Option<A>): OptionImpl<A> {
    return new OptionImpl(orElse(this.opt, fallback));
  }

  filter(predicate: (a: A) => boolean): OptionImpl<A> {
    return new OptionImpl(filter(this.opt, predicate));
  }

  filterNot(predicate: (a: A) => boolean): OptionImpl<A> {
    return new OptionImpl(filterNot(this.opt, predicate));
  }

  exists(predicate: (a: A) => boolean): boolean {
    return exists(this.opt, predicate);
  }

  forall(predicate: (a: A) => boolean): boolean {
    return forall(this.opt, predicate);
  }

  contains(value: A): boolean {
    return contains(this.opt, value);
  }

  toArray(): A[] {
    return toArray(this.opt);
  }

  toNullable(): A | null {
    return toNullable(this.opt);
  }

  toUndefined(): A | undefined {
    return toUndefined(this.opt);
  }

  zip<B>(other: OptionImpl<B>): OptionImpl<[A, B]> {
    return new OptionImpl(zip(this.opt, other.opt));
  }

  tap(f: (a: A) => void): OptionImpl<A> {
    return new OptionImpl(tap(this.opt, f));
  }
}
