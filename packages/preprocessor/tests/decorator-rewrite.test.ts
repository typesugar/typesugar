/**
 * Tests for decorator-rewrite extension
 *
 * Decorators are rewritten to JSDoc comments so everything flows through
 * the single JSDoc macro path in the transformer.
 */
import { describe, it, expect } from "vitest";
import { preprocess } from "../src/preprocess.js";

describe("decorator-rewrite extension", () => {
  describe("@instance on const/let/var → /** @impl */", () => {
    it("rewrites @instance to /** @impl */ JSDoc", () => {
      const source = `@instance("Eq<Point>")
const pointEq = { equals: (a, b) => a.x === b.x && a.y === b.y };`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain("/** @impl Eq<Point> */");
      expect(result.code).toContain("const pointEq =");
      expect(result.code).not.toContain("@instance");
      expect(result.code).not.toContain("instance(");
    });

    it("rewrites @instance with export", () => {
      const source = `@instance("Show<User>")
export const userShow = { show: (u) => u.name };`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain("/** @impl Show<User> */");
      expect(result.code).toContain("export const userShow =");
      expect(result.code).not.toContain("@instance");
    });

    it("rewrites @instance with type annotation", () => {
      const source = `@instance("Ord<Point>")
const pointOrd: Ord<Point> = { compare: (a, b) => a.x - b.x };`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain("/** @impl Ord<Point> */");
      expect(result.code).toContain("const pointOrd: Ord<Point> =");
    });

    it("rewrites @instance on let", () => {
      const source = `@instance("Eq<Point>")
let pointEq = { equals: (a, b) => true };`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain("/** @impl Eq<Point> */");
      expect(result.code).toContain("let pointEq =");
    });

    it("rewrites @instance on var", () => {
      const source = `@instance("Eq<Point>")
var pointEq = { equals: (a, b) => true };`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain("/** @impl Eq<Point> */");
      expect(result.code).toContain("var pointEq =");
    });

    it("handles multiple @instance decorators", () => {
      const source = `@instance("Eq<Color>")
@instance("Show<Color>")
const colorInstances = { equals: (a, b) => true, show: (c) => c.name };`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain("/** @impl Eq<Color> */");
      expect(result.code).toContain("/** @impl Show<Color> */");
      expect(result.code).not.toContain("@instance");
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
      expect(result.code).toContain("/** @impl Eq<Point> */");
      expect(result.code).toContain("/** @impl Eq<Color> */");
    });

    it("does not modify the initializer", () => {
      const source = `@instance("Eq<Point>")
const pointEq = { equals: (a, b) => a.x === b.x && a.y === b.y };`;
      const result = preprocess(source);

      expect(result.code).toContain("{ equals: (a, b) => a.x === b.x && a.y === b.y }");
      expect(result.code).not.toContain("instance(");
    });
  });

  describe("@impl on const/let/var → /** @impl */", () => {
    it("rewrites @impl to /** @impl */ JSDoc", () => {
      const source = `@impl("Eq<Point>")
const pointEq = { equals: (a, b) => a.x === b.x };`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain("/** @impl Eq<Point> */");
      expect(result.code).not.toContain('@impl("');
    });

    it("rewrites @impl with export", () => {
      const source = `@impl("Show<User>")
export const userShow = { show: (u) => u.name };`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain("/** @impl Show<User> */");
      expect(result.code).toContain("export const userShow =");
    });
  });

  describe("@typeclass on interface → /** @typeclass */", () => {
    it("rewrites @typeclass without args", () => {
      const source = `@typeclass
interface Eq<A> {
  equals(a: A, b: A): boolean;
}`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain("/** @typeclass */");
      expect(result.code).toContain("interface Eq<A>");
      expect(result.code).not.toContain("@typeclass\n");
      expect(result.code).not.toContain('typeclass("Eq")');
    });

    it("rewrites @typeclass with args", () => {
      const source = `@typeclass({ ops: { "===": "equals" } })
interface Eq<A> {
  equals(a: A, b: A): boolean;
}`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain('/** @typeclass { ops: { "===": "equals" } } */');
      expect(result.code).not.toContain('typeclass("Eq"');
    });

    it("rewrites @typeclass with export", () => {
      const source = `@typeclass
export interface Show<A> {
  show(a: A): string;
}`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain("/** @typeclass */");
      expect(result.code).toContain("export interface Show<A>");
      expect(result.code).not.toContain('typeclass("Show")');
    });

    it("rewrites @typeclass on interface with extends", () => {
      const source = `@typeclass
interface Ord<A> extends Eq<A> {
  compare(a: A, b: A): number;
}`;
      const result = preprocess(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain("/** @typeclass */");
      expect(result.code).toContain("interface Ord<A> extends Eq<A>");
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
      expect(result.code).toContain("/** @typeclass */");
      expect(result.code).toContain('/** @typeclass { ops: { "<": "lessThan" } } */');
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
      expect(result.code).toContain("/** @typeclass */");
      expect(result.code).toContain("/** @impl Eq<Point> */");
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
  });
});
