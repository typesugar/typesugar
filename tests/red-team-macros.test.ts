/**
 * Red Team Tests for Macros (match, specialize)
 *
 * Attack surfaces:
 * - match() exhaustiveness checking
 * - match() with unusual discriminant values
 * - specialize() inlining edge cases
 */
import { describe, it, expect } from "vitest";
import { match, when, otherwise, isType, P } from "../packages/std/src/macros/match.js";

describe("Match Macro Edge Cases", () => {
  // ==========================================================================
  // Attack 1: Exhaustiveness with unusual discriminant values
  // ==========================================================================
  describe("Exhaustiveness edge cases", () => {
    it("Discriminant with empty string", () => {
      type Event =
        | { kind: ""; payload: null } // empty string discriminant
        | { kind: "click"; x: number }
        | { kind: "keydown"; key: string };

      const event: Event = { kind: "", payload: null };

      // Can match() handle empty string as a discriminant value?
      const result = match(event, {
        "": () => "empty",
        click: ({ x }) => `clicked at ${x}`,
        keydown: ({ key }) => `pressed ${key}`,
      });

      expect(result).toBe("empty");
    });

    it("Discriminant with special characters", () => {
      type WeirdUnion =
        | { kind: "a|b"; value: 1 } // pipe in the discriminant (conflicts with OR syntax!)
        | { kind: "c.d"; value: 2 } // dot
        | { kind: "e f"; value: 3 }; // space

      const val: WeirdUnion = { kind: "a|b", value: 1 };

      // The pipe character "a|b" might be confused with OR pattern syntax!
      // This is a potential bug - handler key "a|b" should be an OR pattern
      // But we're using it as a literal discriminant value
      const result = match(val, {
        "a|b": () => "pipe literal", // Does this get parsed as OR pattern or literal?
        "c.d": () => "dot",
        "e f": () => "space",
      });

      expect(result).toBe("pipe literal");
    });

    it("Numeric discriminant with special values", () => {
      // Using numbers that could cause issues
      const testCases: number[] = [0, -0, NaN, Infinity, -Infinity, -1, 1.5];

      for (const val of testCases) {
        // Runtime fallback should handle these
        const result = match(val, [
          when(
            (x) => x === 0,
            () => "zero"
          ),
          when(
            (x) => Number.isNaN(x),
            () => "nan"
          ),
          when(
            (x) => x === Infinity,
            () => "inf"
          ),
          when(
            (x) => x === -Infinity,
            () => "-inf"
          ),
          otherwise((x) => `other: ${x}`),
        ]);

        if (val === 0 || Object.is(val, -0)) {
          expect(result).toBe("zero");
        } else if (Number.isNaN(val)) {
          expect(result).toBe("nan");
        } else if (val === Infinity) {
          expect(result).toBe("inf");
        } else if (val === -Infinity) {
          expect(result).toBe("-inf");
        }
      }
    });

    it("Boolean discriminant", () => {
      // FIXED: Runtime match() now detects boolean discriminants
      // See Finding #3 in FINDINGS.md
      type BoolDiscriminated = { ok: true; value: string } | { ok: false; error: Error };

      const success: BoolDiscriminated = { ok: true, value: "hello" };
      const failure: BoolDiscriminated = { ok: false, error: new Error("fail") };

      // match() now detects "ok" as a discriminant with boolean values
      const successResult = match(success, {
        true: ({ value }) => `success: ${value}`,
        false: ({ error }) => `error: ${error.message}`,
      });
      expect(successResult).toBe("success: hello");

      const failureResult = match(failure, {
        true: ({ value }) => `success: ${value}`,
        false: ({ error }) => `error: ${error.message}`,
      });
      expect(failureResult).toBe("error: fail");
    });
  });

  // ==========================================================================
  // Attack 2: OR pattern edge cases
  // ==========================================================================
  describe("OR pattern edge cases", () => {
    it("OR pattern with single element (degenerate)", () => {
      type Union = "a" | "b" | "c";
      const val: Union = "a";

      // Single-element "OR pattern" - should work same as regular
      const result = match(val, {
        a: () => "just a", // Not an OR pattern
        "b|c": () => "b or c", // OR pattern
      });

      expect(result).toBe("just a");
    });

    it("OR pattern with empty parts", () => {
      type Union = "a" | "b" | "";
      const val: Union = "";

      // "a|" has an empty part after the pipe
      // What happens?
      const result = match(val, {
        "a|": () => "a or empty?", // Unclear semantics
        b: () => "b",
        _: () => "other",
      });

      // The behavior here depends on implementation
      // Empty string after split should be filtered out
      expect(result).toBe("other"); // Falls through to wildcard
    });

    it("OR pattern overlapping with other handlers", () => {
      type Union = "a" | "b" | "c" | "d";
      const val: Union = "a";

      // "a" appears in both a standalone handler and an OR pattern
      // Which takes precedence?
      const result = match(val, {
        a: () => "explicit a",
        "a|b": () => "a or b", // "a" is also here - conflict!
        "c|d": () => "c or d",
      });

      // Standalone should take precedence (processed first)
      expect(result).toBe("explicit a");
    });
  });

  // ==========================================================================
  // Attack 3: Guard predicate edge cases
  // ==========================================================================
  describe("Guard predicate edge cases", () => {
    it("Guards that mutate the value", () => {
      let mutationCount = 0;
      const obj = { count: 0 };

      // Side-effecting predicate
      const result = match(obj, [
        when(
          (v) => {
            mutationCount++;
            v.count++; // Mutates the matched value!
            return false;
          },
          () => "first"
        ),
        when(
          (v) => {
            mutationCount++;
            v.count++;
            return true;
          },
          () => "second"
        ),
        otherwise(() => "default"),
      ]);

      // Both predicates were called, each mutating obj
      expect(result).toBe("second");
      expect(mutationCount).toBe(2);
      expect(obj.count).toBe(2); // Mutated twice!
    });

    it("Guards that throw", () => {
      const value = 42;

      // If a predicate throws, the match throws
      expect(() => {
        match(value, [
          when(
            () => {
              throw new Error("predicate threw");
            },
            () => "never"
          ),
          otherwise(() => "default"),
        ]);
      }).toThrow("predicate threw");
    });

    it("Guards with async predicates (unsupported)", () => {
      // FIXED: Async predicates now throw a clear error
      // See Finding #4 in FINDINGS.md
      const value = 42;

      // Async predicates are detected and throw a helpful error
      expect(() => {
        match(value, [
          when(
            async () => false,
            () => "should not match"
          ),
          otherwise(() => "default"),
        ]);
      }).toThrow("match() guard predicates must be synchronous");
    });

    it("P.empty on non-array", () => {
      // P.empty expects an array, what happens with other types?
      const str = "hello";

      // This should probably throw or not match, but...
      // P.empty is defined as (arr) => arr.length === 0
      // Strings have .length, so this "works"
      const result = match(str as any, [
        when(P.empty, () => "empty"),
        otherwise(() => "not empty"),
      ]);

      expect(result).toBe("not empty"); // str.length === 5
    });

    it("P.nil vs P.defined edge cases", () => {
      // Test with various falsy values
      const cases: any[] = [null, undefined, 0, false, "", NaN, [], {}];

      for (const val of cases) {
        const nilResult = P.nil(val);
        const defResult = P.defined(val);

        if (val === null || val === undefined) {
          expect(nilResult).toBe(true);
          expect(defResult).toBe(false);
        } else {
          expect(nilResult).toBe(false);
          expect(defResult).toBe(true);
        }
      }
    });
  });

  // ==========================================================================
  // Attack 4: isType() edge cases
  // ==========================================================================
  describe("isType() edge cases", () => {
    it("isType with unusual values", () => {
      // Test edge cases for typeof
      const cases: Array<[any, string, boolean]> = [
        [null, "object", true], // typeof null === "object" (JS quirk)
        [undefined, "undefined", true],
        [() => {}, "function", true],
        [async () => {}, "function", true], // async functions are still "function"
        [Symbol(), "symbol", true],
        [BigInt(42), "bigint", true],
        [NaN, "number", true], // NaN is a number!
        [Infinity, "number", true],
      ];

      for (const [val, typeName, expected] of cases) {
        const pred = isType(typeName as any);
        expect(pred(val)).toBe(expected);
      }
    });

    it("isType('null') special case", () => {
      // isType("null") is special-cased because typeof null === "object"
      const pred = isType("null");

      expect(pred(null)).toBe(true);
      expect(pred(undefined)).toBe(false);
      expect(pred({})).toBe(false);
      expect(pred([])).toBe(false);
    });

    it("isType with class inheritance", () => {
      class Animal {}
      class Dog extends Animal {}
      class Cat extends Animal {}

      const dog = new Dog();
      const cat = new Cat();

      // instanceof checks work with inheritance
      expect(isType(Animal)(dog)).toBe(true); // Dog is an Animal
      expect(isType(Animal)(cat)).toBe(true); // Cat is an Animal
      expect(isType(Dog)(dog)).toBe(true);
      expect(isType(Dog)(cat)).toBe(false); // Cat is not a Dog
      expect(isType(Cat)(dog)).toBe(false); // Dog is not a Cat
    });
  });

  // ==========================================================================
  // Attack 5: Complex nested matching
  // ==========================================================================
  describe("Complex nested matching", () => {
    it("Deeply nested discriminated unions", () => {
      type Outer =
        | { kind: "a"; inner: { kind: "x"; value: number } }
        | { kind: "a"; inner: { kind: "y"; value: string } }
        | { kind: "b"; data: boolean };

      // Note: both "a" variants have different inner kinds
      // The outer match only sees "a" vs "b"
      const val: Outer = { kind: "a", inner: { kind: "x", value: 42 } };

      const result = match(val, {
        a: (v) =>
          match(v.inner, {
            x: ({ value }) => `x: ${value}`,
            y: ({ value }) => `y: ${value}`,
          }),
        b: ({ data }) => `b: ${data}`,
      });

      expect(result).toBe("x: 42");
    });

    it("Match in callback position", () => {
      const items = [
        { kind: "add" as const, n: 1 },
        { kind: "mul" as const, n: 2 },
        { kind: "add" as const, n: 3 },
      ];

      // Using match inside map
      const results = items.map((item) =>
        match(item, {
          add: ({ n }) => n + 10,
          mul: ({ n }) => n * 10,
        })
      );

      expect(results).toEqual([11, 20, 13]);
    });
  });
});

// ==========================================================================
// Specialize Macro Edge Cases
// ==========================================================================
describe("Specialize Edge Cases", () => {
  // Test that the runtime fallback works (when macro isn't applied)

  it("Generic function with type parameter", () => {
    interface Functor<F> {
      map<A, B>(fa: F, f: (a: A) => B): F;
    }

    const arrayFunctor: Functor<any[]> = {
      map: <A, B>(fa: A[], f: (a: A) => B) => fa.map(f),
    };

    function double<F>(F: Functor<F>, fa: F): F {
      return F.map(fa, (x: number) => x * 2);
    }

    // Direct call (not specialized)
    const result = double(arrayFunctor, [1, 2, 3]);
    expect(result).toEqual([2, 4, 6]);
  });

  it("Inlining with closures", () => {
    // Does inlining preserve closure captures correctly?
    const captured = 100;

    interface Numeric {
      add(a: number, b: number): number;
    }

    const closureNumeric: Numeric = {
      add: (a, b) => a + b + captured, // Captures `captured`
    };

    function addAll(N: Numeric, xs: number[]): number {
      return xs.reduce((acc, x) => N.add(acc, x), 0);
    }

    // The closure should be preserved during inlining
    const result = addAll(closureNumeric, [1, 2, 3]);
    expect(result).toBe(306); // (0 + 1 + 100) + (101 + 2 + 100) + (203 + 3 + 100)
    // Actually: 0+1+100=101, 101+2+100=203, 203+3+100=306
  });

  it("Dictionary with getters", () => {
    interface Lazy<A> {
      get(): A;
    }

    let callCount = 0;
    const lazyValue: Lazy<number> = {
      get() {
        callCount++;
        return 42;
      },
    };

    function getValue<A>(L: Lazy<A>): A {
      return L.get();
    }

    // Multiple calls to getValue should call get() each time
    expect(getValue(lazyValue)).toBe(42);
    expect(getValue(lazyValue)).toBe(42);
    expect(callCount).toBe(2);
  });
});

// ==========================================================================
// Type Coercion Edge Cases
// ==========================================================================
describe("Type Coercion Edge Cases", () => {
  it("Match on union of primitives and objects", () => {
    type Mixed = string | number | { kind: "obj"; value: any };

    const testVal: (value: Mixed) => string = (value) =>
      match(value, [
        when(isType("string"), (s) => `string: ${s}`),
        when(isType("number"), (n) => `number: ${n}`),
        when(
          (v): v is { kind: "obj"; value: any } =>
            typeof v === "object" && v !== null && v.kind === "obj",
          (o) => `object: ${o.value}`
        ),
        otherwise(() => "unknown"),
      ]);

    expect(testVal("hello")).toBe("string: hello");
    expect(testVal(42)).toBe("number: 42");
    expect(testVal({ kind: "obj", value: "test" })).toBe("object: test");
  });

  it("Discriminated union with overlapping shapes", () => {
    // Two variants have the same shape but different discriminants
    type Confusing =
      | { kind: "a"; value: number; extra?: string }
      | { kind: "b"; value: number; extra?: string };

    const a: Confusing = { kind: "a", value: 42, extra: "x" };
    const b: Confusing = { kind: "b", value: 42, extra: "x" };

    const classify = (c: Confusing) =>
      match(c, {
        a: () => "variant a",
        b: () => "variant b",
      });

    expect(classify(a)).toBe("variant a");
    expect(classify(b)).toBe("variant b");
  });
});
