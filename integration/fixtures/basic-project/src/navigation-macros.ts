// Integration test fixture: navigation across macro expansions
import { pipe } from "typesugar";

/** @derive(Eq) */
interface Vec {
  x: number;
  y: number;
}

export function scale(v: Vec, k: number): Vec {
  return { x: v.x * k, y: v.y * k };
}

const doubled = pipe(
  { x: 1, y: 2 },
  (v: Vec) => scale(v, 2),
  (v: Vec) => v
);

const tripled = scale(doubled, 3);
