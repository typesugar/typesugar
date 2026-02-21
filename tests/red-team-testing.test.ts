/**
 * Red Team Tests for @typesugar/testing
 *
 * Attack surfaces:
 * - assert() with complex/pathological expressions
 * - Type-level assertion edge cases (Equal, Extends, Not)
 * - forAll property testing with edge case generators
 * - assertType runtime validation edge cases
 * - typeAssert with conditional types and special types
 */
import { describe, it, expect } from "vitest";
import {
  assert,
  typeAssert,
  assertType,
  forAll,
  type Equal,
  type Extends,
  type Not,
  type IsNever,
  type IsAny,
  type IsUnknown,
  type TypeInfo,
} from "@typesugar/testing";

describe("Testing Utils Edge Cases", () => {
  // ==========================================================================
  // Attack 1: assert() with Complex Expressions
  // ==========================================================================
  describe("assert() with complex expressions", () => {
    it("handles deeply nested property access", () => {
      const obj = { a: { b: { c: { d: { e: 42 } } } } };
      assert(obj.a.b.c.d.e === 42);
    });

    it("handles expressions with method calls", () => {
      const arr = [1, 2, 3, 4, 5];
      assert(arr.filter((x) => x > 2).map((x) => x * 2).length === 3);
    });

    it("handles expressions with nullish coalescing", () => {
      const maybeNull: string | null = null;
      const maybeUndefined: string | undefined = undefined;
      assert((maybeNull ?? "default") === "default");
      assert((maybeUndefined ?? "fallback") === "fallback");
    });

    it("handles expressions with optional chaining", () => {
      const obj: { nested?: { value?: number } } = {};
      assert(obj.nested?.value === undefined);
      assert((obj.nested?.value ?? 0) === 0);
    });

    it("handles expressions with template literals", () => {
      const name = "world";
      assert(`hello ${name}` === "hello world");
    });

    it("handles expressions with spread operators", () => {
      const arr1 = [1, 2];
      const arr2 = [3, 4];
      assert([...arr1, ...arr2].length === 4);
    });

    it("handles short-circuit evaluation", () => {
      let sideEffect = false;
      const result =
        false &&
        (() => {
          sideEffect = true;
          return true;
        })();
      assert(result === false);
      assert(sideEffect === false);
    });
  });

  // ==========================================================================
  // Attack 2: Type-Level Assertion Edge Cases
  // ==========================================================================
  describe("typeAssert with special types", () => {
    it("handles never type", () => {
      typeAssert<IsNever<never>>();
      typeAssert<Not<IsNever<unknown>>>();
      typeAssert<Not<IsNever<void>>>();
    });

    it("handles any type", () => {
      typeAssert<IsAny<any>>();
      typeAssert<Not<IsAny<unknown>>>();
      typeAssert<Not<IsAny<never>>>();
    });

    it("handles unknown type", () => {
      typeAssert<IsUnknown<unknown>>();
      typeAssert<Not<IsUnknown<any>>>();
      typeAssert<Not<IsUnknown<never>>>();
    });

    it("handles union types", () => {
      typeAssert<Equal<string | number, number | string>>();
      typeAssert<Extends<"a" | "b", string>>();
      typeAssert<Not<Equal<string | number, string>>>();
    });

    it("handles intersection types", () => {
      type A = { a: number };
      type B = { b: string };
      typeAssert<Extends<A & B, A>>();
      typeAssert<Extends<A & B, B>>();
    });

    it("handles conditional types", () => {
      type IsString<T> = T extends string ? true : false;
      typeAssert<Equal<IsString<string>, true>>();
      typeAssert<Equal<IsString<number>, false>>();
    });

    it("handles mapped types", () => {
      type Partial<T> = { [K in keyof T]?: T[K] };
      type Original = { a: number; b: string };
      type PartialOriginal = Partial<Original>;
      typeAssert<Extends<Original, PartialOriginal>>();
    });

    it("handles tuple types", () => {
      typeAssert<Equal<[number, string], [number, string]>>();
      typeAssert<Not<Equal<[number, string], [string, number]>>>();
      typeAssert<Extends<[1, 2], number[]>>();
    });

    it("handles function types", () => {
      type Fn1 = (x: number) => string;
      type Fn2 = (x: number) => string;
      typeAssert<Equal<Fn1, Fn2>>();

      type FnAny = (x: any) => any;
      typeAssert<Extends<Fn1, FnAny>>();
    });
  });

  // ==========================================================================
  // Attack 3: Equal vs Extends Semantics
  // ==========================================================================
  describe("Equal vs Extends semantic differences", () => {
    it("Equal requires exact match, Extends allows subtyping", () => {
      typeAssert<Extends<"hello", string>>();
      typeAssert<Not<Equal<"hello", string>>>();
    });

    it("Equal is symmetric, Extends is not", () => {
      typeAssert<Extends<never, string>>();
      typeAssert<Not<Extends<string, never>>>();
    });

    it("handles distributive conditional behavior", () => {
      type Distribute<T> = T extends any ? [T] : never;
      typeAssert<Equal<Distribute<string | number>, [string] | [number]>>();
    });

    it("handles readonly vs mutable", () => {
      type Mutable = { x: number };
      type ReadonlyType = { readonly x: number };
      typeAssert<Extends<ReadonlyType, Mutable>>();
      typeAssert<Extends<Mutable, ReadonlyType>>();
      typeAssert<Not<Equal<Mutable, ReadonlyType>>>();
    });

    it("handles optional vs required", () => {
      type WithOptional = { x?: number };
      type WithRequired = { x: number };
      typeAssert<Extends<WithRequired, WithOptional>>();
      typeAssert<Not<Extends<WithOptional, WithRequired>>>();
    });
  });

  // ==========================================================================
  // Attack 4: forAll Property Testing Edge Cases
  // ==========================================================================
  describe("forAll with edge case generators", () => {
    it("handles generator returning special numeric values", () => {
      const specialNumbers = (seed: number): number => {
        const specials = [0, -0, NaN, Infinity, -Infinity, Number.MAX_VALUE, Number.MIN_VALUE];
        return specials[seed % specials.length]!;
      };

      let count = 0;
      forAll(specialNumbers, 7, (n) => {
        count++;
        expect(typeof n).toBe("number");
      });
      expect(count).toBe(7);
    });

    it("handles generator returning empty objects", () => {
      const emptyGenerator = (_seed: number) => ({});

      forAll(emptyGenerator, 5, (obj) => {
        expect(Object.keys(obj).length).toBe(0);
      });
    });

    it("handles generator with deterministic seed", () => {
      const seededGenerator = (seed: number) => ({
        value: seed * 2,
        label: `item-${seed}`,
      });

      const results: number[] = [];
      forAll(seededGenerator, 10, (item) => {
        results.push(item.value);
      });

      expect(results).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
    });

    it("reports failing input on property violation", () => {
      const generator = (seed: number) => seed;

      expect(() => {
        forAll(generator, 10, (n) => {
          if (n >= 5) {
            throw new Error("Value too large");
          }
        });
      }).toThrow(/Property failed after 6 tests/);
    });

    it("handles zero iterations", () => {
      let called = false;
      const generator = (_seed: number) => {
        called = true;
        return 42;
      };

      forAll(generator, 0, () => {
        throw new Error("Should not be called");
      });

      expect(called).toBe(false);
    });

    it("handles generator returning null/undefined", () => {
      const nullGenerator = (seed: number): null | undefined => (seed % 2 === 0 ? null : undefined);

      let nullCount = 0;
      let undefinedCount = 0;
      forAll(nullGenerator, 10, (val) => {
        if (val === null) nullCount++;
        if (val === undefined) undefinedCount++;
      });

      expect(nullCount).toBe(5);
      expect(undefinedCount).toBe(5);
    });
  });

  // ==========================================================================
  // Attack 5: assertType Runtime Validation Edge Cases
  // ==========================================================================
  describe("assertType runtime validation", () => {
    it("throws on null input", () => {
      expect(() => {
        assertType<{ x: number }>(null);
      }).toThrow(/expected object, got null/);
    });

    it("throws on undefined input", () => {
      expect(() => {
        assertType<{ x: number }>(undefined);
      }).toThrow(/expected object, got undefined/);
    });

    it("throws on primitive input", () => {
      expect(() => {
        assertType<{ x: number }>(42);
      }).toThrow(/expected object, got number/);

      expect(() => {
        assertType<{ x: number }>("string");
      }).toThrow(/expected object, got string/);

      expect(() => {
        assertType<{ x: number }>(true);
      }).toThrow(/expected object, got boolean/);
    });

    it("passes for valid object", () => {
      expect(() => {
        assertType<{ x: number }>({ x: 42 });
      }).not.toThrow();
    });

    it("passes for array (which is an object)", () => {
      expect(() => {
        assertType<number[]>([1, 2, 3]);
      }).not.toThrow();
    });

    it("includes custom message in error", () => {
      expect(() => {
        assertType<{ x: number }>(null, "User validation");
      }).toThrow(/User validation.*expected object, got null/);
    });
  });

  // ==========================================================================
  // Attack 6: Not<T> Combinator Edge Cases
  // ==========================================================================
  describe("Not<T> type combinator", () => {
    it("negates true to false", () => {
      typeAssert<Equal<Not<true>, false>>();
    });

    it("negates false to true", () => {
      typeAssert<Equal<Not<false>, true>>();
    });

    it("double negation returns original", () => {
      typeAssert<Equal<Not<Not<true>>, true>>();
      typeAssert<Equal<Not<Not<false>>, false>>();
    });

    it("works with type predicates", () => {
      typeAssert<Not<IsNever<string>>>();
      typeAssert<Not<IsAny<string>>>();
      typeAssert<Not<IsUnknown<string>>>();
    });

    it("works with Equal negation", () => {
      typeAssert<Not<Equal<string, number>>>();
      typeAssert<Not<Equal<1, 2>>>();
    });

    it("works with Extends negation", () => {
      typeAssert<Not<Extends<string, number>>>();
      typeAssert<Not<Extends<{ a: 1 }, { b: 2 }>>>();
    });
  });

  // ==========================================================================
  // Attack 7: Edge Cases in Type Equality
  // ==========================================================================
  describe("type equality edge cases", () => {
    it("distinguishes object from Record", () => {
      typeAssert<Extends<{}, object>>();
      typeAssert<Extends<{ a: 1 }, object>>();
    });

    it("handles index signatures", () => {
      type WithIndex = { [key: string]: number };
      type WithoutIndex = { a: number };
      typeAssert<Extends<WithoutIndex, WithIndex>>();
      typeAssert<Not<Equal<WithIndex, WithoutIndex>>>();
    });

    it("handles branded types", () => {
      type UserId = string & { readonly __brand: "UserId" };
      type PostId = string & { readonly __brand: "PostId" };
      typeAssert<Extends<UserId, string>>();
      typeAssert<Extends<PostId, string>>();
      typeAssert<Not<Equal<UserId, PostId>>>();
    });

    it("handles recursive types", () => {
      type TreeNode = { value: number; children: TreeNode[] };
      type TreeNode2 = { value: number; children: TreeNode2[] };
      typeAssert<Equal<TreeNode, TreeNode2>>();
    });

    it("handles void and undefined", () => {
      typeAssert<Extends<undefined, void>>();
      typeAssert<Not<Equal<void, undefined>>>();
    });

    it("handles null vs undefined", () => {
      typeAssert<Not<Equal<null, undefined>>>();
      typeAssert<Not<Extends<null, undefined>>>();
      typeAssert<Not<Extends<undefined, null>>>();
    });
  });
});
