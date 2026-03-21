//! Option — Zero-Cost
//! Some(x) is x, None is null. Dot-syntax compiles to null checks.

import { Some, None, Left, Right } from "@typesugar/fp";
import type { Option, Either } from "@typesugar/fp";

// Some(42) IS 42 at runtime. None IS null. No wrapper objects.
const user: Option<string> = Some("Alice");
const missing: Option<string> = None;

// 👀 Check JS Output — .map().filter().getOrElse() becomes null checks
const greeting = Some("Alice")
  .map(name => `Hello, ${name}!`)
  .filter(s => s.length < 50)
  .getOrElse(() => "Hello, stranger!");

console.log(greeting); // "Hello, Alice!"

// Safe config lookup — chain handles missing keys gracefully
function findPort(env: Record<string, string>): Option<number> {
  return Some(env["PORT"])
    .map(s => parseInt(s, 10))
    .filter(n => !isNaN(n) && n > 0);
}

const port = findPort({ PORT: "3000" }).getOrElse(() => 8080);
const fallback = findPort({}).getOrElse(() => 8080);
console.log("port:", port);         // 3000
console.log("fallback:", fallback); // 8080

// .fold() — extract with handlers for both cases
const label = Some("admin").fold(
  () => "no role",
  role => `role: ${role}`
);
console.log(label); // "role: admin"

// Either<E, A> — typed error handling
// 👀 Right(x) IS x, Left(e) IS { left: e } at runtime
function parseAge(input: string): Either<string, number> {
  const n = parseInt(input, 10);
  return isNaN(n) ? Left("not a number") : n < 0 ? Left("negative") : Right(n);
}

const validAge = parseAge("25").map(a => a + 1).getOrElse(() => 0);
const invalidAge = parseAge("abc").map(a => a + 1).getOrElse(() => 0);
console.log("valid:", validAge);    // 26
console.log("invalid:", invalidAge); // 0

// Try: change Some("Alice") to None and watch the output change
