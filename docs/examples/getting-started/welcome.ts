//! Welcome to typesugar
//! See how macros transform your code — check JS Output!

import { comptime, staticAssert, derive, Eq, pipe } from "typesugar";
import { match } from "@typesugar/std";

// 1. comptime() evaluates at BUILD TIME — the result is inlined as a literal
const buildId = comptime(() => Math.random().toString(36).slice(2, 8));

// 2. staticAssert() proves invariants at compile time, then vanishes
staticAssert(1 + 1 === 2, "math works");
staticAssert("typesugar".length === 9);

// 3. @derive generates Eq — the === operator becomes field-by-field comparison
@derive(Eq)
class Point {
  constructor(public x: number, public y: number) {}
}

const p1 = new Point(3, 4);
const p2 = new Point(3, 4);
const p3 = new Point(1, 2);

// 👀 In JS Output: === becomes p1.x === p2.x && p1.y === p2.y
console.log("p1 === p2?", p1 === p2);  // true (structural!)
console.log("p1 === p3?", p1 === p3);  // false

// 4. match() compiles to optimized ternary chains
const grade = match(85)
  .case(x).if(x >= 90).then("A")
  .case(x).if(x >= 80).then("B")
  .case(x).if(x >= 70).then("C")
  .else("F");
console.log("grade:", grade);

// 5. pipe() inlines to nested function calls — no intermediate array
const double = (n: number) => n * 2;
const addTen = (n: number) => n + 10;
const asStr = (n: number) => `result: ${n}`;

// 👀 In JS Output: pipe(5, f, g, h) → h(g(f(5)))
const result = pipe(5, double, addTen, asStr);
console.log(result);  // "result: 20"
console.log("build:", buildId);

// Try: change the Point fields and watch the === comparison adapt
