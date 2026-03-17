//! @derive
//! Auto-generate implementations + operator overloading

import { derive, Eq, Clone, Debug } from "typesugar";

// @derive() auto-generates implementations at compile time.
// With Eq in scope, === is rewritten to use structural equality!
// Click "JS Output" tab to see the generated code and operator rewrites.

// Example with an interface - generates standalone functions
@derive(Eq, Clone, Debug)
interface Point {
  x: number;
  y: number;
}

// Create some points
const p1: Point = { x: 1, y: 2 };
const p2: Point = { x: 1, y: 2 };
const p3: Point = { x: 3, y: 4 };

// With @derive(Eq), you can use === for structural equality!
// typesugar rewrites p1 === p2 to pointEq(p1, p2) at compile time
console.log("p1 === p2:", p1 === p2);  // true - same values!
console.log("p1 === p3:", p1 === p3);  // false

// clonePoint(value): Point - deep copy
const p1Copy = clonePoint(p1);
console.log("clonePoint(p1):", p1Copy);
console.log("Clone === original:", p1Copy === p1);  // true

// debugPoint(value): string - readable representation
console.log("debugPoint(p1):", debugPoint(p1));
// Output: "Point { x: 1, y: 2 }"

// Check the JS Output tab to see:
// 1. Generated functions (pointEq, clonePoint, debugPoint)
// 2. Operator rewrites (=== becomes pointEq calls)
