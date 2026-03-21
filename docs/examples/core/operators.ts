//! Operator Overloading
//! a + b compiles to addVec2.add(a, b) — zero cost

import { derive, Eq } from "typesugar";

// Define a typeclass with @op annotations on methods.
// The transformer rewrites operators to method calls automatically — no ops() wrapper needed.

/** @typeclass */
interface Addable<A> {
  /** @op + */
  add(a: A, b: A): A;
}

class Vec2 {
  constructor(public x: number, public y: number) {}
  toString(): string { return `(${this.x}, ${this.y})`; }
}

/** @impl Addable<Vec2> */
const addableVec2: Addable<Vec2> = {
  add: (a, b) => new Vec2(a.x + b.x, a.y + b.y),
};

// @derive(Eq) gives us === for free (structural equality, fully inlined)
@derive(Eq)
class Point {
  constructor(public x: number, public y: number) {}
}

const a = new Vec2(1, 2);
const b = new Vec2(3, 4);

// 👀 In JS Output: a + b becomes new Vec2(a.x + b.x, a.y + b.y)
const sum = a + b;
console.log(`${a} + ${b} = ${sum}`);

const p1 = new Point(1, 2);
const p2 = new Point(1, 2);
const p3 = new Point(3, 4);

// 👀 In JS Output: === becomes p1.x === p2.x && p1.y === p2.y
console.log("p1 === p2:", p1 === p2);
console.log("p1 === p3:", p1 === p3);

// Try: add a "scale" method with @op * and use a * b
