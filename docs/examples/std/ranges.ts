//! Ranges & Iteration
//! Scala/Kotlin-style ranges with functional operations

import { range, rangeInclusive, rangeToArray, rangeMap, rangeFilter, rangeReduce, rangeForEach, rangeContains, rangeSize } from "@typesugar/std";

// Exclusive range: 1 to 10 (not including 10)
const r1 = range(1, 10);
console.log("range(1, 10):", rangeToArray(r1));
console.log("size:", rangeSize(r1));
console.log("contains(5):", rangeContains(r1, 5));
console.log("contains(10):", rangeContains(r1, 10));

// Inclusive range
const r2 = rangeInclusive(1, 5);
console.log("\nrangeInclusive(1, 5):", rangeToArray(r2));

// Functional operations on ranges
const squares = rangeMap(rangeInclusive(1, 10), n => n * n);
console.log("\n1..10 squared:", squares);

const evens = rangeFilter(range(1, 20), n => n % 2 === 0);
console.log("evens in 1..20:", evens);

const sum = rangeReduce(rangeInclusive(1, 100), 0, (acc, n) => acc + n);
console.log("sum(1..100):", sum);

// FizzBuzz with ranges
console.log("\nFizzBuzz 1..20:");
rangeForEach(rangeInclusive(1, 20), n => {
  const s = (n % 3 === 0 ? "Fizz" : "") + (n % 5 === 0 ? "Buzz" : "");
  console.log(`  ${n}: ${s || n}`);
});
