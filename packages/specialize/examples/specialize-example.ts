/**
 * Zero-Cost Specialization Example
 *
 * Demonstrates compile-time specialization for generic functions,
 * eliminating runtime typeclass dictionary passing overhead.
 */

import { specialize, specialize$, mono, inlineCall } from "@typesugar/specialize";

console.log("=== Zero-Cost Specialization Example ===\n");

// --- Typeclass Definitions ---

interface Show<A> {
  show(a: A): string;
}

interface Ord<A> {
  compare(a: A, b: A): -1 | 0 | 1;
}

// --- Typeclass Instances ---

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
  compare: (a, b) => a.localeCompare(b) as -1 | 0 | 1,
};

// --- Generic Functions ---

function showAll<A>(items: A[], showInstance: Show<A>): string {
  return "[" + items.map((item) => showInstance.show(item)).join(", ") + "]";
}

function sortWith<A>(items: A[], ord: Ord<A>): A[] {
  return items.slice().sort((a, b) => ord.compare(a, b));
}

function maxWith<A>(items: A[], ord: Ord<A>): A | undefined {
  if (items.length === 0) return undefined;
  return items.reduce((max, item) => (ord.compare(item, max) > 0 ? item : max));
}

// --- Without Specialization (Runtime Dictionary Passing) ---

console.log("--- Without Specialization ---");

const numbers = [3, 1, 4, 1, 5, 9, 2, 6];
const strings = ["banana", "apple", "cherry", "date"];

// Must pass instance at every call
console.log("showAll(numbers):", showAll(numbers, numberShow));
console.log("sortWith(numbers):", sortWith(numbers, numberOrd));
console.log("maxWith(numbers):", maxWith(numbers, numberOrd));

// ==========================================================================
// NEW: Extension Method Syntax (Preferred)
// ==========================================================================

console.log("\n--- Extension Method Syntax (Preferred) ---");

// Create specialized versions using .specialize() on the function itself
// Instance is baked in at compile time — zero runtime cost
const showNumbersExt = showAll.specialize(numberShow);
const sortNumbersExt = sortWith.specialize(numberOrd);
const maxNumberExt = maxWith.specialize(numberOrd);

const showStringsExt = showAll.specialize(stringShow);
const sortStringsExt = sortWith.specialize(stringOrd);

// No more passing instances!
console.log("showNumbersExt(numbers):", showNumbersExt(numbers));
console.log("sortNumbersExt(numbers):", sortNumbersExt(numbers));
console.log("maxNumberExt(numbers):", maxNumberExt(numbers));

console.log("showStringsExt(strings):", showStringsExt(strings));
console.log("sortStringsExt(strings):", sortStringsExt(strings));

// Multiple dictionaries
function sortAndShow<A>(items: A[], ord: Ord<A>, show: Show<A>): string {
  const sorted = items.slice().sort((a, b) => ord.compare(a, b));
  return "[" + sorted.map((item) => show.show(item)).join(", ") + "]";
}

// Specialize with multiple instances in one call
const sortAndShowNumbers = sortAndShow.specialize(numberOrd, numberShow);
console.log("sortAndShowNumbers(numbers):", sortAndShowNumbers(numbers));

// ==========================================================================
// Legacy: specialize() Function (Still Supported)
// ==========================================================================

console.log("\n--- Legacy specialize() Function ---");

// Still works for backwards compatibility
const showNumbersLegacy = specialize(showAll, [numberShow]);
const sortNumbersLegacy = specialize(sortWith, [numberOrd]);

console.log("showNumbersLegacy(numbers):", showNumbersLegacy(numbers));
console.log("sortNumbersLegacy(numbers):", sortNumbersLegacy(numbers));

// --- specialize$() for single calls ---

console.log("\n--- specialize$() for Single Calls ---");

// Inline specialization for one-off calls
const result = specialize$(sortWith([5, 2, 8, 1, 9], numberOrd));
console.log("specialize$(sortWith([5,2,8,1,9])):", result);

// --- mono() for monomorphization ---

console.log("\n--- mono() for Monomorphization ---");

// Generic identity function
const identity = <T>(x: T): T => x;

// Monomorphize for specific types
const identityNumber = mono<number>(identity);
const identityString = mono<string>(identity);

console.log("identityNumber(42):", identityNumber(42));
console.log("identityString('hello'):", identityString("hello"));

// --- inlineCall() ---

console.log("\n--- inlineCall() ---");

const double = (x: number) => x * 2;
const addOne = (x: number) => x + 1;

// Inline function calls at compile time
const inlined = inlineCall(double(inlineCall(addOne(20))));
console.log("inlineCall(double(inlineCall(addOne(20)))):", inlined);
// Compiles to: (20 + 1) * 2 = 42

// ==========================================================================
// Summary
// ==========================================================================

console.log("\n--- Summary ---");
console.log("Three ways to specialize:");
console.log("  1. fn.specialize(dict)     — Extension method (preferred)");
console.log("  2. specialize(fn, [dict])  — Legacy function wrapper");
console.log("  3. @implicits + auto-spec  — Fully automatic (best for most cases)");
console.log("\nAll produce zero-cost code:");
console.log("  - No runtime dictionary lookup");
console.log("  - Instance methods inlined at call sites");
console.log("  - Same performance as hand-written specialized code");
