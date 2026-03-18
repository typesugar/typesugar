//! @typeclass
//! Typeclasses, instances, and generic functions

import { summon, implicit } from "typesugar";

// @typeclass uses JSDoc syntax — /** @typeclass */ on interface, /** @impl TC<T> */ on instances
// 👀 Check JS Output to see the zero-cost compilation — generated registry and summon() resolution!

/** @typeclass */
interface Show<A> {
  show(value: A): string;
}

/** @impl Show<number> */
const showNumber: Show<number> = {
  show: (n) => String(n),
};

/** @impl Show<string> */
const showString: Show<string> = {
  show: (s) => `"${s}"`,
};

/** @impl Show<number[]> */
const showArray: Show<number[]> = {
  show: (arr) => `[${arr.join(", ")}]`,
};

// summon() gets a specific instance at compile time
const showN = summon<Show<number>>();
console.log("summon<Show<number>>().show(42):", showN.show(42));

// implicit() enables generic functions — the instance is resolved at each call site!
function print<A>(value: A, _show: Show<A> = implicit()): void {
  console.log(_show.show(value));
}

// Each call resolves to the correct instance automatically:
print(42);           // uses showNumber
print("hello");      // uses showString  
print([1, 2, 3]);    // uses showArray

// Works with any type that has a Show instance — fully type-safe!

// Try: add a Show<boolean> instance and call print(true)
