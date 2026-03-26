//! Either — Typed Errors
//! Left(e) and Right(a) wrap values in objects for type-safe error handling.

import { Left, Right, map, fold, getOrElse, isRight } from "@typesugar/fp/data/either";
import type { Either } from "@typesugar/fp";

// Either<E, A> — typed error handling
// Left and Right both allocate wrapper objects: { left: e } and { right: a }
function parseAge(input: string): Either<string, number> {
  const n = parseInt(input, 10);
  return isNaN(n) ? Left("not a number") : n < 0 ? Left("negative") : Right(n);
}

// Standalone functions: map, getOrElse, fold
const validAge = getOrElse(map(parseAge("25"), a => a + 1), () => 0);
const invalidAge = getOrElse(map(parseAge("abc"), a => a + 1), () => 0);
console.log("valid:", validAge);    // 26
console.log("invalid:", invalidAge); // 0

// fold — handle both branches explicitly
const message = fold(
  parseAge("30"),
  err => `Error: ${err}`,
  age => `Age next year: ${age + 1}`
);
console.log(message); // "Age next year: 31"

// Manual nullable-to-Either conversion using Left/Right
function getEnv(key: string): Either<string, string> {
  const env: Record<string, string> = { HOME: "/Users/alice" };
  const val = env[key];
  return val !== undefined ? Right(val) : Left(`missing env var: ${key}`);
}

console.log(getOrElse(getEnv("HOME"), () => "?")); // "/Users/alice"
console.log(getOrElse(getEnv("FOO"), () => "?"));  // "?"

// Type guards: isRight checks which branch we're on
console.log("Right(42) is right?", isRight(Right(42))); // true
console.log("Left('x') is right?", isRight(Left("x"))); // false
