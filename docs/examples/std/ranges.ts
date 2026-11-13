//! Ranges & Iteration
//! Scala/Kotlin-style ranges with functional operations

import { to, until, toArray, size, contains, map, filter, reduce, forEach } from "@typesugar/std";
import { staticAssert } from "typesugar";

// Gauss's formula verified at compile time
staticAssert(100 * 101 / 2 === 5050, "Gauss sum 1..100");

// Exclusive range: 1 until 10 (not including 10)
const r1 = (1).until(10);
console.log("(1).until(10):", r1.toArray());
console.log("size:", r1.size());
console.log("contains(5):", r1.contains(5));
console.log("contains(10):", r1.contains(10));

// Inclusive range
const r2 = (1).to(5);
console.log("\n(1).to(5):", r2.toArray());

// Functional operations on ranges
const squares = (1).to(10).map(n => n * n);
console.log("\n1..10 squared:", squares);

const evens = (1).until(20).filter(n => n % 2 === 0);
console.log("evens in 1..20:", evens);

const sum = (1).to(100).reduce(0, (acc, n) => acc + n);
console.log("sum(1..100):", sum);

// FizzBuzz with ranges
// 👀 Check JS Output to see the compilation — each method call becomes a direct function call
console.log("\nFizzBuzz 1..20:");
(1).to(20).forEach(n => {
  const s = (n % 3 === 0 ? "Fizz" : "") + (n % 5 === 0 ? "Buzz" : "");
  console.log(`  ${n}: ${s || n}`);
});

// Try: change (1).to(100) in the sum to (1).to(1000) and check the result
