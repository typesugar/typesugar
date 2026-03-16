//! pipe & compose
//! Zero-cost function composition

import { pipe, compose, flow } from "typesugar";

// pipe(), compose(), and flow() transform at compile time
// Check the JS Output - no function calls, just inlined code!

const double = (x: number) => x * 2;
const addTen = (x: number) => x + 10;
const toString = (x: number) => `Result: ${x}`;

// pipe: value flows left-to-right through functions
// Compiles to: toString(addTen(double(5)))
const result1 = pipe(5, double, addTen, toString);
console.log("pipe:", result1); // "Result: 20"

// compose: creates a new function (right-to-left)
// Compiles to: (x) => toString(addTen(double(x)))
const process = compose(toString, addTen, double);
console.log("compose:", process(5)); // "Result: 20"

// flow: like compose but left-to-right (more readable)
// Compiles to: (x) => toString(addTen(double(x)))
const processFlow = flow(double, addTen, toString);
console.log("flow:", processFlow(5)); // "Result: 20"

// Real-world example: data pipeline
const users = [
  { name: "Alice", age: 30 },
  { name: "Bob", age: 25 },
  { name: "Charlie", age: 35 },
];

const result2 = pipe(
  users,
  (arr) => arr.filter(u => u.age >= 30),
  (arr) => arr.map(u => u.name),
  (names) => names.join(", ")
);
console.log("Adults:", result2); // "Alice, Charlie"
