//! Pattern Matching
//! Fluent .case().then().else() with exhaustiveness checking

import { match } from "@typesugar/std";

// Discriminated union — match compiles to an optimized IIFE
type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "rect"; width: number; height: number }
  | { kind: "triangle"; base: number; height: number };

function area(shape: Shape): number {
  return match(shape)
    .case({ kind: "circle", radius: r }).then(Math.PI * r ** 2)
    .case({ kind: "rect", width: w, height: h }).then(w * h)
    .case({ kind: "triangle", base: b, height: h }).then(0.5 * b * h)
    .else(0);
}

// OR patterns — share a handler across multiple cases
function describe(shape: Shape): string {
  return match(shape)
    .case({ kind: "circle" }).or({ kind: "rect" }).then("flat shape")
    .case({ kind: "triangle" }).then("angled shape")
    .else("unknown");
}

// Array patterns with destructuring
function head(arr: number[]): string {
  return match(arr)
    .case([]).then("empty")
    .case([x]).then(`one: ${x}`)
    .case([x, y]).then(`two: ${x}, ${y}`)
    .else("many");
}

const shapes: Shape[] = [
  { kind: "circle", radius: 5 },
  { kind: "rect", width: 4, height: 6 },
  { kind: "triangle", base: 3, height: 8 },
];

for (const s of shapes) {
  console.log(`${s.kind}: area=${area(s).toFixed(1)}, ${describe(s)}`);
}

console.log(head([]), head([42]), head([1, 2]), head([1, 2, 3]));

// 👀 Check JS Output — match() compiles to ternary chains or switch IIFEs
// Try: add a new shape variant and see the exhaustiveness error
