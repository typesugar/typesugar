/**
 * @typesugar/specialize Showcase
 *
 * Self-documenting examples of zero-cost typeclass specialization:
 * specialize(), fn.specialize(), specialize$(), mono(), inlineCall(),
 * and the Specialized<F, N> type utility.
 *
 * Type assertions used:
 *   typeAssert<Equal<A, B>>()        - A and B are the same type
 *   typeAssert<Extends<A, B>>()      - A is assignable to B
 *   typeAssert<Not<Equal<A, B>>>()   - A and B are DIFFERENT
 *   typeAssert<Not<Extends<A, B>>>() - A is NOT assignable to B
 *
 * Run:   typesugar run examples/showcase.ts
 * Build: npx tspc && node dist/examples/showcase.js
 */

import { assert, typeAssert, type Equal, type Extends, type Not } from "@typesugar/testing";

import {
  type Specialized,
  specialize,
  specialize$,
  mono,
  inlineCall,
} from "@typesugar/specialize";

// ============================================================================
// Setup: Typeclass interfaces and instances for demonstration
// ============================================================================

interface Show<A> {
  show(a: A): string;
}

interface Eq<A> {
  equals(a: A, b: A): boolean;
}

interface Ord<A> {
  compare(a: A, b: A): -1 | 0 | 1;
}

const numberShow: Show<number> = {
  show: (n) => n.toString(),
};

const stringShow: Show<string> = {
  show: (s) => `"${s}"`,
};

const numberOrd: Ord<number> = {
  compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
};

const stringOrd: Ord<string> = {
  compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
};

const numberEq: Eq<number> = {
  equals: (a, b) => a === b,
};

// ============================================================================
// 1. THE PROBLEM — Runtime dictionary passing overhead
// ============================================================================

// Generic functions take typeclass instances as parameters.
// Every call site must pass the instance explicitly.

function showAll<A>(items: A[], S: Show<A>): string {
  return "[" + items.map((item) => S.show(item)).join(", ") + "]";
}

function sortWith<A>(items: A[], ord: Ord<A>): A[] {
  return items.slice().sort((a, b) => ord.compare(a, b));
}

function maxWith<A>(items: A[], ord: Ord<A>): A | undefined {
  if (items.length === 0) return undefined;
  return items.reduce((max, item) => (ord.compare(item, max) > 0 ? item : max));
}

// Without specialization, you pass the dictionary at every call:
assert(showAll([1, 2, 3], numberShow) === "[1, 2, 3]");
assert(sortWith([3, 1, 2], numberOrd)[0] === 1);
assert(maxWith([3, 1, 4, 1, 5], numberOrd) === 5);

// ============================================================================
// 2. EXTENSION METHOD SYNTAX — fn.specialize(dict) [PREFERRED]
// ============================================================================

// .specialize() is an extension method on Function.
// It bakes in the typeclass instance at compile time, producing a
// function with fewer parameters — zero dictionary passing overhead.

const showNumbers = showAll.specialize(numberShow);
const showStrings = showAll.specialize(stringShow);
const sortNumbers = sortWith.specialize(numberOrd);
const sortStrings = sortWith.specialize(stringOrd);
const maxNumber = maxWith.specialize(numberOrd);

// Specialized functions don't need the instance argument:
assert(showNumbers([1, 2, 3]) === "[1, 2, 3]");
assert(showStrings(["a", "b"]) === '["a", "b"]');
assert(sortNumbers([3, 1, 2])[0] === 1);
assert(sortStrings(["banana", "apple"])[0] === "apple");
assert(maxNumber([3, 1, 4, 1, 5]) === 5);

// ============================================================================
// 3. MULTIPLE DICTIONARIES — specialize with 2+ instances
// ============================================================================

// Functions with multiple typeclass parameters can specialize all at once.

function sortAndShow<A>(items: A[], ord: Ord<A>, show: Show<A>): string {
  const sorted = items.slice().sort((a, b) => ord.compare(a, b));
  return "[" + sorted.map((item) => show.show(item)).join(", ") + "]";
}

// Specialize both Ord and Show in one call
const sortAndShowNumbers = sortAndShow.specialize(numberOrd, numberShow);
assert(sortAndShowNumbers([3, 1, 2]) === "[1, 2, 3]");

function filterEqAndShow<A>(items: A[], target: A, eq: Eq<A>, show: Show<A>): string {
  const matched = items.filter((item) => eq.equals(item, target));
  return matched.map((item) => show.show(item)).join(", ");
}

const filterAndShowNumbers = filterEqAndShow.specialize(numberEq, numberShow);
assert(filterAndShowNumbers([1, 2, 1, 3, 1], 1) === "1, 1, 1");

// ============================================================================
// 4. SPECIALIZED TYPE — the Specialized<F, N> utility type
// ============================================================================

// Specialized<F, N> removes the last N parameters from F's signature.
// This is the type-level mechanism behind .specialize().

type ShowAllType = (items: number[], S: Show<number>) => string;

// Removing 1 parameter (the Show instance) gives (items: number[]) => string
typeAssert<Equal<Specialized<ShowAllType, 1>, (items: number[]) => string>>();

type SortAndShowType = (items: string[], ord: Ord<string>, show: Show<string>) => string;

// Removing 2 parameters gives (items: string[]) => string
typeAssert<Equal<Specialized<SortAndShowType, 2>, (items: string[]) => string>>();

// ============================================================================
// 5. LEGACY FUNCTION SYNTAX — specialize(fn, [instances])
// ============================================================================

// The older function-call syntax wraps the function and instances in an array.
// Still supported for backwards compatibility.

const showNumbersLegacy = specialize(showAll, [numberShow]);
const sortNumbersLegacy = specialize(sortWith, [numberOrd]);

assert(showNumbersLegacy([4, 5, 6]) === "[4, 5, 6]");
assert(sortNumbersLegacy([5, 2, 8])[0] === 2);

// ============================================================================
// 6. INLINE SPECIALIZATION — specialize$() for one-off calls
// ============================================================================

// specialize$() inlines the specialization at a single call site.
// Useful when you don't need a named specialized function.

const result = specialize$(sortWith([5, 2, 8, 1, 9], numberOrd));
assert(result[0] === 1);
assert(result[4] === 9);

// ============================================================================
// 7. MONOMORPHIZATION — mono<T>() for type-level specialization
// ============================================================================

// mono<T1, T2, ...>(fn) creates a monomorphized version of a
// generic function for specific type arguments.

const identity = <T>(x: T): T => x;

const identityNumber = mono<number>(identity);
const identityString = mono<string>(identity);

assert(identityNumber(42) === 42);
assert(identityString("hello") === "hello");

// ============================================================================
// 8. INLINE CALL — inlineCall() for compile-time inlining
// ============================================================================

// inlineCall() attempts to inline a function body at the call site.
// For simple arrow functions, this eliminates the function call overhead.

const double = (x: number) => x * 2;
const addOne = (x: number) => x + 1;

// Nested inlining: addOne(20) → 21, then double(21) → 42
const inlined = inlineCall(double(inlineCall(addOne(20))));
assert(inlined === 42);

// ============================================================================
// 9. REAL-WORLD EXAMPLE — Specialized collection operations
// ============================================================================

// In a real codebase, you'd define generic utilities once and specialize
// them per type, getting the ergonomics of generic code with the
// performance of hand-written specialized code.

function groupAndSort<A, K extends string>(
  items: A[],
  keyFn: (a: A) => K,
  ord: Ord<A>,
  show: Show<A>
): Record<string, string> {
  const groups: Record<string, A[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }

  const result: Record<string, string> = {};
  for (const [key, group] of Object.entries(groups)) {
    const sorted = group.sort((a, b) => ord.compare(a, b));
    result[key] = "[" + sorted.map((x) => show.show(x)).join(", ") + "]";
  }
  return result;
}

// Specialize for numbers — no dictionary passing at call sites
const groupAndSortNumbers = groupAndSort.specialize(numberOrd, numberShow);

const grouped = groupAndSortNumbers(
  [3, 1, 4, 1, 5, 9, 2, 6],
  (n) => (n % 2 === 0 ? "even" : "odd")
);

assert(grouped["even"] === "[2, 4, 6]");
assert(grouped["odd"] === "[1, 1, 3, 5, 9]");

// ============================================================================
// 10. ZERO-COST GUARANTEE
// ============================================================================

// All specialization mechanisms produce the same output as hand-written code.
//
// Generic:    sortWith(items, numberOrd)
// Specialized: sortNumbers(items)
//
// At compile time, the transformer inlines numberOrd.compare(a, b) as
// (a < b ? -1 : a > b ? 1 : 0) — no dictionary lookup, no extra function
// call, no closure allocation.
//
// This is the core promise: write it generic, run it specialized.

const data = [10, 5, 20, 15];

const genericResult = sortWith(data, numberOrd);
const specializedResult = sortNumbers(data);

assert(genericResult[0] === specializedResult[0]);
assert(genericResult[3] === specializedResult[3]);
