//! @typeclass
//! Typeclasses and instances

import { summon } from "typesugar";

// @typeclass uses JSDoc syntax — /** @typeclass */ on interface, /** @impl TC<T> */ on instances
// Check JS Output tab to see the generated registry, summon(), and namespace!

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

// Use summon() to get the instance at compile time!
const showN = summon<Show<number>>();
const showS = summon<Show<string>>();
const showA = summon<Show<number[]>>();

console.log("showN.show(42):", showN.show(42));           // "42"
console.log("showS.show('hi'):", showS.show("hi"));       // "\"hi\""
console.log("showA.show([1,2,3]):", showA.show([1, 2, 3])); // "[1, 2, 3]"
