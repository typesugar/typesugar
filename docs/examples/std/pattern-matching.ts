//! Pattern Matching
//! Fluent .case().then().else() with exhaustiveness checking

import { match } from "@typesugar/std";

// ============================================================
// 1. Discriminated union — match compiles to an optimized IIFE
// ============================================================

type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "rect"; width: number; height: number }
  | { kind: "triangle"; base: number; height: number };

function area(shape: Shape): number {
  return match(shape)
    .case({ kind: "circle", radius: r }).then(Math.PI * r ** 2)
    .case({ kind: "rect", width: w, height: rh }).then(w * rh)
    .case({ kind: "triangle", base: b, height: th }).then(0.5 * b * th)
    .else(0);
}

const shapes: Shape[] = [
  { kind: "circle", radius: 5 },
  { kind: "rect", width: 4, height: 6 },
  { kind: "triangle", base: 3, height: 8 },
];
for (const s of shapes) {
  console.log(`${s.kind}: area=${area(s).toFixed(1)}`);
}

// ============================================================
// 2. Literal dispatch — string and number patterns
// ============================================================

function httpStatus(code: number): string {
  return match(code)
    .case(200).then("OK")
    .case(301).then("Moved")
    .case(404).then("Not Found")
    .case(500).then("Server Error")
    .else("Unknown");
}
console.log(`\nHTTP 200: ${httpStatus(200)}`);
console.log(`HTTP 404: ${httpStatus(404)}`);

// ============================================================
// 3. Guards — .if() adds runtime conditions
// ============================================================

function classify(n: number): string {
  return match(n)
    .case(x).if(x < 0).then("negative")
    .case(0).then("zero")
    .case(x).if(x <= 100).then("small positive")
    .else("large positive");
}
console.log(`\nclassify(-5): ${classify(-5)}`);
console.log(`classify(0): ${classify(0)}`);
console.log(`classify(42): ${classify(42)}`);
console.log(`classify(999): ${classify(999)}`);

// ============================================================
// 4. Type constructor patterns — String(s), Number(n), etc.
// ============================================================

function describe(value: string | number | boolean): string {
  return match(value)
    .case(String(s)).then(`string of length ${s.length}`)
    .case(Number(n)).then(`number: ${n.toFixed(2)}`)
    .else("boolean");
}
console.log(`\ndescribe("hi"): ${describe("hi")}`);
console.log(`describe(3.14): ${describe(3.14)}`);
console.log(`describe(true): ${describe(true)}`);

// ============================================================
// 5. Array patterns — destructuring, rest, empty
// ============================================================

function summarize<T>(list: T[]): string {
  return match(list)
    .case([]).then("empty")
    .case([x]).then(`single: ${x}`)
    .case([first, second, ...rest]).then(`first=${first}, second=${second}, +${rest.length} more`)
    .else("unreachable");
}
console.log(`\nsummarize([]): ${summarize([])}`);
console.log(`summarize([1]): ${summarize([1])}`);
console.log(`summarize([1,2,3,4]): ${summarize([1, 2, 3, 4])}`);

// ============================================================
// 6. OR patterns — .or() combines alternatives
// ============================================================

type Color = "red" | "green" | "blue" | "yellow" | "cyan" | "magenta";

function colorType(c: Color): string {
  return match(c)
    .case("red").or("green").or("blue").then("primary")
    .else("secondary");
}
console.log(`\nred: ${colorType("red")}`);
console.log(`cyan: ${colorType("cyan")}`);

// ============================================================
// 7. Exhaustiveness — compiler checks all cases are covered
// ============================================================

// When matching a union type, the compiler verifies every variant
// is handled. Try commenting out a .case() below — you'll get:
//   error: Non-exhaustive match — missing case "west"

type Direction = "north" | "south" | "east" | "west";

function opposite(d: Direction): string {
  return match(d)
    .case("north").then("south")
    .case("south").then("north")
    .case("east").then("west")
    .case("west").then("east")
    .else("unreachable"); // all cases covered — .else() is dead code here
}
console.log(`\nopposite("north"): ${opposite("north")}`);
console.log(`opposite("east"): ${opposite("east")}`);

// 👀 Check JS Output — match() compiles to ternary chains or switch IIFEs
