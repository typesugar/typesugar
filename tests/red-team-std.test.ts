/**
 * Red Team Tests for @typesugar/std (match macro, P helpers)
 *
 * Attack surfaces:
 * - Wildcard pattern (_) edge cases
 * - Symbol discriminants
 * - Very large unions
 * - Chained/nested match expressions
 * - P helper edge cases
 * - match returning functions
 * - Recursive types
 * (Extends red-team-macros.test.ts coverage)
 */
import { describe, it, expect } from "vitest";
import { match, when, otherwise, isType, P } from "../packages/std/src/macros/match.js";

describe("Match Wildcard Pattern Edge Cases", () => {
  // ==========================================================================
  // Attack 1: Wildcard Pattern Ordering
  // ==========================================================================
  describe("Wildcard pattern ordering", () => {
    it("Wildcard _ catches remaining cases", () => {
      type ABC = "a" | "b" | "c";
      const val: ABC = "c";

      const result = match(val, {
        a: () => "matched a",
        b: () => "matched b",
        _: () => "wildcard",
      });

      expect(result).toBe("wildcard");
    });

    it("Wildcard after all explicit cases is dead code", () => {
      type ABC = "a" | "b";
      const val: ABC = "b";

      const result = match(val, {
        a: () => "a",
        b: () => "b",
        _: () => "never reached", // Dead code - all cases covered
      });

      expect(result).toBe("b");
    });

    it("Wildcard with OR patterns", () => {
      type ABCD = "a" | "b" | "c" | "d";
      const val: ABCD = "d";

      const result = match(val, {
        "a|b": () => "a or b",
        c: () => "c",
        _: () => "other",
      });

      expect(result).toBe("other");
    });

    it("Underscore in discriminant value (not wildcard)", () => {
      type WithUnderscore =
        | { type: "_"; value: 1 }
        | { type: "__"; value: 2 }
        | { type: "normal"; value: 3 };

      // "_" as discriminant value should NOT be treated as wildcard
      const val: WithUnderscore = { type: "_", value: 1 };

      const result = match(val, {
        _: () => "single underscore",
        __: () => "double underscore",
        normal: () => "normal",
      });

      // AMBIGUITY: Is "_" a wildcard or a literal?
      // Current behavior: _ is treated as wildcard, so it catches all
      expect(result).toBe("single underscore");
    });
  });

  // ==========================================================================
  // Attack 2: Symbol Discriminants
  // ==========================================================================
  describe("Symbol discriminants", () => {
    it("Cannot use symbols as object keys in match handlers", () => {
      // Symbols cannot be used as discriminant values in the object syntax
      // because object keys are always strings
      const sym = Symbol("test");

      // This type CANNOT be matched with object syntax
      // type SymbolDiscriminated = { kind: typeof sym; value: number };

      // Must use when() syntax instead
      const value = { kind: sym, value: 42 };

      const result = match(value, [
        when(
          (v) => v.kind === sym,
          (v) => `symbol: ${v.value}`
        ),
        otherwise(() => "unknown"),
      ]);

      expect(result).toBe("symbol: 42");
    });
  });

  // ==========================================================================
  // Attack 3: Very Large Unions
  // ==========================================================================
  describe("Large union handling", () => {
    it("Union with many variants", () => {
      // Generate a large union at runtime using when()
      type LargeUnion =
        | { kind: "k0"; v: 0 }
        | { kind: "k1"; v: 1 }
        | { kind: "k2"; v: 2 }
        | { kind: "k3"; v: 3 }
        | { kind: "k4"; v: 4 }
        | { kind: "k5"; v: 5 }
        | { kind: "k6"; v: 6 }
        | { kind: "k7"; v: 7 }
        | { kind: "k8"; v: 8 }
        | { kind: "k9"; v: 9 };

      const val: LargeUnion = { kind: "k7", v: 7 };

      const result = match(val, {
        k0: ({ v }) => v,
        k1: ({ v }) => v,
        k2: ({ v }) => v,
        k3: ({ v }) => v,
        k4: ({ v }) => v,
        k5: ({ v }) => v,
        k6: ({ v }) => v,
        k7: ({ v }) => v,
        k8: ({ v }) => v,
        k9: ({ v }) => v,
      });

      expect(result).toBe(7);
    });

    it("Performance: match with many when() clauses", () => {
      // Test that match doesn't have O(n²) behavior
      const value = 99;
      const clauses = Array.from({ length: 100 }, (_, i) =>
        when(
          (v: number) => v === i,
          () => i
        )
      );
      clauses.push(otherwise(() => -1));

      const start = performance.now();
      const result = match(value, clauses as any);
      const elapsed = performance.now() - start;

      expect(result).toBe(99);
      expect(elapsed).toBeLessThan(100); // Should be fast
    });
  });

  // ==========================================================================
  // Attack 4: Chained Match Expressions
  // ==========================================================================
  describe("Chained match expressions", () => {
    it("match() as argument to match()", () => {
      type Outer = { kind: "a"; inner: { kind: "x" | "y" } } | { kind: "b" };

      const val: Outer = { kind: "a", inner: { kind: "x" } };

      // Nested match in expression position
      const result = match(val, {
        a: ({ inner }) =>
          match(inner, {
            x: () => "a.x",
            y: () => "a.y",
          }),
        b: () => "b",
      });

      expect(result).toBe("a.x");
    });

    it("match() result as discriminant for another match()", () => {
      type First = "yes" | "no";
      type Second = { type: "yes" | "no"; value: number };

      const first: First = "yes";
      const second: Second = { type: "no", value: 42 };

      // First match determines which property to look at
      const key = match(first, {
        yes: () => "type" as const,
        no: () => "value" as const,
      });

      // Can't easily use this dynamically...
      // The result is a string, not useful for type-safe matching
      expect(key).toBe("type");
    });

    it("match() in array.reduce()", () => {
      type Action =
        | { type: "add"; amount: number }
        | { type: "sub"; amount: number }
        | { type: "mul"; factor: number };

      const actions: Action[] = [
        { type: "add", amount: 10 },
        { type: "mul", factor: 2 },
        { type: "sub", amount: 5 },
      ];

      const result = actions.reduce(
        (acc, action) =>
          match(action, {
            add: ({ amount }) => acc + amount,
            sub: ({ amount }) => acc - amount,
            mul: ({ factor }) => acc * factor,
          }),
        0
      );

      expect(result).toBe(15); // ((0 + 10) * 2) - 5 = 15
    });
  });

  // ==========================================================================
  // Attack 5: P Helper Edge Cases
  // ==========================================================================
  describe("P helper edge cases", () => {
    it("P.allOf combining multiple predicates", () => {
      interface Person {
        age: number;
        name: string;
      }

      const people: Person[] = [
        { age: 25, name: "Alice" },
        { age: 17, name: "Bob" },
        { age: 30, name: "Charlie" },
        { age: 16, name: "Dave" },
      ];

      const adults = people.filter((p) =>
        match(p, [
          when(
            P.allOf(
              (p: Person) => p.age >= 18,
              (p: Person) => p.name.length > 0
            ),
            () => true
          ),
          otherwise(() => false),
        ])
      );

      expect(adults.map((p) => p.name)).toEqual(["Alice", "Charlie"]);
    });

    it("P.anyOf matches if any predicate matches", () => {
      const values = [1, 2, 3, 4, 5];

      const result = values.filter((v) =>
        match(v, [
          when(
            P.anyOf(
              (x: number) => x === 1,
              (x: number) => x === 5
            ),
            () => true
          ),
          otherwise(() => false),
        ])
      );

      expect(result).toEqual([1, 5]);
    });

    it("P.has for property checking", () => {
      const objects = [{ x: 1 }, { y: 2 }, { x: 3, y: 4 }, null, undefined, "string"];

      const withX = objects.filter((o) =>
        match(o, [when(P.nil, () => false), when(P.has("x"), () => true), otherwise(() => false)])
      );

      expect(withX).toEqual([{ x: 1 }, { x: 3, y: 4 }]);
    });

    it("P.oneOf matches values in a set", () => {
      const values = ["a", "b", "c", "d", "e"];

      const vowels = values.filter((v) =>
        match(v, [when(P.oneOf("a", "e", "i", "o", "u"), () => true), otherwise(() => false)])
      );

      expect(vowels).toEqual(["a", "e"]);
    });

    it("P.between matches numeric range", () => {
      const values = [1, 5, 10, 15, 20];

      const inRange = values.filter((v) =>
        match(v, [when(P.between(5, 15), () => true), otherwise(() => false)])
      );

      expect(inRange).toEqual([5, 10, 15]);
    });

    it("P.regex matches strings", () => {
      const strings = ["hello", "world", "hello world", "hi"];

      const hasHello = strings.filter((s) =>
        match(s, [when(P.regex(/^hello/), () => true), otherwise(() => false)])
      );

      expect(hasHello).toEqual(["hello", "hello world"]);
    });

    it("P.length matches exact array length", () => {
      const arrays = [[], [1], [1, 2], [1, 2, 3]];

      const pairs = arrays.filter((arr) =>
        match(arr, [when(P.length(2), () => true), otherwise(() => false)])
      );

      expect(pairs).toEqual([[1, 2]]);
    });

    it("P.minLength matches minimum array length", () => {
      const arrays = [[], [1], [1, 2], [1, 2, 3]];

      const atLeastTwo = arrays.filter((arr) =>
        match(arr, [when(P.minLength(2), () => true), otherwise(() => false)])
      );

      expect(atLeastTwo).toEqual([
        [1, 2],
        [1, 2, 3],
      ]);
    });
  });

  // ==========================================================================
  // Attack 6: Match Returning Functions
  // ==========================================================================
  describe("Match returning functions", () => {
    it("Handler returns a function", () => {
      type Op = "add" | "mul";
      const op: Op = "add";

      const fn = match(op, {
        add: () => (a: number, b: number) => a + b,
        mul: () => (a: number, b: number) => a * b,
      });

      expect(fn(3, 4)).toBe(7);
    });

    it("Handler returns async function", async () => {
      type Fetcher = "fast" | "slow";
      const type: Fetcher = "fast";

      const fetchFn = match(type, {
        fast: () => async () => "fast result",
        slow: () => async () => {
          await new Promise((r) => setTimeout(r, 10));
          return "slow result";
        },
      });

      const result = await fetchFn();
      expect(result).toBe("fast result");
    });

    it("Higher-order match (curried)", () => {
      type BinaryOp = "add" | "sub" | "mul";

      const makeOp = (op: BinaryOp) =>
        match(op, {
          add: () => (a: number) => (b: number) => a + b,
          sub: () => (a: number) => (b: number) => a - b,
          mul: () => (a: number) => (b: number) => a * b,
        });

      const add = makeOp("add");
      const add5 = add(5);

      expect(add5(3)).toBe(8);
      expect(add5(10)).toBe(15);
    });
  });

  // ==========================================================================
  // Attack 7: Recursive Types
  // ==========================================================================
  describe("Recursive type matching", () => {
    it("Match on recursive tree structure", () => {
      type Tree<T> = { kind: "leaf"; value: T } | { kind: "node"; left: Tree<T>; right: Tree<T> };

      const sumTree = (tree: Tree<number>): number =>
        match(tree, {
          leaf: ({ value }) => value,
          node: ({ left, right }) => sumTree(left) + sumTree(right),
        });

      const tree: Tree<number> = {
        kind: "node",
        left: { kind: "leaf", value: 1 },
        right: {
          kind: "node",
          left: { kind: "leaf", value: 2 },
          right: { kind: "leaf", value: 3 },
        },
      };

      expect(sumTree(tree)).toBe(6);
    });

    it("Match on linked list", () => {
      type List<T> = { kind: "nil" } | { kind: "cons"; head: T; tail: List<T> };

      const length = <T>(list: List<T>): number =>
        match(list, {
          nil: () => 0,
          cons: ({ tail }) => 1 + length(tail),
        });

      const list: List<number> = {
        kind: "cons",
        head: 1,
        tail: {
          kind: "cons",
          head: 2,
          tail: {
            kind: "cons",
            head: 3,
            tail: { kind: "nil" },
          },
        },
      };

      expect(length(list)).toBe(3);
    });

    it("Match on JSON-like structure", () => {
      type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

      const stringify = (json: Json): string =>
        match(json, [
          when(P.nil, () => "null"),
          when(isType("boolean"), (b) => String(b)),
          when(isType("number"), (n) => String(n)),
          when(isType("string"), (s) => `"${s}"`),
          when(Array.isArray, (arr) => `[${arr.map(stringify).join(",")}]`),
          when(
            (v): v is { [key: string]: Json } => typeof v === "object" && v !== null,
            (obj) =>
              `{${Object.entries(obj)
                .map(([k, v]) => `"${k}":${stringify(v)}`)
                .join(",")}}`
          ),
          otherwise(() => "unknown"),
        ]);

      expect(stringify(null)).toBe("null");
      expect(stringify(42)).toBe("42");
      expect(stringify("hello")).toBe('"hello"');
      expect(stringify([1, 2, 3])).toBe("[1,2,3]");
      expect(stringify({ a: 1, b: "x" })).toBe('{"a":1,"b":"x"}');
    });
  });

  // ==========================================================================
  // Attack 8: Edge Cases in Discriminant Detection
  // ==========================================================================
  describe("Discriminant detection edge cases", () => {
    it("Object with multiple potential discriminants", () => {
      type Ambiguous =
        | { kind: "a"; type: "x"; value: 1 }
        | { kind: "a"; type: "y"; value: 2 }
        | { kind: "b"; type: "x"; value: 3 };

      // Both "kind" and "type" could be discriminants
      // match() should pick one (probably "kind" as it comes first)
      const val: Ambiguous = { kind: "a", type: "x", value: 1 };

      // Using "kind" as discriminant
      const byKind = match(val, {
        a: (v) => `a with type ${v.type}`,
        b: (v) => `b with type ${v.type}`,
      });
      expect(byKind).toBe("a with type x");
    });

    it("Discriminant with undefined value", () => {
      type MaybeUndefined = { tag: "present"; value: string } | { tag: undefined; value: number };

      const val: MaybeUndefined = { tag: undefined, value: 42 };

      // Can we match on undefined as a discriminant value?
      const result = match(val, [
        when(
          (v) => v.tag === "present",
          (v) => `present: ${v.value}`
        ),
        when(
          (v) => v.tag === undefined,
          (v) => `undefined: ${v.value}`
        ),
        otherwise(() => "other"),
      ]);

      expect(result).toBe("undefined: 42");
    });

    it("Discriminant with null value", () => {
      type MaybeNull = { tag: "a"; value: 1 } | { tag: null; value: 2 };

      const val: MaybeNull = { tag: null, value: 2 };

      const result = match(val, [
        when(
          (v) => v.tag === "a",
          () => "a"
        ),
        when(
          (v) => v.tag === null,
          () => "null"
        ),
        otherwise(() => "other"),
      ]);

      expect(result).toBe("null");
    });
  });

  // ==========================================================================
  // Attack 9: Unicode in Discriminant Values
  // ==========================================================================
  describe("Unicode discriminant values", () => {
    it("Emoji discriminants", () => {
      type Emoji = { kind: "😀"; mood: "happy" } | { kind: "😢"; mood: "sad" };

      const val: Emoji = { kind: "😀", mood: "happy" };

      const result = match(val, {
        "😀": () => "smiling",
        "😢": () => "crying",
      });

      expect(result).toBe("smiling");
    });

    it("Non-ASCII discriminants with explicit discriminant", () => {
      type Greeting =
        | { lang: "こんにちは"; message: string }
        | { lang: "Привет"; message: string }
        | { lang: "مرحبا"; message: string };

      const val: Greeting = { lang: "こんにちは", message: "Hello" };

      // Need to explicitly specify the discriminant field "lang"
      // since it's not in the common discriminant names list
      const result = match(
        val,
        {
          こんにちは: () => "Japanese",
          Привет: () => "Russian",
          مرحبا: () => "Arabic",
        },
        "lang"
      );

      expect(result).toBe("Japanese");
    });
  });

  // ==========================================================================
  // Attack 10: Prototype Pollution Resistance
  // ==========================================================================
  describe("Prototype pollution resistance", () => {
    it("Discriminant named __proto__", () => {
      // This is a potential security issue if not handled correctly
      type Dangerous = { __proto__: "safe"; value: 1 } | { __proto__: "unsafe"; value: 2 };

      // TypeScript allows __proto__ as a property name
      // But it's problematic in JavaScript
      const val = { __proto__: "safe", value: 1 } as Dangerous;

      // This might behave unexpectedly
      const result = match(val, [
        when(
          (v) => (v as any).__proto__ === "safe",
          () => "safe"
        ),
        when(
          (v) => (v as any).__proto__ === "unsafe",
          () => "unsafe"
        ),
        otherwise(() => "unknown"),
      ]);

      // Due to __proto__ being special, accessing it returns Object.prototype
      expect(result).toBe("unknown");
    });

    it("Discriminant named constructor", () => {
      type HasConstructor = { constructor: "a" } | { constructor: "b" };

      const val: HasConstructor = { constructor: "a" };

      const result = match(val, [
        when(
          (v) => v.constructor === "a",
          () => "a"
        ),
        when(
          (v) => v.constructor === "b",
          () => "b"
        ),
        otherwise(() => "other"),
      ]);

      // constructor is a special property on objects
      expect(result).toBe("a");
    });
  });
});
