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

import type { TypeFunction } from "@typesugar/type-system";
import type { Eq, Ord, Ordering } from "../typeclasses/eq.js";
import type { Show } from "../typeclasses/show.js";
import type { Semigroup, Monoid } from "../typeclasses/semigroup.js";

// ============================================================================
// Option Type Definition (Zero-Cost)
// ============================================================================

/**
 * Defined<T> - Wrapper for values that may legitimately include null.
 *
 * Use this escape hatch when you need:
 * - `Option<null>` (e.g., nullable JSON values)
 * - `Option<string | null>` (e.g., optional nullable fields)
 * - `Option<Option<T>>` (nested optionality)
 *
 * @example
 * ```ts
 * // Without Defined, this would cause type collapse
 * type BadNested = Option<null>;  // Compile error
 *
 * // With Defined, it works correctly
 * type GoodNested = Option<Defined<null>>;  // { value: null } | null
 *
 * const present = defined(null);     // { value: null } - Some(null)
 * const absent: Option<Defined<null>> = None;  // null - None
 *
 * if (isSome(present)) {
 *   const inner = unwrapDefined(present);  // null
 * }
 * ```
 *
 * @see Finding #1 in FINDINGS.md - Option<null> type collapse fix
 */
export type Defined<T> = { readonly value: T };

/**
 * Wrap a value that may be null in a Defined wrapper.
 * This preserves the distinction between "no value" (None) and "value is null".
 */
export function defined<T>(value: T): Defined<T> {
  return { value };
}

/**
 * Unwrap a Defined value to get the inner value.
 */
export function unwrapDefined<T>(d: Defined<T>): T {
  return d.value;
}

/**
 * Option data type — an opaque wrapper over `A | null`.
 *
 * At runtime, `Some(42)` is just `42` and `None` is just `null`.
 * No wrapper objects are allocated — this is a true zero-cost abstraction.
 *
 * The `@opaque` macro erases method calls to companion standalone functions,
 * so `opt.map(f)` compiles to `map(opt, f)` with full type inference.
 *
 * Within this defining file the type is transparent — implementations use
 * the underlying `A | null` representation directly.
 *
 * @opaque A | null
 * @hkt
 */
export interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
  flatMap<B>(f: (a: A) => Option<B>): Option<B>;
  fold<B>(onNone: () => B, onSome: (a: A) => B): B;
  match<B>(patterns: { None: () => B; Some: (a: A) => B }): B;
  getOrElse(defaultValue: () => A): A;
  getOrElseStrict(defaultValue: A): A;
  getOrThrow(message?: string): A;
  orElse(fallback: () => Option<A>): Option<A>;
  filter(predicate: (a: A) => boolean): Option<A>;
  filterNot(predicate: (a: A) => boolean): Option<A>;
  exists(predicate: (a: A) => boolean): boolean;
  forall(predicate: (a: A) => boolean): boolean;
  contains(value: A, eq?: (a: A, b: A) => boolean): boolean;
  tap(f: (a: A) => void): Option<A>;
  toArray(): A[];
  toNullable(): A | null;
  toUndefined(): A | undefined;
  zip<B>(optB: Option<B>): Option<[A, B]>;
}

/**
 * Type-level function for `Option<A>`.
 * Kind<OptionF, number> resolves to Option<number>.
 */
export interface OptionF extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: Option<this["__kind__"]>;
}

/**
 * Some type — an Option known to contain a value.
 * At runtime it's just A (identity representation).
 */
export type Some<A> = Option<A>;

/**
 * None type — an Option known to be empty.
 * At runtime it's just null.
 */
export type None = Option<never>;

// ============================================================================
// Constructors
// ============================================================================

/**
 * Create a Some value (just returns the value as-is)
 */
export function Some<A>(value: A): Option<A> {
  return value as any;
}

/**
 * The None value (null)
 */
export const None: Option<never> = null as any;

/**
 * Create an Option from a nullable value
 * Identity function - Option<A> is already A | null
 */
export function fromNullable<A>(value: A | null | undefined): Option<A> {
  return (value === undefined ? null : value) as any;
}

/**
 * Create an Option from a predicate
 */
export function fromPredicate<A>(value: A, predicate: (a: A) => boolean): Option<A> {
  return (predicate(value) ? value : null) as any;
}

/**
 * Create an Option from a try/catch
 */
export function tryCatch<A>(f: () => A): Option<A> {
  try {
    return f() as any;
  } catch {
    return null as any;
  }
}

/**
 * Create Some(a) if defined, None otherwise
 */
export function of<A>(a: A): Option<A> {
  return a as any;
}

/**
 * Create None
 */
export function none<A = never>(): Option<A> {
  return null as any;
}

/**
 * Create Some(a)
 */
export function some<A>(a: A): Option<A> {
  return a as any;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if Option is Some (has a value)
 */
export function isSome<A>(opt: Option<A>): boolean {
  return (opt as any) !== null;
}

/**
 * Check if Option is None (is null)
 */
export function isNone<A>(opt: Option<A>): boolean {
  return (opt as any) === null;
}

// ============================================================================
// Operations
// ============================================================================

/**
 * Map over the Option value
 */
export function map<A, B>(opt: Option<A>, f: (a: A) => B): Option<B> {
  const o: any = opt;
  return (o !== null ? f(o) : null) as any;
}

/**
 * FlatMap over the Option value
 */
export function flatMap<A, B>(opt: Option<A>, f: (a: A) => Option<B>): Option<B> {
  const o: any = opt;
  return (o !== null ? f(o) : null) as any;
}

/**
 * Apply a function in Option to a value in Option
 */
export function ap<A, B>(optF: Option<(a: A) => B>, optA: Option<A>): Option<B> {
  const f: any = optF;
  const a: any = optA;
  return (f !== null && a !== null ? f(a) : null) as any;
}

/**
 * Fold over Option - provide handlers for both cases
 */
export function fold<A, B>(opt: Option<A>, onNone: () => B, onSome: (a: A) => B): B {
  const o: any = opt;
  return o !== null ? onSome(o) : onNone();
}

/**
 * Match over Option (alias for fold with object syntax)
 */
export function match<A, B>(opt: Option<A>, patterns: { None: () => B; Some: (a: A) => B }): B {
  const o: any = opt;
  return o !== null ? patterns.Some(o) : patterns.None();
}

/**
 * Get the value or a default
 */
export function getOrElse<A>(opt: Option<A>, defaultValue: () => A): A {
  const o: any = opt;
  return o !== null ? o : defaultValue();
}

/**
 * Get the value or a default (strict version)
 */
export function getOrElseStrict<A>(opt: Option<A>, defaultValue: A): A {
  const o: any = opt;
  return o !== null ? o : defaultValue;
}

/**
 * Get the value or throw
 */
export function getOrThrow<A>(opt: Option<A>, message?: string): A {
  const o: any = opt;
  if (o !== null) return o;
  throw new Error(message ?? "Called getOrThrow on None");
}

/**
 * Return the first Some, or evaluate the fallback
 */
export function orElse<A>(opt: Option<A>, fallback: () => Option<A>): Option<A> {
  const o: any = opt;
  return o !== null ? o : fallback();
}

/**
 * Filter the Option value
 */
export function filter<A>(opt: Option<A>, predicate: (a: A) => boolean): Option<A> {
  const o: any = opt;
  return (o !== null && predicate(o) ? o : null) as any;
}

/**
 * Filter the Option value (inverted)
 */
export function filterNot<A>(opt: Option<A>, predicate: (a: A) => boolean): Option<A> {
  return filter(opt, (a) => !predicate(a));
}

/**
 * Check if the value satisfies a predicate
 */
export function exists<A>(opt: Option<A>, predicate: (a: A) => boolean): boolean {
  const o: any = opt;
  return o !== null && predicate(o);
}

/**
 * Check if all values satisfy a predicate (vacuously true for None)
 */
export function forall<A>(opt: Option<A>, predicate: (a: A) => boolean): boolean {
  const o: any = opt;
  return o === null || predicate(o);
}

/**
 * Check if the Option contains a specific value
 */
export function contains<A>(
  opt: Option<A>,
  value: A,
  eq: (a: A, b: A) => boolean = (a, b) => a === b
): boolean {
  const o: any = opt;
  return o !== null && eq(o, value);
}

/**
 * Convert Option to Either
 */
export function toEither<E, A>(opt: Option<A>, left: () => E): Either<E, A> {
  const o: any = opt;
  return o !== null ? Right(o) : Left(left());
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
  const o: any = opt;
  return o !== null ? [o] : [];
}

/**
 * Convert Option to nullable (identity for null-based Option)
 */
export function toNullable<A>(opt: Option<A>): A | null {
  return opt as any;
}

/**
 * Convert Option to undefined
 */
export function toUndefined<A>(opt: Option<A>): A | undefined {
  const o: any = opt;
  return o !== null ? o : undefined;
}

/**
 * Zip two Options
 */
export function zip<A, B>(optA: Option<A>, optB: Option<B>): Option<[A, B]> {
  const a: any = optA;
  const b: any = optB;
  return (a !== null && b !== null ? [a, b] : null) as any;
}

/**
 * Zip with a function
 */
export function zipWith<A, B, C>(
  optA: Option<A>,
  optB: Option<B>,
  f: (a: A, b: B) => C
): Option<C> {
  const a: any = optA;
  const b: any = optB;
  return (a !== null && b !== null ? f(a, b) : null) as any;
}

/**
 * Unzip an Option of tuple
 */
export function unzip<A, B>(opt: Option<[A, B]>): [Option<A>, Option<B>] {
  const o: any = opt;
  return (o !== null ? [o[0], o[1]] : [null, null]) as any;
}

/**
 * Flatten a nested Option
 */
export function flatten<A>(opt: Option<Option<A>>): Option<A> {
  const o: any = opt;
  return (o !== null ? o : null) as any;
}

/**
 * Tap - perform a side effect and return the original Option
 */
export function tap<A>(opt: Option<A>, f: (a: A) => void): Option<A> {
  const o: any = opt;
  if (o !== null) {
    f(o);
  }
  return o;
}

/**
 * Traverse with a function that returns an Option
 */
export function traverse<A, B>(arr: A[], f: (a: A) => Option<B>): Option<B[]> {
  const results: B[] = [];
  for (const a of arr) {
    const o: any = f(a);
    if (o === null) return null as any;
    results.push(o);
  }
  return results as any;
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
  return (opt as any) !== null;
}

/**
 * Check if Option is empty
 */
export function isEmpty<A>(opt: Option<A>): boolean {
  return (opt as any) === null;
}

// ============================================================================
// Typeclass Instances
// ============================================================================

/**
 * Eq instance for Option.
 *
 * Enables operator rewriting: `optA === optB` → `getEq(eqA).eqv(optA, optB)`
 *
 * @example
 * ```typescript
 * const eqOptNum = getEq(eqNumber);
 * const a = Some(1);
 * const b = Some(1);
 *
 * // With transformer: a === b → eqOptNum.eqv(a, b) → true
 * ```
 */
export function getEq<A>(E: Eq<A>): Eq<Option<A>> {
  return {
    eqv: (x: any, y: any) => {
      if (x === null && y === null) return true;
      if (x !== null && y !== null) return E.eqv(x, y);
      return false;
    },
  };
}

/**
 * Ord instance for Option (None < Some).
 *
 * Enables operator rewriting for comparison operators:
 * - `optA < optB` → `getOrd(ordA).lessThan(optA, optB)`
 *
 * @example
 * ```typescript
 * const ordOptNum = getOrd(ordNumber);
 * const a = Some(1);
 * const b = Some(2);
 *
 * // With transformer: a < b → ordOptNum.lessThan(a, b) → true
 * ```
 */
export function getOrd<A>(O: Ord<A>): Ord<Option<A>> {
  const compare = (x: Option<A>, y: Option<A>): Ordering => {
    const a: any = x;
    const b: any = y;
    if (a === null && b === null) return 0 as Ordering;
    if (a === null) return -1 as Ordering;
    if (b === null) return 1 as Ordering;
    return O.compare(a, b);
  };
  return {
    eqv: getEq(O).eqv,
    compare,
    lessThan: (x, y) => compare(x, y) === -1,
    lessThanOrEqual: (x, y) => compare(x, y) !== 1,
    greaterThan: (x, y) => compare(x, y) === 1,
    greaterThanOrEqual: (x, y) => compare(x, y) !== -1,
  };
}

/**
 * Show instance for Option
 */
export function getShow<A>(S: Show<A>): Show<Option<A>> {
  return {
    show: (opt: any) => (opt !== null ? `Some(${S.show(opt)})` : "None"),
  };
}

/**
 * Semigroup instance for Option (combines inner values)
 */
export function getSemigroup<A>(S: Semigroup<A>): Semigroup<Option<A>> {
  return {
    combine: (x: any, y: any) => {
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
    empty: null as any,
  };
}

/**
 * Alternative monoid - first Some wins
 */
export function getFirstMonoid<A>(): Monoid<Option<A>> {
  return {
    combine: (x: any, y: any) => (x !== null ? x : y),
    empty: null as any,
  };
}

/**
 * Alternative monoid - last Some wins
 */
export function getLastMonoid<A>(): Monoid<Option<A>> {
  return {
    combine: (x: any, y: any) => (y !== null ? y : x),
    empty: null as any,
  };
}

// ============================================================================
// Do-notation Support
// ============================================================================

/**
 * Start a do-comprehension with Option
 */
export const Do: Option<{}> = {} as any;

/**
 * Bind a value in do-notation style
 */
export function bind<N extends string, A extends object, B>(
  name: Exclude<N, keyof A>,
  f: (a: A) => Option<B>
): (opt: Option<A>) => Option<A & { readonly [K in N]: B }> {
  return ((opt: any) => {
    if (opt === null) return null;
    const b: any = f(opt);
    if (b === null) return null;
    return { ...opt, [name]: b };
  }) as any;
}

/**
 * Let - bind a non-effectful value
 */
export function let_<N extends string, A extends object, B>(
  name: Exclude<N, keyof A>,
  f: (a: A) => B
): (opt: Option<A>) => Option<A & { readonly [K in N]: B }> {
  return ((opt: any) => {
    if (opt === null) return null;
    return { ...opt, [name]: f(opt) };
  }) as any;
}

// ============================================================================
// Fluent API (Option class)
// ============================================================================

// ============================================================================
// Option Namespace Object
// ============================================================================

/**
 * Option namespace - groups all Option operations for clean API access.
 *
 * @example
 * ```typescript
 * import { Option, Some, None } from "@typesugar/fp";
 *
 * const x: Option<number> = Some(42);
 * Option.map(x, n => n * 2);        // Some(84)
 * Option.flatMap(x, n => Some(n));  // Some(42)
 * Option.getOrElse(None, () => 0);  // 0
 * ```
 */
export const Option = {
  // Constructors
  some,
  none,
  of,
  fromNullable,
  fromPredicate,
  tryCatch,

  // Type guards
  isSome,
  isNone,
  isDefined,
  isEmpty,

  // Core operations
  map,
  flatMap,
  ap,
  fold,
  match,
  getOrElse,
  getOrElseStrict,
  getOrThrow,
  orElse,
  filter,
  filterNot,
  exists,
  forall,
  contains,
  flatten,
  tap,

  // Conversions
  toEither,
  toArray,
  toNullable,
  toUndefined,

  // Combinators
  zip,
  zipWith,
  unzip,
  traverse,
  sequence,

  // Typeclass instances
  getEq,
  getOrd,
  getShow,
  getSemigroup,
  getMonoid,
  getFirstMonoid,
  getLastMonoid,

  // Do-notation
  Do,
  bind,
  let_,

  // Defined wrapper (for Option<null>)
  defined,
  unwrapDefined,
} as const;

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
    return new OptionImpl(value as any);
  }

  static none<A>(): OptionImpl<A> {
    return new OptionImpl(null as any);
  }

  static fromNullable<A>(value: A | null | undefined): OptionImpl<A> {
    return new OptionImpl(fromNullable(value));
  }

  static fromPredicate<A>(value: A, predicate: (a: A) => boolean): OptionImpl<A> {
    return new OptionImpl(fromPredicate(value, predicate));
  }

  get value(): Option<A> {
    return this.opt;
  }

  isSome(): boolean {
    return (this.opt as any) !== null;
  }

  isNone(): boolean {
    return (this.opt as any) === null;
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
