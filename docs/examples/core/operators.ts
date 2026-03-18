//! Operator Overloading
//! ops(a + b) compiles to a.add(b) — zero cost

import { operators, ops } from "typesugar";

// @operators maps standard operators to method calls.
// ops() rewrites expressions at compile time — no runtime dispatch.

@operators({ "+": "add", "-": "sub", "*": "scale", "==": "equals" })
class Vec2 {
  constructor(public x: number, public y: number) {}

  add(other: Vec2): Vec2 {
    return new Vec2(this.x + other.x, this.y + other.y);
  }

  sub(other: Vec2): Vec2 {
    return new Vec2(this.x - other.x, this.y - other.y);
  }

  scale(factor: Vec2): Vec2 {
    return new Vec2(this.x * factor.x, this.y * factor.y);
  }

  equals(other: Vec2): boolean {
    return this.x === other.x && this.y === other.y;
  }

  toString(): string {
    return `(${this.x}, ${this.y})`;
  }
}

const a = new Vec2(1, 2);
const b = new Vec2(3, 4);

// ops() rewrites operators → method calls at compile time
const sum = ops(a + b);        // → a.add(b)
const diff = ops(a - b);       // → a.sub(b)
const eq = ops(a == a);        // → a.equals(a)

console.log(`${a} + ${b} = ${sum}`);
console.log(`${a} - ${b} = ${diff}`);
console.log(`a == a? ${eq}`);

// 👀 Check JS Output — ops(a + b) becomes a.add(b), no runtime overhead
// Try: add a "neg" unary operator mapping and use ops(-a)
