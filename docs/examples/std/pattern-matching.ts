//! Pattern Matching
//! Fluent .case().then().else() with exhaustiveness checking

import { match } from "@typesugar/std";

// Discriminated union — match compiles to an optimized IIFE
type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "rect"; width: number; height: number }
  | { kind: "triangle"; base: number; height: number };

function describe(shape: Shape): string {
  return match(shape)
    .case({ kind: "circle" }).then("a circle")
    .case({ kind: "rect" }).then("a rectangle")
    .case({ kind: "triangle" }).then("a triangle")
    .else("unknown");
}

function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return Math.PI * shape.radius ** 2;
    case "rect":
      return shape.width * shape.height;
    case "triangle":
      return 0.5 * shape.base * shape.height;
  }
}

const shapes: Shape[] = [
  { kind: "circle", radius: 5 },
  { kind: "rect", width: 4, height: 6 },
  { kind: "triangle", base: 3, height: 8 },
];

for (const s of shapes) {
  console.log(`${describe(s)}: area=${area(s).toFixed(1)}`);
}

// 👀 Check JS Output — match() compiles to ternary chains or switch IIFEs
// Try: add a new shape variant and see the exhaustiveness error
