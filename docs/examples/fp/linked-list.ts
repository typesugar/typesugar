//! Persistent Linked List
//! Immutable cons-list with pattern matching on variants

import { Cons, Nil, listOf, isCons } from "@typesugar/fp";
import { match } from "@typesugar/std";
import type { List } from "@typesugar/fp";

// Nil is null at runtime — zero-cost empty list
const nums = Cons(1, Cons(2, Cons(3, Nil)));
const pets = listOf("cat", "dog", "fish");

// Cons(h, t) and Nil are extractors: fp ships a Destructure instance for each,
// and together they cover List, so no .else() is needed.
// 👀 Check JS Output — the patterns compile to null checks and field reads
function sum(list: List<number>): number {
  return match(list)
    .case(Nil).then(0)
    .case(Cons(h, t)).then(h + sum(t));
}
console.log("sum:", sum(nums)); // 6

function describe<A>(list: List<A>): string {
  return match(list)
    .case(null).then("empty")
    .case({ head: h, tail: null }).then(`[${h}]`)
    .case({ head: h }).then(`[${h}, ...]`)
    .else("?");
}
console.log(describe(Nil));            // "empty"
console.log(describe(Cons(42, Nil)));  // "[42]"
console.log(describe(nums));           // "[1, ...]"

// Structural sharing — prepend is O(1), original untouched
const withZero = Cons(0, nums);

function toArray<A>(list: List<A>): A[] {
  const out: A[] = [];
  let cur: List<A> = list;
  while (isCons(cur)) { out.push(cur.head); cur = cur.tail; }
  return out;
}

console.log("prepended:", toArray(withZero)); // [0, 1, 2, 3]
console.log("original:", toArray(nums));      // [1, 2, 3]
console.log("pets:", toArray(pets));           // ["cat", "dog", "fish"]

// Try: add Cons(4, Cons(5, Nil)) and verify sum computes 15
