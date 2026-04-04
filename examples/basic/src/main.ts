/**
 * typesugar Basic Example
 *
 * Demonstrates core macro features:
 * - comptime() for compile-time evaluation
 * - @derive() for auto-generated implementations
 * - Tagged template macros (sql, regex, html)
 * - Operator overloading with @op on typeclass methods
 * - Reflection with typeInfo() and fieldNames()
 */

// Import from the typesugar umbrella package
// Callable macros are exported directly, namespaces also available
import {
  comptime,
  pipe,
  tailrec,
  Eq, Clone, Debug, Hash,
} from "typesugar";
import { match } from "@typesugar/std";

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
/** @derive(Eq, Clone, Debug, Hash) */
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

// Define a typeclass with @op annotations. The transformer rewrites
// a + b to addableVector2D.add(a, b) — no ops() wrapper needed.
/** @typeclass */
interface Addable<A> {
  /** @op + */
  add(a: A, b: A): A;
  /** @op - */
  sub(a: A, b: A): A;
  /** @op * */
  scale(a: A, factor: number): A;
}

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

/** @impl Addable<Vector2D> */
const addableVector2D: Addable<Vector2D> = {
  add: (a, b) => new Vector2D(a.x + b.x, a.y + b.y),
  sub: (a, b) => new Vector2D(a.x - b.x, a.y - b.y),
  scale: (a, f) => new Vector2D(a.x * f, a.y * f),
};

const a = new Vector2D(1, 2);
const b = new Vector2D(3, 4);

// Operators work globally — a + b becomes addableVector2D.add(a, b)
const sum = a + b;
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

// ============================================================================
// 6. Tail Recursion with @tailrec + match
// ============================================================================

function distanceSquared(a: Vector2D, b: Vector2D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

// @tailrec optimizes tail-recursive calls into while loops (like Scala)
function closestPoint(q: Vector2D, points: Vector2D[]): Vector2D | null {
  @tailrec
  function go(pts: Vector2D[], best: Vector2D | null): Vector2D | null {
    return match(pts)
      .case([]).then(best)
      .case([p, ...rest]).then(() => {
        const dist1 = distanceSquared(p, q);
        const dist2 = best ? distanceSquared(best, q) : Infinity;
        return dist1 < dist2 ? go(rest, p) : go(rest, best);
      });
  }
  return go(points, null);
}
