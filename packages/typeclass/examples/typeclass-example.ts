/**
 * Typeclass Example
 *
 * Demonstrates Scala 3-style typeclasses:
 * - @typeclass to define interfaces with extension methods
 * - @instance to provide implementations
 * - @deriving to auto-generate instances
 * - summon<T>() to get instances at compile time
 */

import {
  typeclass,
  instance,
  deriving,
  summon,
  extend,
} from "@ttfx/typeclass";

console.log("=== Typeclass Example ===\n");

// --- Define Typeclasses ---

@typeclass
interface Show<A> {
  show(a: A): string;
}

@typeclass
interface Eq<A> {
  equals(a: A, b: A): boolean;
}

@typeclass
interface Ord<A> extends Eq<A> {
  compare(a: A, b: A): -1 | 0 | 1;
}

// --- Provide Instances ---

@instance(Show, Number)
const numberShow: Show<number> = {
  show: (n) => n.toString(),
};

@instance(Eq, Number)
const numberEq: Eq<number> = {
  equals: (a, b) => a === b,
};

@instance(Show, String)
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

// Get instance at compile time
const showN = summon<Show<number>>();
console.log("summon<Show<number>>().show(100):", showN.show(100));

// --- extend() ---

console.log("\n--- extend() ---");

// Add typeclass methods to values
const result = extend(42).show();
console.log("extend(42).show():", result);

// --- Auto-Deriving ---

console.log("\n--- Auto-Deriving ---");

@deriving(Show, Eq)
interface User {
  id: number;
  name: string;
}

// Derived instances are generated automatically
const user1: User = { id: 1, name: "Alice" };
const user2: User = { id: 1, name: "Alice" };
const user3: User = { id: 2, name: "Bob" };

// Use the derived Show instance
console.log("User1:", extend(user1).show());

// Use the derived Eq instance
console.log("user1 equals user2:", extend(user1).equals(user2));
console.log("user1 equals user3:", extend(user1).equals(user3));

// --- Generic Functions with Typeclass Constraints ---

console.log("\n--- Generic Functions ---");

function showList<A>(items: A[], showInstance: Show<A>): string {
  return "[" + items.map((item) => showInstance.show(item)).join(", ") + "]";
}

const numbers = [1, 2, 3, 4, 5];
console.log("showList([1,2,3,4,5]):", showList(numbers, numberShow));
