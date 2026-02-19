/**
 * NonEmptyList Data Type
 *
 * A list that is guaranteed to have at least one element.
 * Useful for operations that require a non-empty collection.
 */

import type { List } from "./list.js";
import * as L from "./list.js";
import type { Option } from "./option.js";
import { Some, None, isSome } from "./option.js";
import type { Eq, Ord, Ordering } from "../typeclasses/eq.js";
import type { Show } from "../typeclasses/show.js";
import type { Semigroup } from "../typeclasses/semigroup.js";

// ============================================================================
// NonEmptyList Type Definition
// ============================================================================

/**
 * NonEmptyList - guaranteed to have at least one element
 */
export interface NonEmptyList<A> {
  readonly _tag: "NonEmptyList";
  readonly head: A;
  readonly tail: List<A>;
}

// ============================================================================
// Constructors
// ============================================================================

/**
 * Create a NonEmptyList
 */
export function NonEmptyList<A>(head: A, tail: List<A>): NonEmptyList<A> {
  return { _tag: "NonEmptyList", head, tail };
}

/**
 * Create a NonEmptyList from variadic arguments
 */
export function of<A>(head: A, ...tail: A[]): NonEmptyList<A> {
  return NonEmptyList(head, L.fromArray(tail));
}

/**
 * Create a single-element NonEmptyList
 */
export function singleton<A>(a: A): NonEmptyList<A> {
  return NonEmptyList(a, L.Nil);
}

/**
 * Create a NonEmptyList from an array (fails if empty)
 */
export function fromArray<A>(arr: readonly A[]): Option<NonEmptyList<A>> {
  if (arr.length === 0) return None;
  return Some(NonEmptyList(arr[0], L.fromArray(arr.slice(1))));
}

/**
 * Create a NonEmptyList from a List (fails if empty)
 */
export function fromList<A>(list: List<A>): Option<NonEmptyList<A>> {
  if (L.isNil(list)) return None;
  return Some(NonEmptyList(list.head, list.tail));
}

/**
 * Unsafe: Create from array (throws if empty)
 */
export function unsafeFromArray<A>(arr: readonly A[]): NonEmptyList<A> {
  if (arr.length === 0) {
    throw new Error("Cannot create NonEmptyList from empty array");
  }
  return NonEmptyList(arr[0], L.fromArray(arr.slice(1)));
}

/**
 * Create a NonEmptyList with n copies of a value
 */
export function replicate<A>(n: number, a: A): Option<NonEmptyList<A>> {
  if (n <= 0) return None;
  return Some(NonEmptyList(a, L.replicate(n - 1, a)));
}

// ============================================================================
// Basic Operations
// ============================================================================

/**
 * Get the head (always succeeds)
 */
export function head<A>(nel: NonEmptyList<A>): A {
  return nel.head;
}

/**
 * Get the tail as a List
 */
export function tail<A>(nel: NonEmptyList<A>): List<A> {
  return nel.tail;
}

/**
 * Get the last element
 */
export function last<A>(nel: NonEmptyList<A>): A {
  const listLast = L.last(nel.tail);
  // With null-based Option, listLast IS the value when it's not null
  return isSome(listLast) ? listLast : nel.head;
}

/**
 * Get all but the last element
 */
export function init<A>(nel: NonEmptyList<A>): List<A> {
  if (L.isNil(nel.tail)) return L.Nil;
  return L.Cons(
    nel.head,
    L.toArray(nel.tail)
      .slice(0, -1)
      .reduce((acc: List<A>, a) => L.append(acc, L.singleton(a)), L.Nil),
  );
}

/**
 * Get the length (always >= 1)
 */
export function length<A>(nel: NonEmptyList<A>): number {
  return 1 + L.length(nel.tail);
}

/**
 * Get the nth element (0-indexed)
 */
export function get<A>(nel: NonEmptyList<A>, index: number): Option<A> {
  if (index === 0) return Some(nel.head);
  return L.get(nel.tail, index - 1);
}

/**
 * Convert to a List
 */
export function toList<A>(nel: NonEmptyList<A>): List<A> {
  return L.Cons(nel.head, nel.tail);
}

/**
 * Convert to an array
 */
export function toArray<A>(nel: NonEmptyList<A>): A[] {
  return [nel.head, ...L.toArray(nel.tail)];
}

// ============================================================================
// Transformations
// ============================================================================

/**
 * Map over the NonEmptyList
 */
export function map<A, B>(
  nel: NonEmptyList<A>,
  f: (a: A) => B,
): NonEmptyList<B> {
  return NonEmptyList(f(nel.head), L.map(nel.tail, f));
}

/**
 * FlatMap over the NonEmptyList
 */
export function flatMap<A, B>(
  nel: NonEmptyList<A>,
  f: (a: A) => NonEmptyList<B>,
): NonEmptyList<B> {
  const headResult = f(nel.head);
  const tailResults = L.flatMap(nel.tail, (a) => toList(f(a)));
  return NonEmptyList(headResult.head, L.append(headResult.tail, tailResults));
}

/**
 * Apply a function in NonEmptyList to a value in NonEmptyList
 */
export function ap<A, B>(
  nelF: NonEmptyList<(a: A) => B>,
  nelA: NonEmptyList<A>,
): NonEmptyList<B> {
  return flatMap(nelF, (f) => map(nelA, f));
}

/**
 * Reverse the NonEmptyList
 */
export function reverse<A>(nel: NonEmptyList<A>): NonEmptyList<A> {
  const arr = toArray(nel);
  arr.reverse();
  return unsafeFromArray(arr);
}

/**
 * Prepend an element
 */
export function prepend<A>(a: A, nel: NonEmptyList<A>): NonEmptyList<A> {
  return NonEmptyList(a, toList(nel));
}

/**
 * Append an element
 */
export function append<A>(nel: NonEmptyList<A>, a: A): NonEmptyList<A> {
  return NonEmptyList(nel.head, L.appendOne(nel.tail, a));
}

/**
 * Concatenate two NonEmptyLists
 */
export function concat<A>(
  nel1: NonEmptyList<A>,
  nel2: NonEmptyList<A>,
): NonEmptyList<A> {
  return NonEmptyList(nel1.head, L.append(nel1.tail, toList(nel2)));
}

/**
 * Take the first n elements (returns Option since result may be empty)
 */
export function take<A>(
  nel: NonEmptyList<A>,
  n: number,
): Option<NonEmptyList<A>> {
  if (n <= 0) return None;
  return fromList(L.take(toList(nel), n));
}

/**
 * Drop the first n elements (returns Option since result may be empty)
 */
export function drop<A>(
  nel: NonEmptyList<A>,
  n: number,
): Option<NonEmptyList<A>> {
  if (n <= 0) return Some(nel);
  return fromList(L.drop(toList(nel), n));
}

/**
 * Filter the list (returns Option since result may be empty)
 */
export function filter<A>(
  nel: NonEmptyList<A>,
  predicate: (a: A) => boolean,
): Option<NonEmptyList<A>> {
  return fromList(L.filter(toList(nel), predicate));
}

/**
 * Zip two NonEmptyLists
 */
export function zip<A, B>(
  nelA: NonEmptyList<A>,
  nelB: NonEmptyList<B>,
): NonEmptyList<[A, B]> {
  return NonEmptyList([nelA.head, nelB.head], L.zip(nelA.tail, nelB.tail));
}

/**
 * Zip with a function
 */
export function zipWith<A, B, C>(
  nelA: NonEmptyList<A>,
  nelB: NonEmptyList<B>,
  f: (a: A, b: B) => C,
): NonEmptyList<C> {
  return NonEmptyList(
    f(nelA.head, nelB.head),
    L.zipWith(nelA.tail, nelB.tail, f),
  );
}

/**
 * Intersperse a separator between elements
 */
export function intersperse<A>(nel: NonEmptyList<A>, sep: A): NonEmptyList<A> {
  if (L.isNil(nel.tail)) return nel;
  return NonEmptyList(nel.head, L.Cons(sep, L.intersperse(nel.tail, sep)));
}

// ============================================================================
// Folds
// ============================================================================

/**
 * Fold left
 */
export function foldLeft<A, B>(
  nel: NonEmptyList<A>,
  init: B,
  f: (b: B, a: A) => B,
): B {
  return L.foldLeft(toList(nel), init, f);
}

/**
 * Fold right
 */
export function foldRight<A, B>(
  nel: NonEmptyList<A>,
  init: B,
  f: (a: A, b: B) => B,
): B {
  return L.foldRight(toList(nel), init, f);
}

/**
 * Reduce (always succeeds for NonEmptyList)
 */
export function reduce<A>(nel: NonEmptyList<A>, f: (a: A, b: A) => A): A {
  return L.foldLeft(nel.tail, nel.head, f);
}

/**
 * Reduce from the right
 */
export function reduceRight<A>(nel: NonEmptyList<A>, f: (a: A, b: A) => A): A {
  if (L.isNil(nel.tail)) return nel.head;
  return f(nel.head, reduceRight(unsafeFromList(nel.tail), f));
}

function unsafeFromList<A>(list: List<A>): NonEmptyList<A> {
  if (L.isNil(list))
    throw new Error("Cannot create NonEmptyList from empty list");
  return NonEmptyList(list.head, list.tail);
}

// ============================================================================
// Search
// ============================================================================

/**
 * Find the first element matching a predicate
 */
export function find<A>(
  nel: NonEmptyList<A>,
  predicate: (a: A) => boolean,
): Option<A> {
  return L.find(toList(nel), predicate);
}

/**
 * Check if any element satisfies the predicate
 */
export function exists<A>(
  nel: NonEmptyList<A>,
  predicate: (a: A) => boolean,
): boolean {
  return L.exists(toList(nel), predicate);
}

/**
 * Check if all elements satisfy the predicate
 */
export function forall<A>(
  nel: NonEmptyList<A>,
  predicate: (a: A) => boolean,
): boolean {
  return L.forall(toList(nel), predicate);
}

/**
 * Check if list contains an element
 */
export function contains<A>(
  nel: NonEmptyList<A>,
  a: A,
  eq: (x: A, y: A) => boolean = (x, y) => x === y,
): boolean {
  return L.contains(toList(nel), a, eq);
}

// ============================================================================
// Min/Max
// ============================================================================

/**
 * Get the minimum element
 */
export function minimum<A>(
  nel: NonEmptyList<A>,
  compare: (a: A, b: A) => number,
): A {
  return reduce(nel, (a, b) => (compare(a, b) <= 0 ? a : b));
}

/**
 * Get the maximum element
 */
export function maximum<A>(
  nel: NonEmptyList<A>,
  compare: (a: A, b: A) => number,
): A {
  return reduce(nel, (a, b) => (compare(a, b) >= 0 ? a : b));
}

/**
 * Get minimum by a key
 */
export function minimumBy<A, B>(
  nel: NonEmptyList<A>,
  f: (a: A) => B,
  compare: (b1: B, b2: B) => number,
): A {
  return reduce(nel, (a1, a2) => (compare(f(a1), f(a2)) <= 0 ? a1 : a2));
}

/**
 * Get maximum by a key
 */
export function maximumBy<A, B>(
  nel: NonEmptyList<A>,
  f: (a: A) => B,
  compare: (b1: B, b2: B) => number,
): A {
  return reduce(nel, (a1, a2) => (compare(f(a1), f(a2)) >= 0 ? a1 : a2));
}

// ============================================================================
// Traverse
// ============================================================================

/**
 * Traverse with an Option-returning function
 */
export function traverse<A, B>(
  nel: NonEmptyList<A>,
  f: (a: A) => Option<B>,
): Option<NonEmptyList<B>> {
  const headResult = f(nel.head);
  if (!isSome(headResult)) return None;

  const tailResult = L.traverse(nel.tail, f);
  if (!isSome(tailResult)) return None;

  // With null-based Option, the results ARE the values when they're not null
  return Some(NonEmptyList(headResult, tailResult));
}

/**
 * Sequence a NonEmptyList of Options
 */
export function sequence<A>(
  nel: NonEmptyList<Option<A>>,
): Option<NonEmptyList<A>> {
  return traverse(nel, (opt) => opt);
}

// ============================================================================
// Typeclass Instances
// ============================================================================

/**
 * Eq instance for NonEmptyList
 */
export function getEq<A>(E: Eq<A>): Eq<NonEmptyList<A>> {
  const listEq = L.getEq(E);
  return {
    eqv: (x, y) => E.eqv(x.head, y.head) && listEq.eqv(x.tail, y.tail),
  };
}

/**
 * Ord instance for NonEmptyList (lexicographic)
 */
export function getOrd<A>(O: Ord<A>): Ord<NonEmptyList<A>> {
  const listOrd = L.getOrd(O);
  return {
    eqv: getEq(O).eqv,
    compare: (x, y) => {
      const headCmp = O.compare(x.head, y.head);
      if (headCmp !== 0) return headCmp;
      return listOrd.compare(x.tail, y.tail);
    },
  };
}

/**
 * Show instance for NonEmptyList
 */
export function getShow<A>(S: Show<A>): Show<NonEmptyList<A>> {
  return {
    show: (nel) => `NonEmptyList(${toArray(nel).map(S.show).join(", ")})`,
  };
}

/**
 * Semigroup instance for NonEmptyList (concatenation)
 */
export function getSemigroup<A>(): Semigroup<NonEmptyList<A>> {
  return {
    combine: concat,
  };
}

// ============================================================================
// Do-notation Support
// ============================================================================

/**
 * Start a do-comprehension with NonEmptyList
 */
export function Do<A>(a: A): NonEmptyList<A> {
  return singleton(a);
}

/**
 * Bind a value in do-notation style
 */
export function bind<N extends string, A extends object, B>(
  name: Exclude<N, keyof A>,
  f: (a: A) => NonEmptyList<B>,
): (nel: NonEmptyList<A>) => NonEmptyList<A & { readonly [K in N]: B }> {
  return (nel) =>
    flatMap(nel, (a) =>
      map(f(a), (b) => ({ ...a, [name]: b }) as A & { readonly [K in N]: B }),
    );
}

/**
 * Let - bind a non-effectful value
 */
export function let_<N extends string, A extends object, B>(
  name: Exclude<N, keyof A>,
  f: (a: A) => B,
): (nel: NonEmptyList<A>) => NonEmptyList<A & { readonly [K in N]: B }> {
  return (nel) =>
    map(nel, (a) => ({ ...a, [name]: f(a) }) as A & { readonly [K in N]: B });
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Perform a side effect for each element
 */
export function forEach<A>(nel: NonEmptyList<A>, f: (a: A) => void): void {
  L.forEach(toList(nel), f);
}

/**
 * Map with index
 */
export function mapWithIndex<A, B>(
  nel: NonEmptyList<A>,
  f: (index: number, a: A) => B,
): NonEmptyList<B> {
  return NonEmptyList(
    f(0, nel.head),
    L.mapWithIndex(nel.tail, (i, a) => f(i + 1, a)),
  );
}

/**
 * Sort the NonEmptyList
 */
export function sort<A>(
  nel: NonEmptyList<A>,
  compare: (a: A, b: A) => number,
): NonEmptyList<A> {
  return unsafeFromArray(toArray(nel).sort(compare));
}

/**
 * Sort by a key
 */
export function sortBy<A, B>(
  nel: NonEmptyList<A>,
  f: (a: A) => B,
  compare: (b1: B, b2: B) => number,
): NonEmptyList<A> {
  return sort(nel, (a1, a2) => compare(f(a1), f(a2)));
}

/**
 * Distinct elements (preserves first occurrence)
 */
export function distinct<A>(
  nel: NonEmptyList<A>,
  eq: (a: A, b: A) => boolean = (a, b) => a === b,
): NonEmptyList<A> {
  const result = L.distinct(toList(nel), eq);
  // We know result is non-empty because nel is non-empty
  return unsafeFromList(result);
}

/**
 * Join strings
 */
export function mkString(nel: NonEmptyList<string>, sep: string = ""): string {
  return toArray(nel).join(sep);
}

/**
 * Group consecutive elements by a key
 */
export function groupBy<A, K>(
  nel: NonEmptyList<A>,
  f: (a: A) => K,
  eq: (k1: K, k2: K) => boolean = (k1, k2) => k1 === k2,
): NonEmptyList<NonEmptyList<A>> {
  const groups = L.groupBy(toList(nel), f, eq);
  // We know groups is non-empty because nel is non-empty
  return unsafeFromList(L.filterMap(groups, fromList));
}
