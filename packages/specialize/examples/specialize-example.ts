/**
 * Zero-Cost Specialization Example
 *
 * Demonstrates compile-time specialization for generic functions,
 * eliminating runtime typeclass dictionary passing overhead.
 */

import { specialize, specialize$, mono, inlineCall } from "@ttfx/specialize";

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

// --- With specialize() ---

console.log("\n--- With specialize() ---");

// Create specialized versions — instance baked in at compile time
const showNumbers = specialize(showAll, [numberShow]);
const sortNumbers = specialize(sortWith, [numberOrd]);
const maxNumber = specialize(maxWith, [numberOrd]);

const showStrings = specialize(showAll, [stringShow]);
const sortStrings = specialize(sortWith, [stringOrd]);

// No more passing instances!
console.log("showNumbers(numbers):", showNumbers(numbers));
console.log("sortNumbers(numbers):", sortNumbers(numbers));
console.log("maxNumber(numbers):", maxNumber(numbers));

console.log("showStrings(strings):", showStrings(strings));
console.log("sortStrings(strings):", sortStrings(strings));

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

// --- Performance Comparison ---

console.log("\n--- Performance Note ---");
console.log("With specialization:");
console.log("  - No runtime dictionary lookup");
console.log("  - Instance methods can be inlined");
console.log("  - Zero-cost abstraction");
console.log("\nWithout specialization:");
console.log("  - Instance passed at every call");
console.log("  - Indirect method dispatch");
console.log("  - Small but measurable overhead");
