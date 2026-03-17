/**
 * Extended tests for @typesugar/erased — covers APIs and edge cases
 * not exercised in the main test file.
 */
import { describe, it, expect } from "vitest";
import {
  erased,
  eraseWith,
  erasedMacro,
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
  showable,
  equatable,
} from "../src/index.js";
import type {
  JsonCapability,
  ShowCapability,
  EqCapability,
  OrdCapability,
  HashCapability,
  CloneCapability,
  DebugCapability,
  Erased,
  ErasedList,
  Capability,
} from "../src/index.js";

// ============================================================================
// 1. JsonCapability
// ============================================================================

describe("JsonCapability", () => {
  const mkJson = <T>(value: T, toJson: (v: T) => unknown, fromJson: (j: unknown) => T) =>
    eraseWith<T, [JsonCapability]>(value, {
      toJson: (v) => toJson(v as T),
      fromJson: (j) => fromJson(j),
    });

  it("serializes a value to JSON via vtable", () => {
    const e = mkJson(
      { x: 1, y: 2 },
      (v) => ({ x: v.x, y: v.y }),
      (j) => j as { x: number; y: number }
    );

    const json = callMethod(e, "toJson", e.__value);
    expect(json).toEqual({ x: 1, y: 2 });
  });

  it("deserializes a value from JSON via vtable", () => {
    const e = mkJson(
      { name: "Alice" },
      (v) => ({ name: v.name }),
      (j) => j as { name: string }
    );

    const restored = callMethod(e, "fromJson", { name: "Bob" });
    expect(restored).toEqual({ name: "Bob" });
  });

  it("round-trips through toJson / fromJson", () => {
    const original = { id: 42, label: "test" };
    const e = mkJson(
      original,
      (v) => JSON.stringify(v),
      (j) => JSON.parse(j as string)
    );

    const json = callMethod(e, "toJson", e.__value);
    const restored = callMethod(e, "fromJson", json);
    expect(restored).toEqual(original);
  });

  it("coexists with other capabilities", () => {
    type JsonShow = [JsonCapability, ShowCapability];
    const e = eraseWith<number, JsonShow>(42, {
      toJson: (v) => v,
      fromJson: (j) => j as number,
      show: (v) => `num:${v}`,
    });

    expect(show(e)).toBe("num:42");
    expect(callMethod(e, "toJson", e.__value)).toBe(42);
  });
});

// ============================================================================
// 2. erased() runtime stub
// ============================================================================

describe("erased() runtime stub", () => {
  it("throws with the expected error message", () => {
    expect(() => erased<[ShowCapability]>(42)).toThrow(
      "erased() requires the typesugar transformer"
    );
  });

  it("includes guidance about eraseWith in the error", () => {
    expect(() => erased<[ShowCapability]>("hello")).toThrow("eraseWith()");
  });
});

// ============================================================================
// 3. erasedMacro export
// ============================================================================

describe("erasedMacro", () => {
  it("is defined and exported", () => {
    expect(erasedMacro).toBeDefined();
  });

  it("has the expected macro name", () => {
    expect(erasedMacro.name).toBe("erased");
  });

  it("targets the @typesugar/erased module", () => {
    expect(erasedMacro.module).toBe("@typesugar/erased");
  });

  it("has an expand function", () => {
    expect(typeof erasedMacro.expand).toBe("function");
  });
});

// ============================================================================
// 4. ErasedList type-level test
// ============================================================================

describe("ErasedList type", () => {
  it("is assignable from an array of Erased values", () => {
    const list: ErasedList<[ShowCapability]> = [showable(1, String), showable("hello", (s) => s)];

    expect(showAll(list)).toEqual(["1", "hello"]);
  });

  it("is readonly (cannot push)", () => {
    const list: ErasedList<[ShowCapability]> = [showable(1, String)];
    // ReadonlyArray has no push — this is a compile-time guarantee.
    // At runtime we just verify the list works as expected.
    expect(list.length).toBe(1);
  });
});

// ============================================================================
// 5. Edge cases
// ============================================================================

describe("edge cases", () => {
  describe("eraseWith with empty vtable", () => {
    it("creates an erased value with no capabilities", () => {
      const e = eraseWith<number, []>(42, {} as any);

      expect(e.__erased__).toBe(true);
      expect(unwrapErased<number>(e)).toBe(42);
      expect(Object.keys(e.__vtable)).toHaveLength(0);
    });

    it("hasCapability returns false for any method", () => {
      const e = eraseWith<string, []>("test", {} as any);

      expect(hasCapability(e, "show")).toBe(false);
      expect(hasCapability(e, "equals")).toBe(false);
    });
  });

  describe("widen to empty capability list", () => {
    it("produces an erased value with no type-level capabilities", () => {
      const full = eraseWith<number, [ShowCapability]>(42, {
        show: (v) => String(v),
      });

      const widened = widen<[ShowCapability], []>(full);
      expect(widened.__erased__).toBe(true);
      expect(unwrapErased<number>(widened)).toBe(42);
      // The vtable is still there at runtime
      expect(hasCapability(widened, "show")).toBe(true);
    });
  });

  describe("narrow with empty requiredMethods", () => {
    it("always succeeds when no methods are required", () => {
      const e = showable(42, String);
      const result = narrow<[ShowCapability], [ShowCapability]>(e, []);

      expect(result).not.toBeNull();
      expect(show(result!)).toBe("42");
    });

    it("succeeds even on an empty vtable", () => {
      const e = eraseWith<number, []>(10, {} as any);
      const result = narrow<[], []>(e, []);

      expect(result).not.toBeNull();
      expect(unwrapErased<number>(result!)).toBe(10);
    });
  });

  describe("clone preserving all capabilities", () => {
    it("preserves Show + Eq + Clone + Debug capabilities", () => {
      type Full = [ShowCapability, EqCapability, CloneCapability, DebugCapability];
      const e = eraseWith<{ n: number }, Full>(
        { n: 7 },
        {
          show: (v) => `N(${(v as { n: number }).n})`,
          equals: (a, b) => (a as { n: number }).n === (b as { n: number }).n,
          clone: (v) => ({ ...(v as { n: number }) }),
          debug: (v) => `Debug{n: ${(v as { n: number }).n}}`,
        }
      );

      const cloned = clone(e);

      expect(show(cloned)).toBe("N(7)");
      expect(equals(cloned, e)).toBe(true);
      expect(debug(cloned)).toBe("Debug{n: 7}");
      expect(unwrapErased<{ n: number }>(cloned)).not.toBe(unwrapErased<{ n: number }>(e));
      expect(unwrapErased<{ n: number }>(cloned)).toEqual({ n: 7 });
    });
  });

  describe("dedup with all identical elements", () => {
    it("reduces to a single element", () => {
      const mk = () => equatable(42, (a, b) => a === b);
      const list = [mk(), mk(), mk(), mk()];

      const result = dedup(list);
      expect(result).toHaveLength(1);
      expect(unwrapErased<number>(result[0])).toBe(42);
    });
  });

  describe("groupByHash with all same hash", () => {
    it("puts all elements in one bucket", () => {
      type HE = [HashCapability, EqCapability];
      const mk = (n: number): Erased<HE> =>
        eraseWith<number, HE>(n, {
          hash: () => 999, // constant hash
          equals: (a, b) => a === b,
        });

      const list = [mk(1), mk(2), mk(3)];
      const groups = groupByHash(list);

      expect(groups.size).toBe(1);
      const bucket = groups.get(999)!;
      expect(bucket).toHaveLength(3);
      expect(bucket.map((e) => unwrapErased<number>(e))).toEqual([1, 2, 3]);
    });
  });

  describe("mapErased with empty list", () => {
    it("returns an empty array", () => {
      const result = mapErased([], show);
      expect(result).toEqual([]);
    });
  });

  describe("sortErased with empty list", () => {
    it("returns an empty array", () => {
      const result = sortErased<Erased<[OrdCapability]>>([]);
      expect(result).toEqual([]);
    });
  });

  describe("sortErased with single element", () => {
    it("returns a one-element array", () => {
      const e = eraseWith<number, [OrdCapability, ShowCapability]>(42, {
        compare: (a, b) => (a as number) - (b as number),
        show: String,
      });

      const sorted = sortErased([e]);
      expect(sorted).toHaveLength(1);
      expect(show(sorted[0])).toBe("42");
    });
  });

  describe("filterErased returning empty", () => {
    it("returns empty when no elements match", () => {
      type SC = [ShowCapability];
      const list: ErasedList<SC> = [showable(1, String), showable(2, String), showable(3, String)];

      const result = filterErased(list, () => false);
      expect(result).toHaveLength(0);
    });
  });

  describe("callMethod with extra arguments", () => {
    it("forwards all arguments to the vtable method", () => {
      const e = eraseWith<number, [EqCapability]>(0, {
        equals: (a, b) => a === b,
      });

      const result = callMethod(e, "equals", 10, 10);
      expect(result).toBe(true);

      const result2 = callMethod(e, "equals", 10, 20);
      expect(result2).toBe(false);
    });
  });
});
