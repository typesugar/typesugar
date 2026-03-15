/**
 * Immutable List Data Type
 *
 * A purely functional, immutable singly-linked list.
 * Either Cons(head, tail) or Nil (empty).
 */

import type { Op } from "@typesugar/core";
import type { TypeFunction } from "@typesugar/type-system";
import type { Option } from "./option.js";
import { Some, None, isSome } from "./option.js";
import type { Eq, Ord, Ordering } from "../typeclasses/eq.js";
import type { Show } from "../typeclasses/show.js";
import type { Semigroup, Monoid } from "../typeclasses/semigroup.js";

// ============================================================================
// List Type Definition
// ============================================================================

/**
 * Immutable singly-linked list — an opaque wrapper over a discriminated union
 * of Cons (non-empty) and Nil (empty).
 *
 * The `@opaque` macro erases method calls to companion standalone functions,
 * so `list.map(f)` compiles to `map(list, f)` with full type inference.
 *
 * Within this defining file the type is transparent — implementations use
 * the underlying discriminated union directly.
 *
 * @opaque { _tag: "Cons"; head: A; tail: List<A> } | { _tag: "Nil" }
 * @hkt
 */
export interface List<A> {
  readonly _tag: "Cons" | "Nil";
  map<B>(f: (a: A) => B): List<B>;
  flatMap<B>(f: (a: A) => List<B>): List<B>;
  filter(predicate: (a: A) => boolean): List<A>;
  fold<B>(init: B, f: (acc: B, a: A) => B): B;
  foldRight<B>(init: B, f: (a: A, acc: B) => B): B;
  head(): Option<A>;
  tail(): Option<List<A>>;
  last(): Option<A>;
  take(n: number): List<A>;
  drop(n: number): List<A>;
  reverse(): List<A>;
  append(other: List<A>): List<A>;
  prepend(a: A): List<A>;
  toArray(): A[];
  length(): number;
  isEmpty(): boolean;
  nonEmpty(): boolean;
  exists(predicate: (a: A) => boolean): boolean;
  forall(predicate: (a: A) => boolean): boolean;
  find(predicate: (a: A) => boolean): Option<A>;
  contains(value: A, eq?: (a: A, b: A) => boolean): boolean;
  zip<B>(other: List<B>): List<[A, B]>;
  forEach(f: (a: A) => void): void;
}

/**
 * Type-level function for `List<A>`.
 * Kind<ListF, number> resolves to List<number>.
 */
export interface ListF extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: List<this["__kind__"]>;
}

/**
 * Cons variant — a List known to be non-empty.
 * At runtime it's `{ _tag: "Cons"; head: A; tail: List<A> }`.
 */
export type Cons<A> = List<A>;

/**
 * Nil variant — a List known to be empty.
 * At runtime it's `{ _tag: "Nil" }`.
 */
export type Nil = List<never>;

// ============================================================================
// Constructors
// ============================================================================

/**
 * Create a Cons cell
 */
export function Cons<A>(head: A, tail: List<A>): List<A> {
  return { _tag: "Cons", head, tail } as any;
}

/**
 * The empty list (singleton)
 */
export const Nil: List<never> = { _tag: "Nil" } as any;

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
  return (list as any)._tag === "Cons";
}

/**
 * Check if List is Nil (empty)
 */
export function isNil<A>(list: List<A>): list is Nil {
  return (list as any)._tag === "Nil";
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
  const l: any = list;
  return l._tag === "Cons" ? Some(l.head) : None;
}

/**
 * Get the tail of the list
 */
export function tail<A>(list: List<A>): Option<List<A>> {
  const l: any = list;
  return l._tag === "Cons" ? Some(l.tail) : None;
}

/**
 * Get the last element
 */
export function last<A>(list: List<A>): Option<A> {
  if (isNil(list)) return None;
  let current: any = list;
  while (current.tail && current.tail._tag === "Cons") {
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
  let current: any = list;
  let i = 0;
  while (current._tag === "Cons") {
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
  let current: any = list;
  while (current._tag === "Cons") {
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
  let current: any = list;
  while (current._tag === "Cons") {
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
  let current: any = list;
  while (current._tag === "Cons") {
    let inner: any = f(current.head);
    while (inner._tag === "Cons") {
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
export function filter<A>(list: List<A>, predicate: (a: A) => boolean): List<A> {
  let acc: List<A> = Nil;
  let current: any = list;
  while (current._tag === "Cons") {
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
export function filterMap<A, B>(list: List<A>, f: (a: A) => Option<B>): List<B> {
  let acc: List<B> = Nil;
  let current: any = list;
  while (current._tag === "Cons") {
    const result = f(current.head);
    if (isSome(result)) {
      acc = Cons(result as any, acc);
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
  let current: any = list;
  while (current._tag === "Cons") {
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
  let reversed: any = reverse(list1);
  let result: List<A> = list2;
  while (reversed._tag === "Cons") {
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
  let current: any = list;
  let count = n;
  while (count > 0 && current._tag === "Cons") {
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
  let current: any = list;
  let count = n;
  while (count > 0 && current._tag === "Cons") {
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
export function takeWhile<A>(list: List<A>, predicate: (a: A) => boolean): List<A> {
  let acc: List<A> = Nil;
  let current: any = list;
  while (current._tag === "Cons" && predicate(current.head)) {
    acc = Cons(current.head, acc);
    current = current.tail;
  }
  return reverse(acc);
}

/**
 * Drop elements while predicate holds
 */
export function dropWhile<A>(list: List<A>, predicate: (a: A) => boolean): List<A> {
  let current: any = list;
  while (current._tag === "Cons" && predicate(current.head)) {
    current = current.tail;
  }
  return current;
}

/**
 * Zip two lists (stack-safe)
 */
export function zip<A, B>(listA: List<A>, listB: List<B>): List<[A, B]> {
  let acc: List<[A, B]> = Nil;
  let currentA: any = listA;
  let currentB: any = listB;
  while (currentA._tag === "Cons" && currentB._tag === "Cons") {
    acc = Cons([currentA.head, currentB.head], acc);
    currentA = currentA.tail;
    currentB = currentB.tail;
  }
  return reverse(acc);
}

/**
 * Zip with a function (stack-safe)
 */
export function zipWith<A, B, C>(listA: List<A>, listB: List<B>, f: (a: A, b: B) => C): List<C> {
  let acc: List<C> = Nil;
  let currentA: any = listA;
  let currentB: any = listB;
  while (currentA._tag === "Cons" && currentB._tag === "Cons") {
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
  let current: any = list;
  while (current._tag === "Cons") {
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
  const l: any = list;
  let acc: List<A> = Cons(l.head, Nil);
  let current: any = l.tail;
  while (current._tag === "Cons") {
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
export function foldLeft<A, B>(list: List<A>, init: B, f: (b: B, a: A) => B): B {
  let acc = init;
  let current: any = list;
  while (current._tag === "Cons") {
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
export function foldRight<A, B>(list: List<A>, init: B, f: (a: A, b: B) => B): B {
  // foldRight(xs, z, f) = foldLeft(reverse(xs), z, (b, a) => f(a, b))
  return foldLeft(reverse(list), init, (b, a) => f(a, b));
}

/**
 * Reduce with a semigroup (requires non-empty)
 */
export function reduce<A>(list: List<A>, f: (a: A, b: A) => A): Option<A> {
  if (isNil(list)) return None;
  const l: any = list;
  return Some(foldLeft(l.tail, l.head, f));
}

// ============================================================================
// Search
// ============================================================================

/**
 * Find the first element matching a predicate
 */
export function find<A>(list: List<A>, predicate: (a: A) => boolean): Option<A> {
  let current: any = list;
  while (current._tag === "Cons") {
    if (predicate(current.head)) return Some(current.head);
    current = current.tail;
  }
  return None;
}

/**
 * Find index of first element matching a predicate
 */
export function findIndex<A>(list: List<A>, predicate: (a: A) => boolean): Option<number> {
  let current: any = list;
  let i = 0;
  while (current._tag === "Cons") {
    if (predicate(current.head)) return Some(i);
    current = current.tail;
    i++;
  }
  return None;
}

/**
 * Check if any element satisfies the predicate
 */
export function exists<A>(list: List<A>, predicate: (a: A) => boolean): boolean {
  return isSome(find(list, predicate));
}

/**
 * Check if all elements satisfy the predicate
 */
export function forall<A>(list: List<A>, predicate: (a: A) => boolean): boolean {
  let current: any = list;
  while (current._tag === "Cons") {
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
  eq: (x: A, y: A) => boolean = (x, y) => x === y
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
  let current: any = list;
  while (current._tag === "Cons") {
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
export function mkStringShow<A>(list: List<A>, show: (a: A) => string, sep: string = ""): string {
  return toArray(list).map(show).join(sep);
}

// ============================================================================
// Traverse
// ============================================================================

/**
 * Traverse the list with an Option-returning function (stack-safe)
 */
export function traverse<A, B>(list: List<A>, f: (a: A) => Option<B>): Option<List<B>> {
  let acc: List<B> = Nil;
  let current: any = list;
  while (current._tag === "Cons") {
    const result = f(current.head);
    if (!isSome(result)) return None;
    acc = Cons(result as any, acc);
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
      let currentX: any = x;
      let currentY: any = y;
      while (currentX._tag === "Cons" && currentY._tag === "Cons") {
        if (!E.eqv(currentX.head, currentY.head)) return false;
        currentX = currentX.tail;
        currentY = currentY.tail;
      }
      return isNil(currentX) && isNil(currentY);
    },
  };
}

/**
 * Ord instance for List (lexicographic).
 * Includes Op<>-annotated comparison methods for operator rewriting.
 */
export function getOrd<A>(O: Ord<A>): Ord<List<A>> {
  const compare = (x: List<A>, y: List<A>): Ordering => {
    let currentX: any = x;
    let currentY: any = y;
    while (currentX._tag === "Cons" && currentY._tag === "Cons") {
      const cmp = O.compare(currentX.head, currentY.head);
      if (cmp !== 0) return cmp;
      currentX = currentX.tail;
      currentY = currentY.tail;
    }
    if (isNil(currentX) && isNil(currentY)) return 0 as Ordering;
    return isNil(currentX) ? (-1 as Ordering) : (1 as Ordering);
  };
  return {
    eqv: getEq(O).eqv,
    compare,
    lessThan: ((x, y) => compare(x, y) === -1) as (x: List<A>, y: List<A>) => boolean & Op<"<">,
    lessThanOrEqual: ((x, y) => compare(x, y) !== 1) as (
      x: List<A>,
      y: List<A>
    ) => boolean & Op<"<=">,
    greaterThan: ((x, y) => compare(x, y) === 1) as (x: List<A>, y: List<A>) => boolean & Op<">">,
    greaterThanOrEqual: ((x, y) => compare(x, y) !== -1) as (
      x: List<A>,
      y: List<A>
    ) => boolean & Op<">=">,
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
  f: (a: A) => List<B>
): (list: List<A>) => List<A & { readonly [K in N]: B }> {
  return (list) =>
    flatMap(list, (a) => map(f(a), (b) => ({ ...a, [name]: b }) as A & { readonly [K in N]: B }));
}

/**
 * Let - bind a non-effectful value
 */
export function let_<N extends string, A extends object, B>(
  name: Exclude<N, keyof A>,
  f: (a: A) => B
): (list: List<A>) => List<A & { readonly [K in N]: B }> {
  return (list) => map(list, (a) => ({ ...a, [name]: f(a) }) as A & { readonly [K in N]: B });
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Perform a side effect for each element
 */
export function forEach<A>(list: List<A>, f: (a: A) => void): void {
  let current: any = list;
  while (current._tag === "Cons") {
    f(current.head);
    current = current.tail;
  }
}

/**
 * Map with index (stack-safe)
 */
export function mapWithIndex<A, B>(list: List<A>, f: (index: number, a: A) => B): List<B> {
  let acc: List<B> = Nil;
  let current: any = list;
  let i = 0;
  while (current._tag === "Cons") {
    acc = Cons(f(i, current.head), acc);
    current = current.tail;
    i++;
  }
  return reverse(acc);
}

/**
 * Sort the list
 */
export function sort<A>(list: List<A>, compare: (a: A, b: A) => number): List<A> {
  return fromArray(toArray(list).sort(compare));
}

/**
 * Sort by a key
 */
export function sortBy<A, B>(
  list: List<A>,
  f: (a: A) => B,
  compare: (b1: B, b2: B) => number
): List<A> {
  return sort(list, (a1, a2) => compare(f(a1), f(a2)));
}

/**
 * Group consecutive elements by a key (stack-safe)
 */
export function groupBy<A, K>(
  list: List<A>,
  f: (a: A) => K,
  eq: (k1: K, k2: K) => boolean = (k1, k2) => k1 === k2
): List<List<A>> {
  if (isNil(list)) return Nil;

  let groups: List<List<A>> = Nil;
  let current: any = list;

  while (current._tag === "Cons") {
    const key = f(current.head);
    let groupAcc: List<A> = Cons(current.head, Nil);
    current = current.tail;

    while (current._tag === "Cons" && eq(f(current.head), key)) {
      groupAcc = Cons(current.head, groupAcc);
      current = current.tail;
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
  eq: (a: A, b: A) => boolean = (a, b) => a === b
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
export function partition<A>(list: List<A>, predicate: (a: A) => boolean): [List<A>, List<A>] {
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

// ============================================================================
// List Namespace Object
// ============================================================================

/**
 * List namespace - groups all List operations for clean API access.
 *
 * @example
 * ```typescript
 * import { List, Cons, Nil } from "@typesugar/fp";
 *
 * const xs = List.of(1, 2, 3);
 * List.map(xs, n => n * 2);      // List(2, 4, 6)
 * List.filter(xs, n => n > 1);   // List(2, 3)
 * List.foldLeft(xs, 0, (a, b) => a + b); // 6
 * ```
 */
export const List = {
  // Constructors
  of,
  fromArray,
  fromIterable,
  singleton,
  replicate,
  range,
  empty,

  // Type guards
  isCons,
  isNil,
  isEmpty,
  nonEmpty,

  // Basic operations
  head,
  tail,
  last,
  init,
  get,
  length,

  // Transformations
  map,
  flatMap,
  filter,
  filterMap,
  reverse,
  prepend,
  append,
  appendOne,
  flatten,
  take,
  drop,
  dropLast,
  takeWhile,
  dropWhile,
  zip,
  zipWith,
  unzip,
  intersperse,

  // Folds
  foldLeft,
  foldRight,
  reduce,

  // Search
  find,
  findIndex,
  exists,
  forall,
  contains,
  count,

  // Conversions
  toArray,
  mkString,
  mkStringShow,

  // Traverse
  traverse,
  sequence,

  // Typeclass instances
  getEq,
  getOrd,
  getShow,
  getSemigroup,
  getMonoid,

  // Do-notation
  Do,
  bind,
  let_,

  // Utilities
  forEach,
  mapWithIndex,
  sort,
  sortBy,
  groupBy,
  distinct,
  partition,
} as const;
