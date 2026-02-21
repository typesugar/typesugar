/**
 * Red Team Tests for Derive Macros
 *
 * Attack surfaces:
 * - Eq derive with NaN, null, undefined, objects
 * - Ord derive with incomparable values
 * - Clone derive with circular references
 * - Hash derive with objects
 */
import { describe, it, expect } from "vitest";

// We'll test the runtime behavior of derived functions
// since the macro generates these at compile time

describe("Derive Edge Cases - Eq", () => {
  // Manually implement what the Eq derive would generate
  // to test the semantics

  function manualEq<T extends Record<string, any>>(a: T, b: T, fields: (keyof T)[]): boolean {
    return fields.every((field) => {
      const aVal = a[field];
      const bVal = b[field];

      // The derive uses === for primitives, JSON.stringify for objects
      if (typeof aVal === "object" && aVal !== null) {
        return JSON.stringify(aVal) === JSON.stringify(bVal);
      }
      return aVal === bVal;
    });
  }

  it("NaN !== NaN breaks equality", () => {
    interface Point {
      x: number;
      y: number;
    }

    const p1: Point = { x: NaN, y: 0 };
    const p2: Point = { x: NaN, y: 0 };

    // NaN !== NaN in JavaScript
    const areEqual = manualEq(p1, p2, ["x", "y"]);

    // This is expected to be false due to NaN behavior!
    expect(areEqual).toBe(false);

    // Should use Number.isNaN() or Object.is() for proper NaN handling
  });

  it("null and undefined in fields", () => {
    interface MaybeData {
      value: string | null;
      extra: number | undefined;
    }

    const a: MaybeData = { value: null, extra: undefined };
    const b: MaybeData = { value: null, extra: undefined };

    // null === null and undefined === undefined work
    const areEqual = manualEq(a, b, ["value", "extra"]);
    expect(areEqual).toBe(true);
  });

  it("Object equality via JSON.stringify edge cases", () => {
    interface WithObject {
      data: object;
    }

    // Functions are not serialized
    const a: WithObject = { data: { fn: () => 1 } as any };
    const b: WithObject = { data: { fn: () => 2 } as any };

    // JSON.stringify ignores functions, so these appear equal!
    const areEqual = manualEq(a, b, ["data"]);
    expect(areEqual).toBe(true); // Bug: different functions compare equal

    // undefined values are also not serialized
    const c: WithObject = { data: { x: undefined } as any };
    const d: WithObject = { data: {} };

    // { x: undefined } stringifies to "{}", same as {}
    const areEqual2 = manualEq(c, d, ["data"]);
    expect(areEqual2).toBe(true); // Bug: { x: undefined } == {}
  });

  it("Circular references break JSON.stringify", () => {
    interface Node {
      value: number;
      next: object | null;
    }

    const circular: any = { value: 1, next: null };
    circular.next = circular; // Circular reference

    const node: Node = circular;

    // This will throw!
    expect(() => {
      manualEq(node, node, ["value", "next"]);
    }).toThrow(); // TypeError: Converting circular structure to JSON
  });

  it("Symbol keys are not handled", () => {
    const sym = Symbol("test");

    interface WithSymbol {
      [key: symbol]: number;
      name: string;
    }

    const a: WithSymbol = { [sym]: 1, name: "a" };
    const b: WithSymbol = { [sym]: 2, name: "a" };

    // Symbol keys won't be in the fields list from derive
    // So they're silently ignored
    const areEqual = manualEq(a, b, ["name"]); // Only checks "name"
    expect(areEqual).toBe(true); // Different symbol values ignored!
  });

  it("Getter properties", () => {
    interface WithGetter {
      _value: number;
      computed: number; // Actually a getter
    }

    const a: WithGetter = {
      _value: 5,
      get computed() {
        return this._value * 2;
      },
    } as WithGetter;

    const b: WithGetter = {
      _value: 5,
      get computed() {
        return this._value * 3;
      }, // Different getter!
    } as WithGetter;

    // Getters are evaluated, so this compares the computed values
    const areEqual = manualEq(a, b, ["computed"]);
    expect(areEqual).toBe(false); // 10 !== 15
  });
});

describe("Derive Edge Cases - Ord", () => {
  function manualCompare<T extends Record<string, any>>(
    a: T,
    b: T,
    fields: (keyof T)[]
  ): -1 | 0 | 1 {
    for (const field of fields) {
      const aVal = a[field] as any;
      const bVal = b[field] as any;
      if (aVal < bVal) return -1;
      if (aVal > bVal) return 1;
    }
    return 0;
  }

  it("NaN comparisons always return false", () => {
    interface Point {
      x: number;
    }

    const p1: Point = { x: NaN };
    const p2: Point = { x: 5 };

    // NaN < 5 is false, NaN > 5 is also false!
    const cmp = manualCompare(p1, p2, ["x"]);
    expect(cmp).toBe(0); // Bug: NaN appears "equal" to everything

    // Also NaN vs NaN
    const cmp2 = manualCompare(p1, { x: NaN }, ["x"]);
    expect(cmp2).toBe(0); // Both comparisons false, so returns 0
  });

  it("String comparison is lexicographic", () => {
    interface Named {
      name: string;
    }

    const a: Named = { name: "apple" };
    const b: Named = { name: "banana" };
    const c: Named = { name: "Apple" }; // Capital A

    expect(manualCompare(a, b, ["name"])).toBe(-1); // a < b
    expect(manualCompare(c, a, ["name"])).toBe(-1); // "Apple" < "apple" (uppercase first)
  });

  it("Mixed type comparison is coerced", () => {
    interface Mixed {
      value: any;
    }

    const num: Mixed = { value: 5 };
    const str: Mixed = { value: "5" };

    // "5" < 5 and "5" > 5 both use type coercion
    // "5" == 5 is true but "5" < 5 is true (string converted to number)
    expect(manualCompare(str, num, ["value"])).toBe(0); // 5 < 5 false, 5 > 5 false
  });

  it("null and undefined comparison", () => {
    interface Maybe {
      value: number | null | undefined;
    }

    const nul: Maybe = { value: null };
    const und: Maybe = { value: undefined };
    const zero: Maybe = { value: 0 };

    // null < 0 is true (null coerces to 0, so 0 < 0 is false)
    // Actually: null < 0 → 0 < 0 → false
    // null > 0 → 0 > 0 → false
    expect(manualCompare(nul, zero, ["value"])).toBe(0); // null "equals" 0

    // undefined comparisons are always false
    expect(manualCompare(und, zero, ["value"])).toBe(0); // undefined doesn't compare
    expect(manualCompare(und, nul, ["value"])).toBe(0);
  });
});

describe("Derive Edge Cases - Clone", () => {
  // Clone uses Object.assign or spread
  function manualClone<T extends Record<string, any>>(value: T): T {
    return { ...value };
  }

  it("Shallow clone doesn't deep copy nested objects", () => {
    interface Nested {
      data: { count: number };
    }

    const original: Nested = { data: { count: 0 } };
    const cloned = manualClone(original);

    // Shallow clone - same reference
    expect(cloned.data).toBe(original.data);

    // Mutating clone affects original!
    cloned.data.count = 99;
    expect(original.data.count).toBe(99); // Bug: shallow clone
  });

  it("Clone loses prototype chain", () => {
    class Point {
      constructor(
        public x: number,
        public y: number
      ) {}

      distance(): number {
        return Math.sqrt(this.x ** 2 + this.y ** 2);
      }
    }

    const original = new Point(3, 4);
    const cloned = { ...original };

    expect(cloned.x).toBe(3);
    expect(cloned.y).toBe(4);

    // But the cloned object is NOT a Point instance
    expect(cloned instanceof Point).toBe(false);

    // Methods are lost!
    expect((cloned as any).distance).toBeUndefined();
  });

  it("Clone doesn't handle Symbol keys", () => {
    const sym = Symbol("test");

    const original: Record<string | symbol, any> = {
      name: "test",
      [sym]: "secret",
    };

    // Object spread does copy Symbol keys
    const cloned = { ...original };
    expect(cloned[sym]).toBe("secret"); // Actually works!
  });

  it("Clone loses getters/setters", () => {
    const original = {
      _value: 5,
      get doubled() {
        return this._value * 2;
      },
      set doubled(v: number) {
        this._value = v / 2;
      },
    };

    const cloned = { ...original };

    // Getters are evaluated during spread, not copied as getters
    expect(cloned.doubled).toBe(10); // Value is frozen
    expect(cloned._value).toBe(5);

    // Setting doubled doesn't work - it's just a value now
    cloned.doubled = 20;
    expect(cloned._value).toBe(5); // Unchanged!
  });
});

describe("Derive Edge Cases - Hash", () => {
  // Simple hash implementation
  function simpleHash(value: any): number {
    const str = JSON.stringify(value);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
  }

  it("Hash collisions with JSON.stringify", () => {
    // Same issues as Eq with JSON.stringify

    const a = { fn: () => 1 };
    const b = { fn: () => 2 };

    // Functions ignored, same hash!
    expect(simpleHash(a)).toBe(simpleHash(b));

    // undefined values
    const c = { x: undefined };
    const d = {};

    expect(simpleHash(c)).toBe(simpleHash(d));
  });

  it("Hash of NaN", () => {
    const a = { value: NaN };
    const b = { value: NaN };

    // JSON.stringify(NaN) is "null", so all NaN values hash the same
    expect(simpleHash(a)).toBe(simpleHash(b));

    // But NaN in array becomes null
    expect(JSON.stringify([NaN])).toBe("[null]");
    expect(JSON.stringify([null])).toBe("[null]");
  });

  it("Hash of Infinity", () => {
    // Infinity becomes null in JSON
    expect(JSON.stringify({ x: Infinity })).toBe('{"x":null}');
    expect(JSON.stringify({ x: -Infinity })).toBe('{"x":null}');

    // So Infinity, -Infinity, NaN, and null all hash the same!
    const vals = [Infinity, -Infinity, NaN, null];
    const hashes = vals.map((v) => simpleHash({ x: v }));

    expect(new Set(hashes).size).toBe(1); // All same hash!
  });

  it("Hash of BigInt throws", () => {
    // BigInt can't be serialized with JSON.stringify
    const obj = { value: BigInt(42) };

    expect(() => simpleHash(obj)).toThrow();
  });
});

describe("Derive Edge Cases - Debug", () => {
  // Debug generates string representation
  function manualDebug<T extends Record<string, any>>(
    value: T,
    typeName: string,
    fields: (keyof T)[]
  ): string {
    const parts = fields.map((f) => {
      const v = value[f];
      const repr = typeof v === "string" ? `"${v}"` : String(v);
      return `${String(f)}: ${repr}`;
    });
    return `${typeName} { ${parts.join(", ")} }`;
  }

  it("Debug of circular reference", () => {
    interface Node {
      value: number;
      next: Node | null;
    }

    const circular: any = { value: 1, next: null };
    circular.next = circular;

    // String() on an object with circular ref doesn't throw
    // but produces "[object Object]"
    const debug = manualDebug(circular, "Node", ["value", "next"]);

    expect(debug).toContain("[object Object]");
  });

  it("Debug of special values", () => {
    interface Special {
      nan: number;
      inf: number;
      negInf: number;
      undef: undefined;
      nul: null;
    }

    const val: Special = {
      nan: NaN,
      inf: Infinity,
      negInf: -Infinity,
      undef: undefined,
      nul: null,
    };

    const debug = manualDebug(val, "Special", ["nan", "inf", "negInf", "undef", "nul"]);

    expect(debug).toContain("NaN");
    expect(debug).toContain("Infinity");
    expect(debug).toContain("-Infinity");
    expect(debug).toContain("undefined");
    expect(debug).toContain("null");
  });

  it("Debug of very long strings", () => {
    interface LongText {
      content: string;
    }

    const long: LongText = { content: "x".repeat(10000) };
    const debug = manualDebug(long, "LongText", ["content"]);

    // This produces a very long debug string
    expect(debug.length).toBeGreaterThan(10000);

    // In production, you'd want truncation
  });
});
