/**
 * My typesugar Library
 *
 * This template demonstrates building a library with typeclasses and derives.
 */

import { typeclass, instance, deriving, summon, extend } from "@typesugar/typeclass";
import { derive, Eq, Clone, Debug } from "@typesugar/derive";

// Define a typeclass
@typeclass
export interface Printable<A> {
  print(a: A): string;
}

// Provide instances for primitives
@instance
export const PrintableNumber: Printable<number> = {
  print: (n) => n.toString(),
};

@instance
export const PrintableString: Printable<string> = {
  print: (s) => `"${s}"`,
};

// Define domain types with derived implementations
@derive(Eq, Clone, Debug)
@deriving(Printable)
export class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}

// Generic function using typeclass
export function printAll<A>(items: A[], P: Printable<A> = summon<Printable<A>>()): string {
  return items.map((item) => P.print(item)).join(", ");
}

// Extension method usage
export function printPoint(point: Point): string {
  return extend(point).print();
}

// Re-export typeclass for users
export { Printable };
