//! Complex & Rational Math
//! Numeric typeclasses with operator overloading on custom types

import { operators, ops, comptime, staticAssert } from "typesugar";

// @typesugar/math provides Numeric instances for Complex, Rational, etc.
// Here we show ops() rewriting +, *, == to method calls — zero cost.

@operators({ "+": "add", "*": "mul", "==": "equals" })
class Complex {
  constructor(public re: number, public im: number) {}
  add(other: Complex): Complex {
    return new Complex(this.re + other.re, this.im + other.im);
  }
  mul(other: Complex): Complex {
    return new Complex(
      this.re * other.re - this.im * other.im,
      this.re * other.im + this.im * other.re,
    );
  }
  magnitude(): number { return Math.sqrt(this.re ** 2 + this.im ** 2); }
  equals(other: Complex): boolean {
    return this.re === other.re && this.im === other.im;
  }
  toString(): string {
    return this.im >= 0 ? `${this.re}+${this.im}i` : `${this.re}${this.im}i`;
  }
}

const a = new Complex(3, 4);
const b = new Complex(1, -2);

// 👀 Check JS Output — ops() rewrites + and * to .add() and .mul()
const sum = ops(a + b);
const product = ops(a * b);

console.log(`${a} + ${b} = ${sum}`);
console.log(`${a} * ${b} = ${product}`);
console.log(`|${a}| = ${a.magnitude()}`);  // 5
console.log(`a == a?`, ops(a == a));        // true

const PI = comptime(() => Math.PI);
staticAssert(typeof PI === "number");

// Try: add a "conjugate" method and compute a * conjugate(a) = |a|²
