/**
 * My typesugar Library
 *
 * This template demonstrates building a library with typeclasses and derives.
 */

import { derive, Eq, Clone, Debug, summon, implicit } from "typesugar";

// Define a typeclass
/** @typeclass */
export interface Printable<A> {
  print(a: A): string;
}

// Provide instances for primitives
/** @impl Printable<number> */
export const PrintableNumber: Printable<number> = {
  print: (n) => n.toString(),
};

/** @impl Printable<string> */
export const PrintableString: Printable<string> = {
  print: (s) => `"${s}"`,
};

// Define domain types with derived implementations: Point.Eq, Point.Clone and
// Point.Debug are generated next to the class.
@derive(Eq, Clone, Debug)
export class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}

/** @impl Printable<Point> */
export const PrintablePoint: Printable<Point> = {
  print: (p) => `(${p.x}, ${p.y})`,
};

// Generic function: the instance is filled in at each call site
export function printAll<A>(items: A[], P: Printable<A> = implicit()): string {
  return items.map((item) => P.print(item)).join(", ");
}

// Resolve an instance by type
export function printPoint(point: Point): string {
  return summon<Printable<Point>>().print(point);
}
