/**
 * = implicit() - Automatic Implicit Parameter Resolution with Propagation
 *
 * This example demonstrates the `= implicit()` default parameter pattern that
 * provides Scala 3-style implicit parameters with automatic propagation.
 *
 * Run with: npx tsx examples/implicits/basic.ts
 * (Uses the macro transformer to expand implicit() calls)
 */

import { typeclass, instance, implicit, summonAll } from "typesugar";

// ----------------------------------------------------------------------------
// 1. Define a typeclass
// ----------------------------------------------------------------------------

@typeclass
interface Show<A> {
  show(a: A): string;
}

// ----------------------------------------------------------------------------
// 2. Register instances using @instance
// ----------------------------------------------------------------------------

@instance
const showNumber: Show<number> = {
  show: (a) => String(a),
};

@instance
const showString: Show<string> = {
  show: (a) => `"${a}"`,
};

@instance
const showBoolean: Show<boolean> = {
  show: (a) => a ? "true" : "false",
};

// ----------------------------------------------------------------------------
// 3. Use = implicit() to mark parameters as implicit
// ----------------------------------------------------------------------------

// Basic usage - S defaults to implicit(), auto-resolved from the registry
function show<A>(a: A, S: Show<A> = implicit()): string {
  return S.show(a);
}

// When called, the implicit parameter is filled in automatically!
// show(42) → show(42, Show.summon<number>("number"))
console.log("show(42):", show(42));
console.log('show("hello"):', show("hello"));
console.log("show(true):", show(true));

// ----------------------------------------------------------------------------
// 4. Automatic Propagation - The killer feature!
// ----------------------------------------------------------------------------

// When outer calls inner, the Show<A> is propagated automatically
function showTwice<A>(a: A, S: Show<A> = implicit()): string {
  // show(a) gets S passed automatically - no explicit threading!
  return `${show(a)} and ${show(a)}`;
}

function showWrapped<A>(a: A, prefix: string, S: Show<A> = implicit()): string {
  // S propagates to show(a) automatically
  return `${prefix}: ${show(a)}`;
}

function showNested<A>(a: A, S: Show<A> = implicit()): string {
  // Propagation through multiple levels!
  return showWrapped(a, "Value");
}

console.log("\n--- Propagation ---");
console.log("showTwice(42):", showTwice(42));
console.log("showWrapped(42, 'Number'):", showWrapped(42, "Number"));
console.log("showNested(42):", showNested(42));

// ----------------------------------------------------------------------------
// 5. Explicit Override - Pass custom instance when needed
// ----------------------------------------------------------------------------

const fancyShowNumber: Show<number> = {
  show: (a) => `✨${a}✨`,
};

// When you pass the instance explicitly, it overrides the global one
// AND propagates to nested calls!
console.log("\n--- Explicit Override ---");
console.log("showTwice(42, fancyShowNumber):", showTwice(42, fancyShowNumber));

// ----------------------------------------------------------------------------
// 6. Disambiguation with explicit parameter names
// ----------------------------------------------------------------------------

// Sometimes you have multiple parameters that look like typeclasses.
// Only the ones with = implicit() are auto-resolved:

@typeclass
interface Eq<A> {
  equals(a: A, b: A): boolean;
}

@instance
const eqNumber: Eq<number> = {
  equals: (a, b) => a === b,
};

// Only E is implicit, compareFn is a regular callback
function findFirst<A>(
  items: A[],
  target: A,
  compareFn: (a: A, b: A) => number,
  E: Eq<A> = implicit(),
): A | undefined {
  for (const item of items) {
    if (E.equals(item, target)) {
      return item;
    }
  }
  return undefined;
}

const numbers = [1, 2, 3, 4, 5];
const result = findFirst(numbers, 3, (a, b) => a - b);
console.log("\n--- Disambiguation ---");
console.log("findFirst([1,2,3,4,5], 3, compareFn):", result);

// ----------------------------------------------------------------------------
// 7. summonAll - Get multiple instances at once
// ----------------------------------------------------------------------------

const [showNum, eqNum] = summonAll<Show<number>, Eq<number>>();
console.log("\n--- summonAll ---");
console.log("showNum.show(123):", showNum.show(123));
console.log("eqNum.equals(1, 1):", eqNum.equals(1, 1));

// ----------------------------------------------------------------------------
// Summary of transformations:
//
// Input:
//   show(42)
//
// Output:
//   show(42, Show.summon<number>("number"))
//
// With propagation:
//   function outer<A>(a: A, S: Show<A> = implicit()) {
//     return show(a);  // S is captured and passed to show
//   }
//
//   outer(42)
//   → outer(42, Show.summon<number>("number"))
//   → show(42, S)  // S from outer's param, not global
//
// Explicit override:
//   outer(42, customShow)
//   → show(42, customShow)  // custom instance flows through
// ----------------------------------------------------------------------------
