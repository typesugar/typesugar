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

// summon() gets a specific instance at compile time
const showN = summon<Show<number>>();
console.log("summon<Show<number>>().show(42):", showN.show(42));

// implicit() enables generic functions — instance resolved at each call site
function show<A>(value: A, S: Show<A> = implicit()): string {
  return S.show(value);
}

// Each call resolves to the correct instance automatically:
console.log("show(42):", show(42));
console.log('show("hi"):', show("hello"));
// Auto-derivation: summon synthesizes instances for your own types
// No @derive or @impl needed — just define the type!
interface Point { x: number; y: number; }

console.log("show(point):", show({ x: 1, y: 2 } as Point));

// Try: add a z field to Point and watch the derived show expand
