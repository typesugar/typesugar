/**
 * Operator Overloading Example
 *
 * Demonstrates compile-time operator transformation:
 * - @operators() to define operator-to-method mappings
 * - ops() to enable operator syntax
 * - pipe() and compose() for function composition
 */

import { operators, ops, pipe, compose } from "@ttfx/operators";

console.log("=== Operator Overloading Example ===\n");

// --- Define a class with operators ---

@operators({
  "+": "add",
  "-": "subtract",
  "*": "multiply",
  "/": "divide",
  "==": "equals",
  "<": "lessThan",
  ">": "greaterThan",
})
class Vector {
  constructor(
    public x: number,
    public y: number,
  ) {}

  add(other: Vector): Vector {
    return new Vector(this.x + other.x, this.y + other.y);
  }

  subtract(other: Vector): Vector {
    return new Vector(this.x - other.x, this.y - other.y);
  }

  multiply(scalar: number): Vector {
    return new Vector(this.x * scalar, this.y * scalar);
  }

  divide(scalar: number): Vector {
    return new Vector(this.x / scalar, this.y / scalar);
  }

  equals(other: Vector): boolean {
    return this.x === other.x && this.y === other.y;
  }

  lessThan(other: Vector): boolean {
    return this.magnitude() < other.magnitude();
  }

  greaterThan(other: Vector): boolean {
    return this.magnitude() > other.magnitude();
  }

  magnitude(): number {
    return Math.sqrt(this.x ** 2 + this.y ** 2);
  }

  toString(): string {
    return `Vector(${this.x}, ${this.y})`;
  }
}

// --- Using ops() for operator syntax ---

console.log("--- Vector Operations with ops() ---");

const v1 = new Vector(1, 2);
const v2 = new Vector(3, 4);

// ops() transforms operators to method calls at compile time
const sum = ops(() => v1 + v2);
console.log(`${v1} + ${v2} = ${sum}`);

const diff = ops(() => v2 - v1);
console.log(`${v2} - ${v1} = ${diff}`);

const scaled = ops(() => v1 * 3);
console.log(`${v1} * 3 = ${scaled}`);

const halved = ops(() => v2 / 2);
console.log(`${v2} / 2 = ${halved}`);

// --- Comparisons ---

console.log("\n--- Comparisons ---");

const small = new Vector(1, 1);
const large = new Vector(10, 10);

console.log(
  `${small} == ${small}:`,
  ops(() => small == small),
);
console.log(
  `${small} == ${large}:`,
  ops(() => small == large),
);
console.log(
  `${small} < ${large}:`,
  ops(() => small < large),
);
console.log(
  `${large} > ${small}:`,
  ops(() => large > small),
);

// --- Complex Expressions ---

console.log("\n--- Complex Expressions ---");

const result = ops(() => (v1 + v2) * 2 - v1);
console.log(`(${v1} + ${v2}) * 2 - ${v1} = ${result}`);

// --- pipe() for data transformation ---

console.log("\n--- pipe() ---");

const transformed = pipe(
  5,
  (x) => x * 2, // 10
  (x) => x + 3, // 13
  (x) => x.toString(), // "13"
  (s) => `Result: ${s}`, // "Result: 13"
);

console.log(transformed);

// --- compose() for function composition ---

console.log("\n--- compose() ---");

const double = (x: number) => x * 2;
const addTen = (x: number) => x + 10;
const stringify = (x: number) => `Value: ${x}`;

// compose creates a new function
const process = compose(double, addTen, stringify);

console.log("compose(double, addTen, stringify)(5):", process(5));
// 5 -> double(5) = 10 -> addTen(10) = 20 -> stringify(20) = "Value: 20"

// --- Point-free style with compose ---

console.log("\n--- Point-Free Style ---");

const processNumbers = compose(
  (nums: number[]) => nums.filter((n) => n > 0),
  (nums: number[]) => nums.map((n) => n * 2),
  (nums: number[]) => nums.reduce((a, b) => a + b, 0),
);

const numbers = [-1, 2, -3, 4, 5];
console.log("Input:", numbers);
console.log("After filter > 0, map * 2, sum:", processNumbers(numbers));
