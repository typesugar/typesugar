//! Either — Typed Errors
//! Left(e) and Right(a) wrap values in objects for type-safe error handling.

import { Left, Right } from "@typesugar/fp";
import type { Either } from "@typesugar/fp";

// Either<E, A> — typed error handling
// Left and Right both allocate wrapper objects: { left: e } and { right: a }
function parseAge(input: string): Either<string, number> {
  const n = parseInt(input, 10);
  return isNaN(n) ? Left("not a number") : n < 0 ? Left("negative") : Right(n);
}

// .map() and .getOrElse() come from typeclass instances (Functor, etc.)
const validAge = parseAge("25").map(a => a + 1).getOrElse(() => 0);
const invalidAge = parseAge("abc").map(a => a + 1).getOrElse(() => 0);
console.log("valid:", validAge);    // 26
console.log("invalid:", invalidAge); // 0

// .fold() — handle both branches explicitly
const message = parseAge("30").fold(
  err => `Error: ${err}`,
  age => `Age next year: ${age + 1}`
);
console.log(message); // "Age next year: 31"

// fromNullable — convert nullable values to Either
import { fromNullable } from "@typesugar/fp";

function getEnv(key: string): Either<string, string> {
  const env: Record<string, string> = { HOME: "/Users/alice" };
  return fromNullable(env[key], () => `missing env var: ${key}`);
}

console.log(getEnv("HOME").getOrElse(() => "?")); // "/Users/alice"
console.log(getEnv("FOO").getOrElse(() => "?"));  // "?"
