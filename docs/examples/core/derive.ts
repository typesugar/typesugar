//! @derive
//! Auto-generate typeclass instances + operator overloading

import { derive, Eq, Clone, Debug, summon } from "typesugar";

// @derive() generates typeclass instances at compile time.
// With Eq derived, === is rewritten to use structural equality!
// Click "JS Output" to see the generated instances and operator rewrites.

@derive(Eq, Clone, Debug)
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}

const p1 = new Point(1, 2);
const p2 = new Point(1, 2);
const p3 = new Point(3, 4);

// Operator overloading: === compiles to field-by-field comparison
console.log("p1 === p2:", p1 === p2); // true
console.log("p1 === p3:", p1 === p3); // false

// summon() retrieves the derived instance
const cloneTC = summon<Clone<Point>>();
const p1Copy = cloneTC.clone(p1);
console.log("clone(p1):", p1Copy);
console.log("clone === original:", p1Copy === p1); // true (same values)

// Debug instance — developer-facing string representation
const debugTC = summon<Debug<Point>>();
console.log("debug(p1):", debugTC.debug(p1));
// Output: "Point { x: 1, y: 2 }"
