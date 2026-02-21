/**
 * Red Team Tests for @typesugar/erased
 *
 * Attack surfaces:
 * - VTable method lookup: missing methods, incorrect arity, method name collisions
 * - Capability widen/narrow: type safety bypasses, runtime checks, method presence
 * - Heterogeneous collection iteration: mixed types, vtable correctness per element
 * - Type recovery (unwrapErased): type cast safety, wrong type recovery
 * - Equality semantics: cross-vtable comparison, asymmetric equals
 * - Clone semantics: vtable sharing, deep vs shallow copy
 * - Hash collision handling: same hash, different values
 */
import { describe, it, expect } from "vitest";
import {
  eraseWith,
  showable,
  equatable,
  showableEq,
  unwrapErased,
  callMethod,
  show,
  equals,
  compare,
  hash,
  clone,
  debug,
  widen,
  narrow,
  extendCapabilities,
  hasCapability,
  mapErased,
  filterErased,
  showAll,
  sortErased,
  dedup,
  groupByHash,
  type Erased,
  type Capability,
  type ShowCapability,
  type EqCapability,
  type OrdCapability,
  type HashCapability,
  type CloneCapability,
  type DebugCapability,
  type WithShow,
  type WithEq,
  type WithOrd,
  type WithHash,
  type WithClone,
} from "../packages/erased/src/index.js";

describe("Erased Type Edge Cases", () => {
  // ==========================================================================
  // Attack 1: VTable Method Lookup Edge Cases
  // ==========================================================================
  describe("VTable method lookup", () => {
    it("throws descriptive error for missing method", () => {
      const erased = showable(42, (n) => String(n));

      // Attempting to call a method that doesn't exist in the vtable
      expect(() => callMethod(erased, "equals", 42, 42)).toThrow(
        /Method "equals" not found in erased vtable/
      );
      expect(() => callMethod(erased, "equals", 42, 42)).toThrow(/Available: \[show\]/);
    });

    it("handles methods with wrong arity gracefully", () => {
      const erased = showable(42, (n) => String(n));

      // show() expects one argument but we pass none - JavaScript allows this
      // The vtable function receives undefined
      const result = callMethod(erased, "show");
      expect(result).toBe("undefined"); // String(undefined)
    });

    it("handles extra arguments silently", () => {
      const erased = showable(42, (n) => String(n));

      // Passing extra arguments - JavaScript ignores them
      const result = callMethod(erased, "show", 42, "extra", "args");
      expect(result).toBe("42");
    });

    it("detects non-function vtable entries", () => {
      // Malformed vtable with non-function entry
      const malformed = {
        __erased__: true as const,
        __value: 42,
        __vtable: { show: "not a function" },
      };

      expect(() => callMethod(malformed as any, "show", 42)).toThrow(
        /Method "show" not found in erased vtable/
      );
    });

    it("handles null/undefined in vtable methods", () => {
      const erased = eraseWith<number, [ShowCapability]>(42, {
        show: (v) => (v === null ? "null" : v === undefined ? "undefined" : String(v)),
      });

      // Test the vtable handles null/undefined values
      expect(callMethod(erased, "show", null)).toBe("null");
      expect(callMethod(erased, "show", undefined)).toBe("undefined");
    });
  });

  // ==========================================================================
  // Attack 2: Capability Widen/Narrow Correctness
  // ==========================================================================
  describe("Capability widen/narrow", () => {
    it("widen is zero-cost identity (vtable unchanged)", () => {
      const full = showableEq(42, String, (a, b) => a === b);
      const widened = widen<[ShowCapability, EqCapability], [ShowCapability]>(full);

      // Runtime: same vtable, same value
      expect(widened.__value).toBe(full.__value);
      expect(widened.__vtable).toBe(full.__vtable);

      // The vtable still has equals, but the type doesn't expose it
      expect((widened.__vtable as any).equals).toBeDefined();
    });

    it("narrow returns null for missing methods", () => {
      const showOnly = showable(42, String);
      const narrowed = narrow<[ShowCapability], [ShowCapability, EqCapability]>(showOnly, [
        "show",
        "equals",
      ]);

      expect(narrowed).toBeNull();
    });

    it("narrow succeeds when all methods present", () => {
      const full = showableEq(42, String, (a, b) => a === b);
      // Narrow from ShowCapability to full - should work because vtable has both
      const widened = widen<[ShowCapability, EqCapability], [ShowCapability]>(full);
      const narrowed = narrow<[ShowCapability], [ShowCapability, EqCapability]>(widened, [
        "show",
        "equals",
      ]);

      expect(narrowed).not.toBeNull();
      expect(narrowed!.__vtable.equals).toBeDefined();
    });

    it("narrow with empty required methods always succeeds", () => {
      const erased = showable(42, String);
      const narrowed = narrow(erased, []);

      expect(narrowed).not.toBeNull();
    });

    it("extendCapabilities merges vtables correctly", () => {
      const showOnly = showable(42, String);
      const extended = extendCapabilities<[ShowCapability], [ShowCapability, EqCapability]>(
        showOnly,
        { equals: (a, b) => a === b }
      );

      // Original vtable methods preserved
      expect(extended.__vtable.show).toBeDefined();
      // New methods added
      expect(extended.__vtable.equals).toBeDefined();
      // Value unchanged
      expect(extended.__value).toBe(42);
    });

    it("extendCapabilities overwrites existing methods", () => {
      const original = showable(42, () => "original");
      const extended = extendCapabilities(original, { show: () => "extended" });

      expect(show(extended as WithShow)).toBe("extended");
    });

    it("hasCapability returns correct boolean for method presence", () => {
      const erased = showableEq(42, String, (a, b) => a === b);

      expect(hasCapability(erased, "show")).toBe(true);
      expect(hasCapability(erased, "equals")).toBe(true);
      expect(hasCapability(erased, "compare")).toBe(false);
      expect(hasCapability(erased, "nonexistent")).toBe(false);
    });
  });

  // ==========================================================================
  // Attack 3: Heterogeneous Collection Iteration
  // ==========================================================================
  describe("Heterogeneous collection iteration", () => {
    it("handles mixed concrete types with same capabilities", () => {
      const items: Erased<[ShowCapability]>[] = [
        showable(42, (n) => `number:${n}`),
        showable("hello", (s) => `string:${s}`),
        showable({ x: 1 }, (o) => `object:${JSON.stringify(o)}`),
        showable([1, 2, 3], (a) => `array:${a.join(",")}`),
      ];

      const shown = showAll(items);
      expect(shown).toEqual(["number:42", "string:hello", 'object:{"x":1}', "array:1,2,3"]);
    });

    it("mapErased preserves element order", () => {
      const items = [showable(1, String), showable(2, String), showable(3, String)];

      const mapped = mapErased(items, (e) => unwrapErased<number>(e) * 2);
      expect(mapped).toEqual([2, 4, 6]);
    });

    it("filterErased maintains capability type", () => {
      const items = [showable(1, String), showable(2, String), showable(3, String)];

      const filtered = filterErased(items, (e) => unwrapErased<number>(e) > 1);
      expect(filtered.length).toBe(2);

      // Capabilities still work
      const shown = showAll(filtered);
      expect(shown).toEqual(["2", "3"]);
    });

    it("sortErased handles equal elements", () => {
      const items: (WithOrd & WithShow)[] = [
        eraseWith(2, { compare: (a: number, b: number) => a - b, show: String }),
        eraseWith(1, { compare: (a: number, b: number) => a - b, show: String }),
        eraseWith(2, { compare: (a: number, b: number) => a - b, show: String }),
        eraseWith(1, { compare: (a: number, b: number) => a - b, show: String }),
      ];

      const sorted = sortErased(items);
      const shown = showAll(sorted);
      expect(shown).toEqual(["1", "1", "2", "2"]);
    });

    it("dedup handles empty list", () => {
      const empty: WithEq[] = [];
      const result = dedup(empty);
      expect(result).toEqual([]);
    });

    it("dedup only removes consecutive duplicates", () => {
      const items: WithEq[] = [
        equatable(1, (a, b) => a === b),
        equatable(2, (a, b) => a === b),
        equatable(1, (a, b) => a === b), // Not consecutive with first 1
      ];

      const deduped = dedup(items);
      expect(deduped.length).toBe(3); // All kept because no consecutive dups
    });

    it("dedup removes consecutive duplicates correctly", () => {
      const items: WithEq[] = [
        equatable(1, (a, b) => a === b),
        equatable(1, (a, b) => a === b),
        equatable(2, (a, b) => a === b),
        equatable(2, (a, b) => a === b),
        equatable(1, (a, b) => a === b),
      ];

      const deduped = dedup(items);
      expect(deduped.map((e) => unwrapErased<number>(e))).toEqual([1, 2, 1]);
    });
  });

  // ==========================================================================
  // Attack 4: Type Recovery (unwrapErased) Edge Cases
  // ==========================================================================
  describe("Type recovery (unwrapErased)", () => {
    it("returns correct value when type matches", () => {
      const erased = showable({ x: 1, y: 2 }, JSON.stringify);
      const recovered = unwrapErased<{ x: number; y: number }>(erased);

      expect(recovered.x).toBe(1);
      expect(recovered.y).toBe(2);
    });

    it("allows incorrect type recovery (unsafe)", () => {
      const erased = showable(42, String);
      // Intentionally wrong type - this is the danger of unwrapErased
      const wrongType = unwrapErased<string>(erased);

      // TypeScript thinks it's a string, but it's actually a number
      expect(typeof wrongType).toBe("number");
      // This would be a runtime error if we tried string operations:
      // wrongType.toUpperCase() would throw
    });

    it("handles null wrapped value", () => {
      const erased = showable(null, () => "null");
      const recovered = unwrapErased<null>(erased);
      expect(recovered).toBeNull();
    });

    it("handles undefined wrapped value", () => {
      const erased = showable(undefined, () => "undefined");
      const recovered = unwrapErased<undefined>(erased);
      expect(recovered).toBeUndefined();
    });

    it("preserves reference identity for objects", () => {
      const obj = { mutable: true };
      const erased = showable(obj, JSON.stringify);
      const recovered = unwrapErased<typeof obj>(erased);

      // Should be the same reference
      expect(recovered).toBe(obj);

      // Mutation affects original
      recovered.mutable = false;
      expect(obj.mutable).toBe(false);
    });
  });

  // ==========================================================================
  // Attack 5: Equality Semantics Across Different VTables
  // ==========================================================================
  describe("Equality semantics", () => {
    it("equals uses first argument's vtable", () => {
      // Two erased values with DIFFERENT equals implementations
      const a = equatable(1, (x, y) => x === y);
      const b = equatable(1, () => false); // Always returns false

      // equals(a, b) uses a's vtable
      expect(equals(a, b)).toBe(true);
      // equals(b, a) uses b's vtable
      expect(equals(b, a)).toBe(false);
    });

    it("equals with incompatible concrete types", () => {
      // Same equals implementation but different concrete types
      const num = equatable(42, (a, b) => a === b);
      const str = equatable("42", (a, b) => a === b);

      // These use the vtable's equals which compares values
      // 42 === "42" is false in strict equality
      expect(equals(num, str)).toBe(false);
    });

    it("equals with type coercing implementation", () => {
      // Dangerous: loose equality in vtable
      const num = equatable(42, (a, b) => a == b);
      const str = equatable("42", (a, b) => a == b);

      // Now they're "equal" due to type coercion
      expect(equals(num, str)).toBe(true);
    });

    it("compare handles different concrete types", () => {
      const a: WithOrd = eraseWith(10, { compare: (x: number, y: number) => x - y });
      const b: WithOrd = eraseWith("5", { compare: (x: string, y: string) => x.localeCompare(y) });

      // a's compare expects numbers, but b's value is a string
      // 10 - "5" = 5 (JavaScript coercion)
      expect(compare(a, b)).toBe(5);
    });
  });

  // ==========================================================================
  // Attack 6: Clone Semantics
  // ==========================================================================
  describe("Clone semantics", () => {
    it("clone preserves vtable reference", () => {
      const original: WithClone = eraseWith(
        { x: 1 },
        {
          clone: (v: { x: number }) => ({ x: v.x }),
        }
      );
      const cloned = clone(original);

      // VTable should be shared (zero-cost)
      expect(cloned.__vtable).toBe(original.__vtable);
    });

    it("clone creates new value (deep copy)", () => {
      const obj = { nested: { value: 42 } };
      const original: WithClone = eraseWith(obj, {
        clone: (v: typeof obj) => ({ nested: { value: v.nested.value } }),
      });
      const cloned = clone(original);

      // Value should be different reference
      expect(unwrapErased(cloned)).not.toBe(obj);

      // Mutation doesn't affect original
      unwrapErased<typeof obj>(cloned).nested.value = 100;
      expect(obj.nested.value).toBe(42);
    });

    it("clone with shallow copy implementation", () => {
      const obj = { nested: { value: 42 } };
      // Shallow clone - nested reference shared
      const original: WithClone = eraseWith(obj, {
        clone: (v: typeof obj) => ({ ...v }),
      });
      const cloned = clone(original);

      // Nested object is shared
      expect(unwrapErased<typeof obj>(cloned).nested).toBe(obj.nested);

      // Mutation DOES affect original
      unwrapErased<typeof obj>(cloned).nested.value = 100;
      expect(obj.nested.value).toBe(100);
    });

    it("clone throws for missing CloneCapability", () => {
      // Create value without clone in vtable
      const noClone = showable(42, String);

      expect(() => clone(noClone as unknown as WithClone)).toThrow(
        /clone\(\) requires CloneCapability/
      );
    });
  });

  // ==========================================================================
  // Attack 7: Hash Collision Handling
  // ==========================================================================
  describe("Hash collision handling", () => {
    it("groupByHash groups same-hash values together", () => {
      // All return same hash
      const items: (WithHash & WithEq)[] = [
        eraseWith(1, { hash: () => 42, equals: (a, b) => a === b }),
        eraseWith(2, { hash: () => 42, equals: (a, b) => a === b }),
        eraseWith(3, { hash: () => 42, equals: (a, b) => a === b }),
      ];

      const groups = groupByHash(items);
      expect(groups.size).toBe(1);
      expect(groups.get(42)?.length).toBe(3);
    });

    it("groupByHash distinguishes different hashes", () => {
      const items: (WithHash & WithEq)[] = [
        eraseWith(1, { hash: () => 1, equals: (a, b) => a === b }),
        eraseWith(2, { hash: () => 2, equals: (a, b) => a === b }),
        eraseWith(3, { hash: () => 1, equals: (a, b) => a === b }), // Same hash as 1
      ];

      const groups = groupByHash(items);
      expect(groups.size).toBe(2);
      expect(groups.get(1)?.length).toBe(2);
      expect(groups.get(2)?.length).toBe(1);
    });

    it("groupByHash handles negative hash values", () => {
      const items: (WithHash & WithEq)[] = [
        eraseWith("a", { hash: () => -1, equals: (a, b) => a === b }),
        eraseWith("b", { hash: () => -1, equals: (a, b) => a === b }),
      ];

      const groups = groupByHash(items);
      expect(groups.get(-1)?.length).toBe(2);
    });

    it("groupByHash handles NaN hash (edge case)", () => {
      const items: (WithHash & WithEq)[] = [
        eraseWith("a", { hash: () => NaN, equals: (a, b) => a === b }),
        eraseWith("b", { hash: () => NaN, equals: (a, b) => a === b }),
      ];

      const groups = groupByHash(items);
      // JavaScript Map uses SameValueZero for key comparison, which treats NaN === NaN
      // Unlike strict equality (===) where NaN !== NaN, Map groups all NaN keys together
      expect(groups.size).toBe(1);
      expect(groups.get(NaN)?.length).toBe(2);
    });

    it("groupByHash handles Infinity hash", () => {
      const items: (WithHash & WithEq)[] = [
        eraseWith("a", { hash: () => Infinity, equals: (a, b) => a === b }),
        eraseWith("b", { hash: () => Infinity, equals: (a, b) => a === b }),
      ];

      const groups = groupByHash(items);
      expect(groups.size).toBe(1);
      expect(groups.get(Infinity)?.length).toBe(2);
    });

    it("hash function handles special values", () => {
      // Test that hash() correctly delegates to vtable
      const special: WithHash = eraseWith(null, { hash: () => 0 });
      expect(hash(special)).toBe(0);

      const nanValue: WithHash = eraseWith(NaN, { hash: (v) => (Number.isNaN(v) ? -1 : 0) });
      expect(hash(nanValue)).toBe(-1);
    });
  });

  // ==========================================================================
  // Attack 8: Debug Capability Edge Cases
  // ==========================================================================
  describe("Debug capability", () => {
    it("debug uses vtable debug method", () => {
      const erased: WithDebug = eraseWith(
        { secret: "password" },
        {
          debug: (v: { secret: string }) => `Object { secret: [REDACTED] }`,
        }
      );

      expect(debug(erased)).toBe("Object { secret: [REDACTED] }");
    });

    it("debug vs show can have different output", () => {
      const erased = eraseWith(
        { id: 1, name: "test" },
        {
          show: () => "test",
          debug: () => "Object { id: 1, name: 'test' }",
        }
      );

      expect(show(erased as WithShow)).toBe("test");
      expect(debug(erased as WithDebug)).toBe("Object { id: 1, name: 'test' }");
    });

    it("debug handles circular references (if implementation supports)", () => {
      const circular: any = { self: null };
      circular.self = circular;

      const erased: WithDebug = eraseWith(circular, {
        debug: () => "Object { self: [Circular] }",
      });

      expect(debug(erased)).toBe("Object { self: [Circular] }");
    });
  });
});
