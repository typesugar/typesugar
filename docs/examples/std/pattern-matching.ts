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
    .case({ kind: "rect", width: w, height: rh }).then(w * rh)
    .case({ kind: "triangle", base: b, height: th }).then(0.5 * b * th)
    .else(0);
}

// Guard patterns — .if() adds runtime conditions
function classify(shape: Shape): string {
  return match(shape)
    .case({ kind: "circle", radius: r }).if(() => r > 10).then("big circle")
    .case({ kind: "circle" }).then("small circle")
    .case({ kind: "rect", width: rw, height: rh }).if(() => rw === rh).then("square")
    .else("other shape");
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
  console.log(`${s.kind}: area=${area(s).toFixed(1)}, ${classify(s)}`);
}

console.log(head([]), head([42]), head([1, 2]), head([1, 2, 3]));

// 👀 Check JS Output — match() compiles to ternary chains or switch IIFEs
// Try: add a new shape variant and see the exhaustiveness error
