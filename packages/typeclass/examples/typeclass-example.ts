/**
 * Typeclass Example
 *
 * Demonstrates Scala 3-style typeclasses:
 * - the @typeclass JSDoc tag to define a typeclass
 * - the @impl TC<T> JSDoc tag to provide instances
 * - @derive to generate instances for a type you own
 * - summon<T>() to get an instance at compile time
 * - = implicit() to have instances filled in at each call site
 * - extend() / method syntax to call typeclass methods on values
 */

import { summon, implicit, extend } from "@typesugar/typeclass";

console.log("=== Typeclass Example ===\n");

// --- Define Typeclasses ---

/** @typeclass */
interface Show<A> {
  show(a: A): string;
}

/** @typeclass */
interface Eq<A> {
  equals(a: A, b: A): boolean;
}

// --- Provide Instances ---

/** @impl Show<number> */
const numberShow: Show<number> = {
  show: (n) => n.toString(),
};

/** @impl Eq<number> */
const numberEq: Eq<number> = {
  equals: (a, b) => a === b,
};

/** @impl Show<string> */
const stringShow: Show<string> = {
  show: (s) => `"${s}"`,
};

// --- Use Instances ---

console.log("--- Manual Instances ---");

console.log("numberShow.show(42):", numberShow.show(42));
console.log("stringShow.show('hello'):", stringShow.show("hello"));
console.log("numberEq.equals(1, 1):", numberEq.equals(1, 1));
console.log("numberEq.equals(1, 2):", numberEq.equals(1, 2));

// --- summon<T>() ---

console.log("\n--- summon<T>() ---");

// Resolved at compile time to the instance in scope (numberShow)
const showN = summon<Show<number>>();
console.log("summon<Show<number>>().show(100):", showN.show(100));

// --- extend() and method syntax ---

console.log("\n--- extend() ---");

// This file declares Show, so its methods are callable on values here
console.log("extend(42).show():", extend(42).show());
const seven: number = 7;
console.log("seven.show():", seven.show());

// --- Deriving ---

console.log("\n--- Deriving ---");

/** @derive(Show, Eq) */
interface User {
  id: number;
  name: string;
}

// @derive generated User.Show and User.Eq from the fields' instances
const user1: User = { id: 1, name: "Alice" };
const user2: User = { id: 1, name: "Alice" };
const user3: User = { id: 2, name: "Bob" };

console.log("User1:", user1.show());
console.log("user1 equals user2:", user1.equals(user2));
console.log("user1 equals user3:", extend(user1).equals(user3));

// --- Generic Functions: = implicit() ---

console.log("\n--- Generic Functions ---");

function showList<A>(items: A[], S: Show<A> = implicit()): string {
  return "[" + items.map((item) => S.show(item)).join(", ") + "]";
}

console.log("showList([1,2,3,4,5]):", showList([1, 2, 3, 4, 5]));
console.log("showList(['a','b']):", showList(["a", "b"]));
