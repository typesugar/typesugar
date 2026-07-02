//! specialize
//! Eliminate typeclass dictionaries at compile time

// A generic fold that works with any Monoid dictionary.
// The dictionary parameter (M) is runtime overhead we want to eliminate.
function fold(
  M: { empty: () => number; combine: (a: number, b: number) => number },
  items: number[]
): number {
  return items.reduce((acc, item) => M.combine(acc, item), M.empty());
}

function foldStr(
  M: { empty: () => string; combine: (a: string, b: string) => string },
  items: string[]
): string {
  return items.reduce((acc, item) => M.combine(acc, item), M.empty());
}

// Concrete Monoid instances
/** @impl Monoid<number> */
const numberAdd = { empty: () => 0, combine: (a: number, b: number) => a + b };

/** @impl Monoid<string> */
const stringConcat = { empty: () => "", combine: (a: string, b: string) => a + b };

// Specialization is an always-on compiler optimization (PEP-053) — there is no
// macro to call. Passing a known dictionary auto-specializes the call: the
// dictionary is eliminated and its methods inlined directly, no annotation needed.
const sumAll = fold(numberAdd, [1, 2, 3, 4, 5]);
const joinAll = foldStr(stringConcat, ["a", "b", "c"]);

// 👀 Check JS Output — the dictionary is gone, 0 and + are inlined directly!
console.log("sum:", sumAll); // 15
console.log("join:", joinAll); // "abc"

// If a function body can't be proven safe to inline (loops, try/catch,
// mutable variables, ...), the call falls back to dictionary passing —
// always correct, just not zero-cost — and emits a TS9602 warning.
// Opt a specific call out entirely with `// @no-specialize`.

// Try: write a Monoid for arrays and specialize flattenAll
