//! specialize
//! Eliminate typeclass dictionaries at compile time

import { specialize } from "typesugar";

// A generic fold that works with any Monoid dictionary.
// The dictionary parameter (M) is runtime overhead we want to eliminate.
function fold(M: { empty: () => number; combine: (a: number, b: number) => number }, items: number[]): number {
  return items.reduce((acc, item) => M.combine(acc, item), M.empty());
}

function foldStr(M: { empty: () => string; combine: (a: string, b: string) => string }, items: string[]): string {
  return items.reduce((acc, item) => M.combine(acc, item), M.empty());
}

// Concrete Monoid instances
/** @impl Monoid<number> */
const numberAdd = { empty: () => 0, combine: (a: number, b: number) => a + b };

/** @impl Monoid<string> */
const stringConcat = { empty: () => "", combine: (a: string, b: string) => a + b };

// specialize() inlines the dictionary at compile time.
// The result has NO dictionary parameter — direct operations only.
const sumAll = specialize(fold, numberAdd);
const joinAll = specialize(foldStr, stringConcat);

// 👀 Check JS Output — sumAll has 0 and + inlined, no dictionary passing!
console.log("sum:", sumAll([1, 2, 3, 4, 5]));       // 15
console.log("join:", joinAll(["a", "b", "c"]));      // "abc"

// Compare: generic fold passes a dictionary at runtime
console.log("generic:", fold(numberAdd, [10, 20]));  // 30

// Try: write a Monoid for arrays and specialize flattenAll
