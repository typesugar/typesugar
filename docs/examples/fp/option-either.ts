//! Option — Zero-Cost
//! Some(x) is x, None is null. Dot-syntax compiles to null checks.

import { Some, None } from "@typesugar/fp";
import type { Option } from "@typesugar/fp";

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

// Option chains — flatMap composes without null checks
// 👀 Compiles to: null-safe ternary chains
const sum = Some(10).flatMap(x => Some(20).map(y => x + y));
console.log("sum:", sum); // 30

const nothing = None.flatMap(() => Some(99));
console.log("nothing:", nothing); // null

// Try: change Some("Alice") to None and watch the output change
