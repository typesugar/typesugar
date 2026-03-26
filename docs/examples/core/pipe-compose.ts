//! pipe & compose
//! Zero-cost function composition

import { pipe, compose } from "typesugar";

// pipe() and compose() transform at compile time
// 👀 Check JS Output to see the zero-cost compilation — nested calls, no wrapper overhead!

const double = (x: number) => x * 2;
const addTen = (x: number) => x + 10;
const format = (x: number) => `Result: ${x}`;

// pipe: value flows left-to-right through functions
// Compiles to: toString(addTen(double(5)))
const result1 = pipe(5, double, addTen, format);
console.log("pipe:", result1); // "Result: 20"

// compose: creates a new function (right-to-left)
// Compiles to: (x) => toString(addTen(double(x)))
const process = compose(format, addTen, double);
console.log("compose:", process(5)); // "Result: 20"

// pipe also works inline — no intermediate variable needed
console.log("inline:", pipe(5, double, addTen, format)); // "Result: 20"

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

// Try: add a fourth step to the data pipeline that uppercases the names
