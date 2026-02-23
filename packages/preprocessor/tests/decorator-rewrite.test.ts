/**
 * Tests for decorator-rewrite extension
 */
import { describe, it, expect } from "vitest";
import { preprocess } from "../src/preprocess.js";

describe("decorator-rewrite extension", () => {
  describe("@instance on const/let/var", () => {
    it("rewrites @instance on const with object literal", () => {
      const source = `@instance("Eq<Point>")
const pointEq = { equals: (a, b) => a.x === b.x && a.y === b.y };`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain('instance("Eq<Point>",');
      expect(result.code).toContain("equals:");
      expect(result.code).not.toContain("@instance");
    });

    it("rewrites @instance with export", () => {
      const source = `@instance("Show<User>")
export const userShow = { show: (u) => u.name };`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain("export const userShow =");
      expect(result.code).toContain('instance("Show<User>",');
      expect(result.code).not.toContain("@instance");
    });

    it("rewrites @instance with type annotation", () => {
      const source = `@instance("Ord<Point>")
const pointOrd: Ord<Point> = { compare: (a, b) => a.x - b.x };`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain("const pointOrd: Ord<Point> =");
      expect(result.code).toContain('instance("Ord<Point>",');
    });

    it("rewrites @instance on let", () => {
      const source = `@instance("Eq<Point>")
let pointEq = { equals: (a, b) => true };`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain("let pointEq =");
      expect(result.code).toContain('instance("Eq<Point>",');
    });

    it("rewrites @instance on var", () => {
      const source = `@instance("Eq<Point>")
var pointEq = { equals: (a, b) => true };`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain("var pointEq =");
      expect(result.code).toContain('instance("Eq<Point>",');
    });

    it("handles multiple @instance decorators by nesting", () => {
      const source = `@instance("Eq<Color>")
@instance("Show<Color>")
const colorInstances = { equals: (a, b) => true, show: (c) => c.name };`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain('instance("Eq<Color>", instance("Show<Color>",');
      expect(result.code).not.toContain("@instance");
    });

    it("handles multi-line object literal initializer", () => {
      const source = `@instance("Eq<Point>")
const pointEq = {
  equals: (a: Point, b: Point): boolean => {
    return a.x === b.x && a.y === b.y;
  }
};`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain('instance("Eq<Point>",');
      expect(result.code).toContain("equals:");
      expect(result.code).toContain("return a.x === b.x && a.y === b.y;");
    });

    it("handles function call initializer", () => {
      const source = `@instance("Eq<Point>")
const pointEq = createEqInstance<Point>();`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain('instance("Eq<Point>", createEqInstance<Point>())');
    });

    it("handles arrow function initializer", () => {
      const source = `@instance("Functor<Array>")
const arrayFunctor = { map: (fa, f) => fa.map(f) };`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain('instance("Functor<Array>",');
    });

    it("preserves code after the declaration", () => {
      const source = `@instance("Eq<Point>")
const pointEq = { equals: (a, b) => true };

console.log(pointEq);`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain("console.log(pointEq);");
    });

    it("handles multiple declarations in sequence", () => {
      const source = `@instance("Eq<Point>")
const pointEq = { equals: () => true };

@instance("Eq<Color>")
const colorEq = { equals: () => false };`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain('instance("Eq<Point>",');
      expect(result.code).toContain('instance("Eq<Color>",');
    });
  });

  describe("@typeclass on interface", () => {
    it("rewrites @typeclass on interface without args", () => {
      const source = `@typeclass
interface Eq<A> {
  equals(a: A, b: A): boolean;
}`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).not.toContain("@typeclass");
      expect(result.code).toContain("interface Eq<A>");
      expect(result.code).toContain('typeclass("Eq");');
    });

    it("rewrites @typeclass with args", () => {
      const source = `@typeclass({ ops: { "===": "equals" } })
interface Eq<A> {
  equals(a: A, b: A): boolean;
}`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).not.toContain("@typeclass");
      expect(result.code).toContain('typeclass("Eq", { ops: { "===": "equals" } });');
    });

    it("rewrites @typeclass with export", () => {
      const source = `@typeclass
export interface Show<A> {
  show(a: A): string;
}`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).not.toContain("@typeclass");
      expect(result.code).toContain("export interface Show<A>");
      expect(result.code).toContain('typeclass("Show");');
    });

    it("rewrites @typeclass on interface with extends", () => {
      const source = `@typeclass
interface Ord<A> extends Eq<A> {
  compare(a: A, b: A): number;
}`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).not.toContain("@typeclass");
      expect(result.code).toContain("interface Ord<A> extends Eq<A>");
      expect(result.code).toContain('typeclass("Ord");');
    });

    it("rewrites @typeclass on interface with multiple type params", () => {
      const source = `@typeclass
interface Bifunctor<F> {
  bimap<A, B, C, D>(fa: F, f: (a: A) => B, g: (c: C) => D): F;
}`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain('typeclass("Bifunctor");');
    });

    it("handles multi-line interface body", () => {
      const source = `@typeclass({ ops: { "+": "concat" } })
interface Semigroup<A> {
  concat(a: A, b: A): A;
  
  // Helper method
  combineAll(as: A[]): A;
}`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain("concat(a: A, b: A): A;");
      expect(result.code).toContain("combineAll(as: A[]): A;");
      expect(result.code).toContain('typeclass("Semigroup", { ops: { "+": "concat" } });');
    });

    it("preserves code after the interface", () => {
      const source = `@typeclass
interface Eq<A> {
  equals(a: A, b: A): boolean;
}

const x = 42;`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain("const x = 42;");
    });

    it("handles multiple interfaces in sequence", () => {
      const source = `@typeclass
interface Eq<A> {
  equals(a: A, b: A): boolean;
}

@typeclass({ ops: { "<": "lessThan" } })
interface Ord<A> extends Eq<A> {
  compare(a: A, b: A): number;
}`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain('typeclass("Eq");');
      expect(result.code).toContain('typeclass("Ord", { ops: { "<": "lessThan" } });');
    });
  });

  describe("mixed decorators", () => {
    it("handles @typeclass and @instance in same file", () => {
      const source = `@typeclass
interface Eq<A> {
  equals(a: A, b: A): boolean;
}

@instance("Eq<Point>")
const pointEq = { equals: (a, b) => a.x === b.x };`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain('typeclass("Eq");');
      expect(result.code).toContain('instance("Eq<Point>",');
    });
  });

  describe("edge cases", () => {
    it("does not transform regular @ in strings", () => {
      const source = `const email = "user@example.com";`;
      const result = preprocess(source);

      expect(result.code).toContain("user@example.com");
    });

    it("does not transform other decorators", () => {
      const source = `@deprecated
const oldFn = () => {};`;
      const result = preprocess(source);

      expect(result.code).toContain("@deprecated");
    });

    it("handles nested braces in initializer", () => {
      const source = `@instance("Eq<Config>")
const configEq = { equals: (a, b) => { const x = { y: 1 }; return a.id === b.id; } };`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain('instance("Eq<Config>",');
      expect(result.code).toContain("const x = { y: 1 }");
    });

    it("handles nested parens in initializer", () => {
      const source = `@instance("Eq<Point>")
const pointEq = createEq((a, b) => (a.x === b.x) && (a.y === b.y));`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain('instance("Eq<Point>", createEq((a, b) => (a.x === b.x) && (a.y === b.y)))');
    });
  });
});
