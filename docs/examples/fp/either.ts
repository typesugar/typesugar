//! Either — Typed Errors
//! Left(e) and Right(a) wrap values in objects for type-safe error handling.

import { Left, Right, isRight } from "@typesugar/fp";
import type { Either } from "@typesugar/fp";

// Either<E, A> — typed error handling
// Left and Right both allocate wrapper objects: { left: e } and { right: a }
function parseAge(input: string): Either<string, number> {
  const n = parseInt(input, 10);
  return isNaN(n) ? Left("not a number") : n < 0 ? Left("negative") : Right(n);
}

// Use fold to handle both cases
import { fold, map, getOrElse } from "@typesugar/fp";

const parsed = parseAge("25");
const validAge = getOrElse(map(parsed, a => a + 1), () => 0);
console.log("valid:", validAge); // 26

const bad = parseAge("abc");
const invalidAge = getOrElse(map(bad, a => a + 1), () => 0);
console.log("invalid:", invalidAge); // 0

// fold — handle both branches explicitly
const message = fold(
  parseAge("30"),
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

console.log(getOrElse(getEnv("HOME"), () => "?")); // "/Users/alice"
console.log(getOrElse(getEnv("FOO"), () => "?"));  // "?"
