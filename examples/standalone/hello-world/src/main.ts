/**
 * typesugar hello world.
 *
 * Three headline features. Run `npm run expand` to see what each one
 * actually compiles to — that's the whole point: there is no runtime library
 * doing this work at runtime.
 */

import { comptime, derive } from "typesugar";
import { Eq, Debug, match } from "@typesugar/std";

// Operator sugar is IMPORT-SCOPED: `===` only rewrites to the derived Eq
// instance in files that opt in by importing the syntax marker. Without this
// line, `a === b` below stays plain reference equality (and would be false).
import "@typesugar/std/syntax/eq/ops";

// ---------------------------------------------------------------------------
// 1. comptime — evaluated at BUILD time, inlined as a literal.
// ---------------------------------------------------------------------------

const BUILT_AT = comptime(new Date().toISOString());

// This loop does not exist in the output. The sum is baked in as `5050`.
const SUM_1_TO_100 = comptime(() => {
  let total = 0;
  for (let i = 1; i <= 100; i++) total += i;
  return total;
});

// ---------------------------------------------------------------------------
// 2. @derive — generates typeclass instances for a type.
//    JSDoc form is portable: a plain `tsc` never complains about it.
// ---------------------------------------------------------------------------

/** @derive(Eq, Debug) */
interface Point {
  x: number;
  y: number;
}

const a: Point = { x: 1, y: 2 };
const b: Point = { x: 1, y: 2 };

// `===` on a derived type is rewritten to the generated companion,
// i.e. Point.Eq.equals(a, b) — a structural compare, not reference equality.
const same = a === b; // true

// ---------------------------------------------------------------------------
// 3. match — exhaustive pattern matching. Miss a variant → compile error.
// ---------------------------------------------------------------------------

type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "square"; side: number };

function area(shape: Shape): number {
  return match(shape, {
    circle: (s) => Math.PI * s.radius ** 2,
    square: (s) => s.side ** 2,
  });
}

// ---------------------------------------------------------------------------

const lines = [
  `built at:        ${BUILT_AT}`,
  `sum 1..100:      ${SUM_1_TO_100}   (computed at build time)`,
  `a === b:         ${same}   (structural, via the derived Eq)`,
  `debug(a):        ${Point.Debug.debug(a)}`,
  `area(circle r2): ${area({ kind: "circle", radius: 2 }).toFixed(2)}`,
];

const out = lines.join("\n");
console.log(out);

const el = document.getElementById("out");
if (el) el.textContent = out;
