/**
 * Tests for needsTypescriptTransformer heuristic.
 *
 * This heuristic detects typeclass-related patterns in source code to determine
 * whether a file needs the full TypeScript transformer or can use a faster
 * alternative (e.g., oxc).
 *
 * @see PEP-004 Wave 3: Oxc Detection Patterns
 */

import { describe, it, expect } from "vitest";
import { needsTypescriptTransformer, needsTs } from "../src/needs-ts-transformer.js";

describe("needsTypescriptTransformer", () => {
  describe("@op pattern detection", () => {
    it("detects @op in typeclass method JSDoc", () => {
      const source = `
        /** @typeclass */
        interface Numeric<A> {
          /** @op + */
          add(a: A, b: A): A;
        }
      `;
      const result = needsTypescriptTransformer(source);
      expect(result.needsTs).toBe(true);
      expect(result.patterns.some((p) => p.type === "@op")).toBe(true);
    });

    it("detects multiple @op annotations", () => {
      const source = `
        /** @typeclass */
        interface Numeric<A> {
          /** @op + */
          add(a: A, b: A): A;
          /** @op - */
          sub(a: A, b: A): A;
          /** @op * */
          mul(a: A, b: A): A;
        }
      `;
      const result = needsTypescriptTransformer(source);
      expect(result.needsTs).toBe(true);
      const opPatterns = result.patterns.filter((p) => p.type === "@op");
      expect(opPatterns.length).toBe(3);
    });

    it("detects @op with comparison operators", () => {
      const source = `
        /** @typeclass */
        interface Eq<A> {
          /** @op === */
          equals(a: A, b: A): boolean;
          /** @op !== */
          notEquals(a: A, b: A): boolean;
        }
      `;
      const result = needsTypescriptTransformer(source);
      expect(result.needsTs).toBe(true);
      expect(result.patterns.filter((p) => p.type === "@op").length).toBe(2);
    });

    it("detects @op with multiple operators on one method", () => {
      const source = `
        /** @typeclass */
        interface Ord<A> {
          /** @op < @op <= @op > @op >= */
          compare(a: A, b: A): -1 | 0 | 1;
        }
      `;
      const result = needsTypescriptTransformer(source);
      expect(result.needsTs).toBe(true);
      expect(result.patterns.some((p) => p.type === "@op")).toBe(true);
    });
  });

  describe("@impl pattern detection", () => {
    it("detects @impl for typeclass instance", () => {
      const source = `
        /** @impl Eq<Point> */
        const eqPoint: Eq<Point> = {
          equals: (a, b) => a.x === b.x && a.y === b.y,
        };
      `;
      const result = needsTypescriptTransformer(source);
      expect(result.needsTs).toBe(true);
      expect(result.patterns.some((p) => p.type === "@impl")).toBe(true);
    });

    it("detects @impl with generic type arguments", () => {
      const source = `
        /** @impl Functor<Array> */
        const arrayFunctor: Functor<Array<any>> = {
          map: (fa, f) => fa.map(f),
        };
      `;
      const result = needsTypescriptTransformer(source);
      expect(result.needsTs).toBe(true);
      expect(result.patterns.some((p) => p.type === "@impl")).toBe(true);
    });
  });

  describe("@impl auto-specialization", () => {
    it("@impl instances are auto-specialized (no @specialize needed)", () => {
      const source = `
        /** @impl Numeric<Point> */
        const numericPoint: Numeric<Point> = {
          add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
        };
      `;
      const result = needsTypescriptTransformer(source);
      expect(result.needsTs).toBe(true);
      expect(result.patterns.some((p) => p.type === "@impl")).toBe(true);
    });
  });

  describe("@typeclass pattern detection", () => {
    it("detects @typeclass annotation", () => {
      const source = `
        /** @typeclass */
        interface Semigroup<A> {
          combine(a: A, b: A): A;
        }
      `;
      const result = needsTypescriptTransformer(source);
      expect(result.needsTs).toBe(true);
      expect(result.patterns.some((p) => p.type === "@typeclass")).toBe(true);
    });

    it("detects @typeclass with description", () => {
      const source = `
        /**
         * A semigroup defines an associative binary operation.
         * @typeclass
         */
        interface Semigroup<A> {
          combine(a: A, b: A): A;
        }
      `;
      const result = needsTypescriptTransformer(source);
      expect(result.needsTs).toBe(true);
      expect(result.patterns.some((p) => p.type === "@typeclass")).toBe(true);
    });
  });

  describe("@deriving pattern detection", () => {
    it("detects @deriving annotation", () => {
      const source = `
        /** @deriving Eq, Ord, Show */
        class Point {
          constructor(public x: number, public y: number) {}
        }
      `;
      const result = needsTypescriptTransformer(source);
      expect(result.needsTs).toBe(true);
      expect(result.patterns.some((p) => p.type === "@deriving")).toBe(true);
    });

    it("detects @deriving with single typeclass", () => {
      const source = `
        /** @deriving Eq */
        interface User {
          id: string;
          name: string;
        }
      `;
      const result = needsTypescriptTransformer(source);
      expect(result.needsTs).toBe(true);
      expect(result.patterns.some((p) => p.type === "@deriving")).toBe(true);
    });
  });

  describe("negative cases", () => {
    it("returns false for plain TypeScript", () => {
      const source = `
        interface Point {
          x: number;
          y: number;
        }

        function add(a: Point, b: Point): Point {
          return { x: a.x + b.x, y: a.y + b.y };
        }

        const p1: Point = { x: 1, y: 2 };
        const p2: Point = { x: 3, y: 4 };
        const sum = add(p1, p2);
      `;
      const result = needsTypescriptTransformer(source);
      expect(result.needsTs).toBe(false);
      expect(result.patterns).toHaveLength(0);
    });

    it("does not match @op in regular comments", () => {
      const source = `
        // @op + is used for addition
        const x = 1 + 2;
      `;
      const result = needsTypescriptTransformer(source);
      expect(result.needsTs).toBe(false);
    });

    it("does not match @impl in strings", () => {
      const source = `
        const docs = "Use @impl to define instances";
      `;
      const result = needsTypescriptTransformer(source);
      expect(result.needsTs).toBe(false);
    });

    it("returns false for empty source", () => {
      const result = needsTypescriptTransformer("");
      expect(result.needsTs).toBe(false);
      expect(result.patterns).toHaveLength(0);
    });
  });

  describe("line number tracking", () => {
    it("reports correct line numbers", () => {
      const source = `// Line 1
// Line 2
/** @typeclass */
interface Eq<A> {
  /** @op === */
  equals(a: A, b: A): boolean;
}`;
      const result = needsTypescriptTransformer(source);
      expect(result.needsTs).toBe(true);

      const typeclassPattern = result.patterns.find((p) => p.type === "@typeclass");
      expect(typeclassPattern?.line).toBe(3);

      const opPattern = result.patterns.find((p) => p.type === "@op");
      expect(opPattern?.line).toBe(5);
    });
  });

  describe("needsTs fast path", () => {
    it("returns true for files with typeclass patterns", () => {
      const source = `/** @typeclass */ interface Eq<A> {}`;
      expect(needsTs(source)).toBe(true);
    });

    it("returns false for plain TypeScript", () => {
      const source = `const x = 1 + 2;`;
      expect(needsTs(source)).toBe(false);
    });
  });

  describe("real-world examples", () => {
    it("detects patterns in comprehensive typeclass file", () => {
      const source = `
        /**
         * Numeric typeclass for arithmetic operations.
         * @typeclass
         */
        interface Numeric<A> {
          /** @op + */
          add(a: A, b: A): A;
          /** @op - */
          sub(a: A, b: A): A;
          /** @op * */
          mul(a: A, b: A): A;
        }

        interface Point {
          x: number;
          y: number;
        }

        /** @impl Numeric<Point> */
        const numericPoint: Numeric<Point> = {
          add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
          sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
          mul: (a, b) => ({ x: a.x * b.x, y: a.y * b.y }),
        };

        // Usage - auto-specialization happens for all @impl instances
        const p1: Point = { x: 1, y: 2 };
        const p2: Point = { x: 3, y: 4 };
        const sum = p1 + p2; // Rewritten to numericPoint.add(p1, p2)
      `;
      const result = needsTypescriptTransformer(source);
      expect(result.needsTs).toBe(true);
      expect(result.patterns.some((p) => p.type === "@typeclass")).toBe(true);
      expect(result.patterns.filter((p) => p.type === "@op").length).toBe(3);
      expect(result.patterns.some((p) => p.type === "@impl")).toBe(true);
    });

    it("handles mixed typeclass and non-typeclass code", () => {
      const source = `
        import { something } from "external";

        /** @typeclass */
        interface Show<A> {
          show(a: A): string;
        }

        // Regular class with no typeclass annotations
        class RegularClass {
          private value: number;

          constructor(value: number) {
            this.value = value;
          }

          getValue(): number {
            return this.value;
          }
        }

        /** @impl Show<RegularClass> */
        const showRegular: Show<RegularClass> = {
          show: (a) => \`RegularClass(\${a.getValue()})\`,
        };
      `;
      const result = needsTypescriptTransformer(source);
      expect(result.needsTs).toBe(true);
      expect(result.patterns.some((p) => p.type === "@typeclass")).toBe(true);
      expect(result.patterns.some((p) => p.type === "@impl")).toBe(true);
    });
  });
});
