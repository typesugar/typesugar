/**
 * Immutable List Data Type
 *
 * A purely functional, immutable singly-linked list.
 * Either Cons(head, tail) or Nil (empty).
 */

import type { Option } from "./option.js";
import { Some, None, isSome } from "./option.js";
import type { Eq, Ord, Ordering } from "../typeclasses/eq.js";
import type { Show } from "../typeclasses/show.js";
import type { Semigroup, Monoid } from "../typeclasses/semigroup.js";

// ============================================================================
// List Type Definition
// ============================================================================

/**
 * List data type - either Cons (non-empty) or Nil (empty)
 */
export type List<A> = Cons<A> | Nil;

/**
 * Cons variant - contains head and tail
 */
export interface Cons<A> {
  readonly _tag: "Cons";
  readonly head: A;
  readonly tail: List<A>;
}

/**
 * Nil variant - empty list
 */
export interface Nil {
  readonly _tag: "Nil";
}

// ============================================================================
// Constructors
// ============================================================================

/**
 * Create a Cons cell
 */
export function Cons<A>(head: A, tail: List<A>): List<A> {
  return { _tag: "Cons", head, tail };
}

/**
 * The empty list (singleton)
 */
export const Nil: List<never> = { _tag: "Nil" };

/**
 * Create a list from variadic arguments
 */
export function of<A>(...as: A[]): List<A> {
  return fromArray(as);
}

/**
 * Create a list from an array
 */
export function fromArray<A>(arr: readonly A[]): List<A> {
  let result: List<A> = Nil;
  for (let i = arr.length - 1; i >= 0; i--) {
    result = Cons(arr[i], result);
  }
  return result;
}

/**
 * Create a list from an iterable
 */
export function fromIterable<A>(iter: Iterable<A>): List<A> {
  return fromArray([...iter]);
}

/**
 * Create a single-element list
 */
export function singleton<A>(a: A): List<A> {
  return Cons(a, Nil);
}

/**
 * Create a list with n copies of a value
 */
export function replicate<A>(n: number, a: A): List<A> {
  let result: List<A> = Nil;
  for (let i = 0; i < n; i++) {
    result = Cons(a, result);
  }
  return result;
}

/**
 * Create a list from a range
 */
export function range(start: number, end: number): List<number> {
  let result: List<number> = Nil;
  for (let i = end - 1; i >= start; i--) {
    result = Cons(i, result);
  }
  return result;
}

/**
 * Create an empty list
 */
export function empty<A = never>(): List<A> {
  return Nil;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if List is Cons (non-empty)
 */
export function isCons<A>(list: List<A>): list is Cons<A> {
  return list._tag === "Cons";
}

/**
 * Check if List is Nil (empty)
 */
export function isNil<A>(list: List<A>): list is Nil {
  return list._tag === "Nil";
}

/**
 * Check if list is empty
 */
export function isEmpty<A>(list: List<A>): boolean {
  return isNil(list);
}

/**
 * Check if list is non-empty
 */
export function nonEmpty<A>(list: List<A>): boolean {
  return isCons(list);
}

// ============================================================================
// Basic Operations
// ============================================================================

/**
 * Get the head of the list
 */
export function head<A>(list: List<A>): Option<A> {
  return isCons(list) ? Some(list.head) : None;
}

/**
 * Get the tail of the list
 */
export function tail<A>(list: List<A>): Option<List<A>> {
  return isCons(list) ? Some(list.tail) : None;
}

/**
 * Get the last element
 */
export function last<A>(list: List<A>): Option<A> {
  if (isNil(list)) return None;
  let current = list;
  while (isCons(current.tail)) {
    current = current.tail;
  }
  return Some(current.head);
}

/**
 * Get all but the last element
 */
export function init<A>(list: List<A>): Option<List<A>> {
  if (isNil(list)) return None;
  return Some(dropLast(list, 1));
}

/**
 * Get the nth element (0-indexed)
 */
export function get<A>(list: List<A>, index: number): Option<A> {
  let current = list;
  let i = 0;
  while (isCons(current)) {
    if (i === index) return Some(current.head);
    current = current.tail;
    i++;
  }
  return None;
}

/**
 * Get the length of the list
 */
export function length<A>(list: List<A>): number {
  let count = 0;
  let current = list;
  while (isCons(current)) {
    count++;
    current = current.tail;
  }
  return count;
}

// ============================================================================
// Transformations
// ============================================================================

/**
 * Map over the list (stack-safe)
 */
export function map<A, B>(list: List<A>, f: (a: A) => B): List<B> {
  let acc: List<B> = Nil;
  let current = list;
  while (isCons(current)) {
    acc = Cons(f(current.head), acc);
    current = current.tail;
  }
  return reverse(acc);
}

/**
 * FlatMap over the list (stack-safe)
 */
export function flatMap<A, B>(list: List<A>, f: (a: A) => List<B>): List<B> {
  let acc: List<B> = Nil;
  let current = list;
  while (isCons(current)) {
    // Prepend f(current.head) in reverse to acc
    let inner = f(current.head);
    while (isCons(inner)) {
      acc = Cons(inner.head, acc);
      inner = inner.tail;
    }
    current = current.tail;
  }
  return reverse(acc);
}

/**
 * Filter the list (stack-safe)
 */
export function filter<A>(
  list: List<A>,
  predicate: (a: A) => boolean,
): List<A> {
  let acc: List<A> = Nil;
  let current = list;
  while (isCons(current)) {
    if (predicate(current.head)) {
      acc = Cons(current.head, acc);
    }
    current = current.tail;
  }
  return reverse(acc);
}

/**
 * Filter and map in one pass (stack-safe)
 */
export function filterMap<A, B>(
  list: List<A>,
  f: (a: A) => Option<B>,
): List<B> {
  let acc: List<B> = Nil;
  let current = list;
  while (isCons(current)) {
    const result = f(current.head);
    if (isSome(result)) {
      // With null-based Option, result IS the value when it's not null
      acc = Cons(result, acc);
    }
    current = current.tail;
  }
  return reverse(acc);
}

/**
 * Reverse the list
 */
export function reverse<A>(list: List<A>): List<A> {
  let result: List<A> = Nil;
  let current = list;
  while (isCons(current)) {
    result = Cons(current.head, result);
    current = current.tail;
  }
  return result;
}

/**
 * Prepend an element
 */
export function prepend<A>(a: A, list: List<A>): List<A> {
  return Cons(a, list);
}

/**
 * Append an element
 */
export function appendOne<A>(list: List<A>, a: A): List<A> {
  return append(list, singleton(a));
}

/**
 * Append two lists (stack-safe)
 */
export function append<A>(list1: List<A>, list2: List<A>): List<A> {
  if (isNil(list1)) return list2;
  if (isNil(list2)) return list1;
  // Reverse list1, then prepend each element to list2
  let reversed: List<A> = reverse(list1);
  let result: List<A> = list2;
  while (isCons(reversed)) {
    result = Cons(reversed.head, result);
    reversed = reversed.tail;
  }
  return result;
}

/**
 * Flatten a list of lists
 */
export function flatten<A>(lists: List<List<A>>): List<A> {
  return flatMap(lists, (list) => list);
}

/**
 * Take the first n elements (stack-safe)
 */
export function take<A>(list: List<A>, n: number): List<A> {
  let acc: List<A> = Nil;
  let current = list;
  let count = n;
  while (count > 0 && isCons(current)) {
    acc = Cons(current.head, acc);
    current = current.tail;
    count--;
  }
  return reverse(acc);
}

/**
 * Drop the first n elements (stack-safe)
 */
export function drop<A>(list: List<A>, n: number): List<A> {
  let current = list;
  let count = n;
  while (count > 0 && isCons(current)) {
    current = current.tail;
    count--;
  }
  return current;
}

/**
 * Drop the last n elements
 */
export function dropLast<A>(list: List<A>, n: number): List<A> {
  const len = length(list);
  return take(list, Math.max(0, len - n));
}

/**
 * Take elements while predicate holds (stack-safe)
 */
export function takeWhile<A>(
  list: List<A>,
  predicate: (a: A) => boolean,
): List<A> {
  let acc: List<A> = Nil;
  let current = list;
  while (isCons(current) && predicate(current.head)) {
    acc = Cons(current.head, acc);
    current = current.tail;
  }
  return reverse(acc);
}

/**
 * Drop elements while predicate holds
 */
export function dropWhile<A>(
  list: List<A>,
  predicate: (a: A) => boolean,
): List<A> {
  let current = list;
  while (isCons(current) && predicate(current.head)) {
    current = current.tail;
  }
  return current;
}

/**
 * Zip two lists (stack-safe)
 */
export function zip<A, B>(listA: List<A>, listB: List<B>): List<[A, B]> {
  let acc: List<[A, B]> = Nil;
  let currentA = listA;
  let currentB = listB;
  while (isCons(currentA) && isCons(currentB)) {
    acc = Cons([currentA.head, currentB.head], acc);
    currentA = currentA.tail;
    currentB = currentB.tail;
  }
  return reverse(acc);
}

/**
 * Zip with a function (stack-safe)
 */
export function zipWith<A, B, C>(
  listA: List<A>,
  listB: List<B>,
  f: (a: A, b: B) => C,
): List<C> {
  let acc: List<C> = Nil;
  let currentA = listA;
  let currentB = listB;
  while (isCons(currentA) && isCons(currentB)) {
    acc = Cons(f(currentA.head, currentB.head), acc);
    currentA = currentA.tail;
    currentB = currentB.tail;
  }
  return reverse(acc);
}

/**
 * Unzip a list of tuples (stack-safe)
 */
export function unzip<A, B>(list: List<[A, B]>): [List<A>, List<B>] {
  let accA: List<A> = Nil;
  let accB: List<B> = Nil;
  let current = list;
  while (isCons(current)) {
    accA = Cons(current.head[0], accA);
    accB = Cons(current.head[1], accB);
    current = current.tail;
  }
  return [reverse(accA), reverse(accB)];
}

/**
 * Intersperse a separator between elements (stack-safe)
 */
export function intersperse<A>(list: List<A>, sep: A): List<A> {
  if (isNil(list)) return Nil;
  let acc: List<A> = Cons(list.head, Nil);
  let current = list.tail;
  while (isCons(current)) {
    acc = Cons(current.head, Cons(sep, acc));
    current = current.tail;
  }
  return reverse(acc);
}

// ============================================================================
// Folds
// ============================================================================

/**
 * Fold left
 */
export function foldLeft<A, B>(
  list: List<A>,
  init: B,
  f: (b: B, a: A) => B,
): B {
  let acc = init;
  let current = list;
  while (isCons(current)) {
    acc = f(acc, current.head);
    current = current.tail;
  }
  return acc;
}

/**
 * Fold right (stack-safe via reverse + foldLeft)
 *
 * Note: This is stack-safe but evaluates strictly (not lazy).
 * For lazy/short-circuiting foldRight, use Eval-based version.
 */
export function foldRight<A, B>(
  list: List<A>,
  init: B,
  f: (a: A, b: B) => B,
): B {
  // foldRight(xs, z, f) = foldLeft(reverse(xs), z, (b, a) => f(a, b))
  return foldLeft(reverse(list), init, (b, a) => f(a, b));
}

/**
 * Reduce with a semigroup (requires non-empty)
 */
export function reduce<A>(list: List<A>, f: (a: A, b: A) => A): Option<A> {
  if (isNil(list)) return None;
  return Some(foldLeft(list.tail, list.head, f));
}

// ============================================================================
// Search
// ============================================================================

/**
 * Find the first element matching a predicate
 */
export function find<A>(
  list: List<A>,
  predicate: (a: A) => boolean,
): Option<A> {
  let current = list;
  while (isCons(current)) {
    if (predicate(current.head)) return Some(current.head);
    current = current.tail;
  }
  return None;
}

/**
 * Find index of first element matching a predicate
 */
export function findIndex<A>(
  list: List<A>,
  predicate: (a: A) => boolean,
): Option<number> {
  let current = list;
  let i = 0;
  while (isCons(current)) {
    if (predicate(current.head)) return Some(i);
    current = current.tail;
    i++;
  }
  return None;
}

/**
 * Check if any element satisfies the predicate
 */
export function exists<A>(
  list: List<A>,
  predicate: (a: A) => boolean,
): boolean {
  return isSome(find(list, predicate));
}

/**
 * Check if all elements satisfy the predicate
 */
export function forall<A>(
  list: List<A>,
  predicate: (a: A) => boolean,
): boolean {
  let current = list;
  while (isCons(current)) {
    if (!predicate(current.head)) return false;
    current = current.tail;
  }
  return true;
}

/**
 * Check if list contains an element
 */
export function contains<A>(
  list: List<A>,
  a: A,
  eq: (x: A, y: A) => boolean = (x, y) => x === y,
): boolean {
  return exists(list, (x) => eq(x, a));
}

/**
 * Count elements satisfying a predicate
 */
export function count<A>(list: List<A>, predicate: (a: A) => boolean): number {
  return foldLeft(list, 0, (acc, a) => (predicate(a) ? acc + 1 : acc));
}

// ============================================================================
// Conversion
// ============================================================================

/**
 * Convert list to array
 */
export function toArray<A>(list: List<A>): A[] {
  const result: A[] = [];
  let current = list;
  while (isCons(current)) {
    result.push(current.head);
    current = current.tail;
  }
  return result;
}

/**
 * Join elements with a separator
 */
export function mkString(list: List<string>, sep: string = ""): string {
  return toArray(list).join(sep);
}

/**
 * Show elements with a separator
 */
export function mkStringShow<A>(
  list: List<A>,
  show: (a: A) => string,
  sep: string = "",
): string {
  return toArray(list).map(show).join(sep);
}

// ============================================================================
// Traverse
// ============================================================================

/**
 * Traverse the list with an Option-returning function (stack-safe)
 */
export function traverse<A, B>(
  list: List<A>,
  f: (a: A) => Option<B>,
): Option<List<B>> {
  let acc: List<B> = Nil;
  let current = list;
  while (isCons(current)) {
    const result = f(current.head);
    if (!isSome(result)) return None;
    // With null-based Option, result IS the value when it's not null
    acc = Cons(result, acc);
    current = current.tail;
  }
  return Some(reverse(acc));
}

/**
 * Sequence a list of Options
 */
export function sequence<A>(list: List<Option<A>>): Option<List<A>> {
  return traverse(list, (opt) => opt);
}

// ============================================================================
// Typeclass Instances
// ============================================================================

/**
 * Eq instance for List
 */
export function getEq<A>(E: Eq<A>): Eq<List<A>> {
  return {
    eqv: (x, y) => {
      let currentX = x;
      let currentY = y;
      while (isCons(currentX) && isCons(currentY)) {
        if (!E.eqv(currentX.head, currentY.head)) return false;
        currentX = currentX.tail;
        currentY = currentY.tail;
      }
      return isNil(currentX) && isNil(currentY);
    },
  };
}

/**
 * Ord instance for List (lexicographic)
 */
export function getOrd<A>(O: Ord<A>): Ord<List<A>> {
  return {
    eqv: getEq(O).eqv,
    compare: (x, y) => {
      let currentX = x;
      let currentY = y;
      while (isCons(currentX) && isCons(currentY)) {
        const cmp = O.compare(currentX.head, currentY.head);
        if (cmp !== 0) return cmp;
        currentX = currentX.tail;
        currentY = currentY.tail;
      }
      if (isNil(currentX) && isNil(currentY)) return 0 as Ordering;
      return isNil(currentX) ? (-1 as Ordering) : (1 as Ordering);
    },
  };
}

/**
 * Show instance for List
 */
export function getShow<A>(S: Show<A>): Show<List<A>> {
  return {
    show: (list) => `List(${toArray(list).map(S.show).join(", ")})`,
  };
}

/**
 * Semigroup instance for List (concatenation)
 */
export function getSemigroup<A>(): Semigroup<List<A>> {
  return {
    combine: append,
  };
}

/**
 * Monoid instance for List
 */
export function getMonoid<A>(): Monoid<List<A>> {
  return {
    ...getSemigroup<A>(),
    empty: Nil,
  };
}

// ============================================================================
// Do-notation Support
// ============================================================================

/**
 * Start a do-comprehension with List
 */
export const Do: List<{}> = singleton({});

/**
 * Bind a value in do-notation style
 */
export function bind<N extends string, A extends object, B>(
  name: Exclude<N, keyof A>,
  f: (a: A) => List<B>,
): (list: List<A>) => List<A & { readonly [K in N]: B }> {
  return (list) =>
    flatMap(list, (a) =>
      map(f(a), (b) => ({ ...a, [name]: b }) as A & { readonly [K in N]: B }),
    );
}

/**
 * Let - bind a non-effectful value
 */
export function let_<N extends string, A extends object, B>(
  name: Exclude<N, keyof A>,
  f: (a: A) => B,
): (list: List<A>) => List<A & { readonly [K in N]: B }> {
  return (list) =>
    map(list, (a) => ({ ...a, [name]: f(a) }) as A & { readonly [K in N]: B });
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Perform a side effect for each element
 */
export function forEach<A>(list: List<A>, f: (a: A) => void): void {
  let current = list;
  while (isCons(current)) {
    f(current.head);
    current = current.tail;
  }
}

/**
 * Map with index (stack-safe)
 */
export function mapWithIndex<A, B>(
  list: List<A>,
  f: (index: number, a: A) => B,
): List<B> {
  let acc: List<B> = Nil;
  let current = list;
  let i = 0;
  while (isCons(current)) {
    acc = Cons(f(i, current.head), acc);
    current = current.tail;
    i++;
  }
  return reverse(acc);
}

/**
 * Sort the list
 */
export function sort<A>(
  list: List<A>,
  compare: (a: A, b: A) => number,
): List<A> {
  return fromArray(toArray(list).sort(compare));
}

/**
 * Sort by a key
 */
export function sortBy<A, B>(
  list: List<A>,
  f: (a: A) => B,
  compare: (b1: B, b2: B) => number,
): List<A> {
  return sort(list, (a1, a2) => compare(f(a1), f(a2)));
}

/**
 * Group consecutive elements by a key (stack-safe)
 */
export function groupBy<A, K>(
  list: List<A>,
  f: (a: A) => K,
  eq: (k1: K, k2: K) => boolean = (k1, k2) => k1 === k2,
): List<List<A>> {
  if (isNil(list)) return Nil;

  let groups: List<List<A>> = Nil;
  let current: List<A> = list;

  while (isCons(current)) {
    const key = f(current.head);
    let groupAcc: List<A> = Cons(current.head, Nil);
    current = current.tail as List<A>;

    // Collect all consecutive elements with the same key
    while (isCons(current) && eq(f(current.head), key)) {
      groupAcc = Cons(current.head, groupAcc);
      current = current.tail as List<A>;
    }

    groups = Cons(reverse(groupAcc), groups);
  }

  return reverse(groups);
}

/**
 * Distinct elements (preserves first occurrence)
 */
export function distinct<A>(
  list: List<A>,
  eq: (a: A, b: A) => boolean = (a, b) => a === b,
): List<A> {
  const seen: A[] = [];
  return filter(list, (a) => {
    if (seen.some((s) => eq(s, a))) return false;
    seen.push(a);
    return true;
  });
}

/**
 * Partition list into [matching, non-matching]
 */
export function partition<A>(
  list: List<A>,
  predicate: (a: A) => boolean,
): [List<A>, List<A>] {
  const matching: A[] = [];
  const nonMatching: A[] = [];
  forEach(list, (a) => {
    if (predicate(a)) {
      matching.push(a);
    } else {
      nonMatching.push(a);
    }
  });
  return [fromArray(matching), fromArray(nonMatching)];
}
