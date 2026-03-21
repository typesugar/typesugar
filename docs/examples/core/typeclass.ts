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

/** @impl Show<boolean> */
const showBool: Show<boolean> = {
  show: (b) => b ? "true" : "false",
};

// summon() gets a specific instance at compile time
const showN = summon<Show<number>>();
console.log("summon<Show<number>>().show(42):", showN.show(42));

// implicit() enables generic functions — instance resolved at each call site
function showValue(value: number, S: Show<number> = implicit()): string {
  return S.show(value);
}

function showStr(value: string, S: Show<string> = implicit()): string {
  return S.show(value);
}

// Each call resolves to the correct instance automatically:
console.log("show(42):", showValue(42));
console.log('show("hi"):', showStr("hello"));
console.log("show(true):", showBool.show(true));

// Works with any type that has a Show instance — fully type-safe!

// Try: add a Show<Date> instance
