/**
 * typemacro Basic Example
 *
 * Demonstrates core macro features:
 * - comptime() for compile-time evaluation
 * - @derive() for auto-generated implementations
 * - Tagged template macros (sql, regex, html)
 * - Operator overloading with @operators and ops()
 * - Reflection with typeInfo() and fieldNames()
 */

// Import from the typemacro umbrella package
// Callable macros are exported directly, namespaces also available
import {
  comptimeEval as comptime,
  ops,
  pipe,
  // Namespaces are also available:
  // comptime, derive, operators, reflect, typeclass, specialize
} from "ttfx";

// Alternatively, you can import directly from specific packages:
// import { comptime } from "@ttfx/comptime";
// import { ops, pipe, compose } from "@ttfx/operators";

// ============================================================================
// 1. Compile-Time Evaluation
// ============================================================================

// Compute factorial at compile time -- the result (120) is inlined
const factorial5 = comptime(() => {
  let result = 1;
  for (let i = 1; i <= 5; i++) result *= i;
  return result;
});

// Build a lookup table at compile time
const fibTable = comptime(() => {
  const fib = [0, 1];
  for (let i = 2; i <= 10; i++) {
    fib.push(fib[i - 1] + fib[i - 2]);
  }
  return fib;
});

console.log("Factorial of 5:", factorial5); // 120
console.log("First 11 Fibonacci numbers:", fibTable);

// ============================================================================
// 2. Derive Macros
// ============================================================================

// @derive generates functions for common operations
@derive("Eq", "Clone", "Debug", "Hash")
interface Point {
  x: number;
  y: number;
}

// After macro expansion, these functions are available:
// - pointEq(a: Point, b: Point): boolean
// - clonePoint(p: Point): Point
// - debugPoint(p: Point): string
// - hashPoint(p: Point): number

const p1: Point = { x: 1, y: 2 };
const p2: Point = { x: 1, y: 2 };
const p3: Point = { x: 3, y: 4 };

// These would work after macro expansion:
// console.log("p1 == p2:", pointEq(p1, p2));  // true
// console.log("p1 == p3:", pointEq(p1, p3));  // false
// console.log("debug p1:", debugPoint(p1));     // "Point { x: 1, y: 2 }"

// ============================================================================
// 3. Operator Overloading
// ============================================================================

@operators({ "+": "add", "-": "sub", "*": "scale" })
class Vector2D {
  constructor(
    public x: number,
    public y: number,
  ) {}

  add(other: Vector2D): Vector2D {
    return new Vector2D(this.x + other.x, this.y + other.y);
  }

  sub(other: Vector2D): Vector2D {
    return new Vector2D(this.x - other.x, this.y - other.y);
  }

  scale(factor: number): Vector2D {
    return new Vector2D(this.x * factor, this.y * factor);
  }

  toString(): string {
    return `Vector2D(${this.x}, ${this.y})`;
  }
}

const a = new Vector2D(1, 2);
const b = new Vector2D(3, 4);

// ops() transforms operators into method calls at compile time:
// ops(a + b) becomes a.add(b)
const sum = ops(a + b);
console.log("Vector sum:", sum.toString()); // Vector2D(4, 6)

// ============================================================================
// 4. Pipe
// ============================================================================

const double = (x: number) => x * 2;
const addOne = (x: number) => x + 1;
const toString = (x: number) => `Result: ${x}`;

// pipe(5, double, addOne, toString) becomes toString(addOne(double(5)))
const result = pipe(5, double, addOne, toString);
console.log(result); // "Result: 11"

// ============================================================================
// 5. Compile-Time Constants
// ============================================================================

// Use comptime to embed build metadata
const buildInfo = comptime(() => ({
  version: "1.0.0",
  builtAt: new Date().toISOString(),
  nodeVersion: process.version,
}));

console.log("Build info:", buildInfo);
