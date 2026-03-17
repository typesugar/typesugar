//! Persistent Linked List
//! Immutable cons-list with structural sharing

import { Cons, Nil, isCons, isNil, listOf, listFromArray } from "@typesugar/fp";

// Build lists with constructors
const xs = Cons(1, Cons(2, Cons(3, Nil)));
const ys = listOf(10, 20, 30);

// Walk the list
function toArray<A>(list: any): A[] {
  const result: A[] = [];
  let current = list;
  while (isCons(current)) {
    result.push(current.head);
    current = current.tail;
  }
  return result;
}

console.log("Cons(1, 2, 3):", toArray(xs));
console.log("listOf(10, 20, 30):", toArray(ys));

// Structural sharing — prepending is O(1)
const prepended = Cons(0, xs);
console.log("Cons(0, xs):", toArray(prepended));
console.log("Original xs:", toArray(xs)); // unchanged

// Fold left to sum
function foldLeft<A, B>(list: any, init: B, f: (acc: B, a: A) => B): B {
  let acc = init;
  let current = list;
  while (isCons(current)) {
    acc = f(acc, current.head);
    current = current.tail;
  }
  return acc;
}

const sum = foldLeft<number, number>(xs, 0, (acc, n) => acc + n);
const product = foldLeft<number, number>(xs, 1, (acc, n) => acc * n);
console.log("\nsum([1,2,3]):", sum);
console.log("product([1,2,3]):", product);

// From array round-trip
const fromArr = listFromArray([4, 5, 6]);
console.log("listFromArray([4,5,6]):", toArray(fromArr));
