/**
 * Package-level tests for @typesugar/erased.
 *
 * Tests cover:
 * - Erased type construction
 * - Vtable creation helpers
 * - Method dispatch
 * - Widen/narrow operations
 * - Built-in capabilities (Show, Eq, Ord, Hash, Clone, Debug)
 * - Heterogeneous collections
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
} from "../src/index.js";
import type {
  ShowCapability,
  EqCapability,
  OrdCapability,
  HashCapability,
  CloneCapability,
  DebugCapability,
  Erased,
} from "../src/index.js";

describe("eraseWith", () => {
  it("creates an erased value with a vtable", () => {
    const value = { x: 1, y: 2 };
    const erased = eraseWith<typeof value, [ShowCapability]>(value, {
      show: (v) => `Point(${(v as typeof value).x}, ${(v as typeof value).y})`,
    });

    expect(erased.__erased__).toBe(true);
    expect(erased.__value).toBe(value);
    expect(typeof erased.__vtable.show).toBe("function");
  });

  it("supports multiple capabilities in vtable", () => {
    const value = 42;
    const erased = eraseWith<number, [ShowCapability, EqCapability]>(value, {
      show: (v) => String(v),
      equals: (a, b) => a === b,
    });

    expect(erased.__vtable.show(value)).toBe("42");
    expect(erased.__vtable.equals(42, 42)).toBe(true);
    expect(erased.__vtable.equals(42, 43)).toBe(false);
  });
});

describe("helper constructors", () => {
  describe("showable", () => {
    it("creates an erased value with Show capability", () => {
      const e = showable({ name: "Alice" }, (v) => `User(${v.name})`);

      expect(show(e)).toBe("User(Alice)");
    });
  });

  describe("equatable", () => {
    it("creates an erased value with Eq capability", () => {
      const e1 = equatable({ id: 1 }, (a, b) => a.id === b.id);
      const e2 = equatable({ id: 1 }, (a, b) => a.id === b.id);
      const e3 = equatable({ id: 2 }, (a, b) => a.id === b.id);

      expect(equals(e1, e2)).toBe(true);
      expect(equals(e1, e3)).toBe(false);
    });
  });

  describe("showableEq", () => {
    it("creates an erased value with Show and Eq capabilities", () => {
      const e1 = showableEq(
        { x: 1, y: 2 },
        (v) => `(${v.x}, ${v.y})`,
        (a, b) => a.x === b.x && a.y === b.y
      );
      const e2 = showableEq(
        { x: 1, y: 2 },
        (v) => `(${v.x}, ${v.y})`,
        (a, b) => a.x === b.x && a.y === b.y
      );

      expect(show(e1)).toBe("(1, 2)");
      expect(equals(e1, e2)).toBe(true);
    });
  });
});

describe("unwrapErased", () => {
  it("extracts the underlying value", () => {
    const original = { a: 1, b: "hello" };
    const erased = showable(original, () => "test");
    const unwrapped = unwrapErased<typeof original>(erased);

    expect(unwrapped).toBe(original);
    expect(unwrapped.a).toBe(1);
    expect(unwrapped.b).toBe("hello");
  });
});

describe("callMethod", () => {
  it("calls a vtable method by name", () => {
    const erased = showable(100, (v) => `Value: ${v}`);
    const result = callMethod(erased, "show", 100);

    expect(result).toBe("Value: 100");
  });

  it("throws when method is not in vtable", () => {
    const erased = showable(42, String);

    expect(() => callMethod(erased, "nonexistent")).toThrow(
      'Method "nonexistent" not found in erased vtable'
    );
  });
});

describe("capability convenience functions", () => {
  describe("show", () => {
    it("renders using the Show capability", () => {
      const e = showable([1, 2, 3], (arr) => `[${arr.join(", ")}]`);
      expect(show(e)).toBe("[1, 2, 3]");
    });
  });

  describe("equals", () => {
    it("compares using the Eq capability", () => {
      const e1 = equatable("hello", (a, b) => a === b);
      const e2 = equatable("hello", (a, b) => a === b);
      const e3 = equatable("world", (a, b) => a === b);

      expect(equals(e1, e2)).toBe(true);
      expect(equals(e1, e3)).toBe(false);
    });
  });

  describe("compare", () => {
    it("orders using the Ord capability", () => {
      const mkOrd = (n: number) =>
        eraseWith<number, [OrdCapability]>(n, {
          compare: (a, b) => (a as number) - (b as number),
        });

      const e1 = mkOrd(5);
      const e2 = mkOrd(10);
      const e3 = mkOrd(5);

      expect(compare(e1, e2)).toBeLessThan(0);
      expect(compare(e2, e1)).toBeGreaterThan(0);
      expect(compare(e1, e3)).toBe(0);
    });
  });

  describe("hash", () => {
    it("produces a hash using the Hash capability", () => {
      const mkHash = (s: string) =>
        eraseWith<string, [HashCapability]>(s, {
          hash: (v) => {
            let h = 0;
            for (const c of v as string) h = (h * 31 + c.charCodeAt(0)) | 0;
            return h;
          },
        });

      const e1 = mkHash("hello");
      const e2 = mkHash("hello");
      const e3 = mkHash("world");

      expect(hash(e1)).toBe(hash(e2));
      expect(hash(e1)).not.toBe(hash(e3));
    });
  });

  describe("clone", () => {
    it("deep-copies using the Clone capability", () => {
      const original = { count: 42 };
      const e = eraseWith<typeof original, [CloneCapability]>(original, {
        clone: (v) => ({ ...(v as typeof original) }),
      });

      const cloned = clone(e);

      expect(unwrapErased<typeof original>(cloned)).not.toBe(original);
      expect(unwrapErased<typeof original>(cloned)).toEqual(original);
    });

    it("preserves the vtable after cloning", () => {
      const e = eraseWith<number, [CloneCapability, ShowCapability]>(5, {
        clone: (v) => v,
        show: (v) => `Number(${v})`,
      });

      const cloned = clone(e);
      expect(show(cloned)).toBe("Number(5)");
    });
  });

  describe("debug", () => {
    it("renders debug output using the Debug capability", () => {
      const e = eraseWith<{ id: number }, [DebugCapability]>(
        { id: 123 },
        {
          debug: (v) => `Object { id: ${(v as { id: number }).id} }`,
        }
      );

      expect(debug(e)).toBe("Object { id: 123 }");
    });
  });
});

describe("widen/narrow operations", () => {
  describe("widen", () => {
    it("forgets capabilities (type-level only)", () => {
      const full = eraseWith<string, [ShowCapability, EqCapability]>("test", {
        show: (v) => v as string,
        equals: (a, b) => a === b,
      });

      const widened = widen<[ShowCapability, EqCapability], [ShowCapability]>(full);

      expect(show(widened)).toBe("test");
      expect(hasCapability(widened, "equals")).toBe(true);
    });
  });

  describe("narrow", () => {
    it("succeeds when vtable has required methods", () => {
      const e = eraseWith<number, [ShowCapability, EqCapability]>(42, {
        show: String,
        equals: (a, b) => a === b,
      });

      const widened = widen<[ShowCapability, EqCapability], [ShowCapability]>(e);
      const narrowed = narrow<[ShowCapability], [ShowCapability, EqCapability]>(widened, [
        "equals",
      ]);

      expect(narrowed).not.toBeNull();
      expect(equals(narrowed!, narrowed!)).toBe(true);
    });

    it("returns null when method is missing", () => {
      const e = showable(42, String);
      const result = narrow<[ShowCapability], [ShowCapability, EqCapability]>(e, ["equals"]);

      expect(result).toBeNull();
    });
  });

  describe("extendCapabilities", () => {
    it("adds new methods to the vtable", () => {
      const e = showable({ n: 5 }, (v) => `N(${v.n})`);
      const extended = extendCapabilities<[ShowCapability], [ShowCapability, EqCapability]>(e, {
        equals: (a, b) => (a as { n: number }).n === (b as { n: number }).n,
      });

      expect(show(extended)).toBe("N(5)");
      expect(equals(extended, extended)).toBe(true);
    });
  });

  describe("hasCapability", () => {
    it("returns true for present capabilities", () => {
      const e = showableEq(1, String, (a, b) => a === b);

      expect(hasCapability(e, "show")).toBe(true);
      expect(hasCapability(e, "equals")).toBe(true);
    });

    it("returns false for absent capabilities", () => {
      const e = showable(1, String);

      expect(hasCapability(e, "compare")).toBe(false);
      expect(hasCapability(e, "hash")).toBe(false);
    });
  });
});

describe("heterogeneous collections", () => {
  type ShowEq = [ShowCapability, EqCapability];

  const mkShowEq = <T>(value: T, showFn: (v: T) => string): Erased<ShowEq> =>
    eraseWith<T, ShowEq>(value, {
      show: (v) => showFn(v as T),
      equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    });

  describe("mapErased", () => {
    it("maps a function over erased elements", () => {
      const list = [mkShowEq(1, String), mkShowEq("hello", (s) => `"${s}"`)];

      const results = mapErased(list, show);

      expect(results).toEqual(["1", '"hello"']);
    });
  });

  describe("filterErased", () => {
    it("filters based on predicate", () => {
      const list = [mkShowEq(1, String), mkShowEq(2, String), mkShowEq(3, String)];

      const filtered = filterErased(list, (e) => unwrapErased<number>(e) % 2 === 1);

      expect(showAll(filtered)).toEqual(["1", "3"]);
    });
  });

  describe("showAll", () => {
    it("shows all elements in a list", () => {
      const list = [
        showable({ type: "point", x: 1 }, (v) => `Point(${v.x})`),
        showable({ type: "circle", r: 5 }, (v) => `Circle(${v.r})`),
      ];

      expect(showAll(list)).toEqual(["Point(1)", "Circle(5)"]);
    });
  });

  describe("sortErased", () => {
    it("sorts using Ord capability", () => {
      type OrdCap = [OrdCapability, ShowCapability];
      const mkOrd = (n: number): Erased<OrdCap> =>
        eraseWith<number, OrdCap>(n, {
          compare: (a, b) => (a as number) - (b as number),
          show: String,
        });

      const list = [mkOrd(3), mkOrd(1), mkOrd(2)];
      const sorted = sortErased(list);

      expect(showAll(sorted)).toEqual(["1", "2", "3"]);
    });

    it("does not mutate the original list", () => {
      type OrdCap = [OrdCapability];
      const mkOrd = (n: number): Erased<OrdCap> =>
        eraseWith<number, OrdCap>(n, {
          compare: (a, b) => (a as number) - (b as number),
        });

      const original = [mkOrd(3), mkOrd(1), mkOrd(2)];
      const sorted = sortErased(original);

      expect(unwrapErased<number>(original[0])).toBe(3);
      expect(unwrapErased<number>(sorted[0])).toBe(1);
    });
  });

  describe("dedup", () => {
    it("removes consecutive duplicates", () => {
      const list = [
        mkShowEq(1, String),
        mkShowEq(1, String),
        mkShowEq(2, String),
        mkShowEq(2, String),
        mkShowEq(1, String),
      ];

      const deduped = dedup(list);

      expect(showAll(deduped)).toEqual(["1", "2", "1"]);
    });

    it("handles empty list", () => {
      const result = dedup([]);
      expect(result).toEqual([]);
    });

    it("handles single element", () => {
      const result = dedup([mkShowEq(42, String)]);
      expect(showAll(result)).toEqual(["42"]);
    });
  });

  describe("groupByHash", () => {
    it("groups elements by hash", () => {
      type HashEqCaps = [HashCapability, EqCapability];
      const mkHashEq = (n: number): Erased<HashEqCaps> =>
        eraseWith<number, HashEqCaps>(n, {
          hash: (v) => (v as number) % 3,
          equals: (a, b) => a === b,
        });

      const list = [mkHashEq(0), mkHashEq(1), mkHashEq(2), mkHashEq(3), mkHashEq(4)];
      const groups = groupByHash(list);

      expect(groups.size).toBe(3);
      expect(groups.get(0)?.map((e) => unwrapErased<number>(e))).toEqual([0, 3]);
      expect(groups.get(1)?.map((e) => unwrapErased<number>(e))).toEqual([1, 4]);
      expect(groups.get(2)?.map((e) => unwrapErased<number>(e))).toEqual([2]);
    });
  });
});

describe("heterogeneous usage patterns", () => {
  it("stores different concrete types in the same array", () => {
    interface Point {
      x: number;
      y: number;
    }
    interface Circle {
      cx: number;
      cy: number;
      r: number;
    }

    const point: Point = { x: 1, y: 2 };
    const circle: Circle = { cx: 0, cy: 0, r: 5 };

    const shapes = [
      showable(point, (p) => `Point(${p.x}, ${p.y})`),
      showable(circle, (c) => `Circle(r=${c.r})`),
    ];

    expect(showAll(shapes)).toEqual(["Point(1, 2)", "Circle(r=5)"]);
  });

  it("works with primitives and objects mixed", () => {
    const items = [
      showable(42, (n) => `num:${n}`),
      showable("hello", (s) => `str:${s}`),
      showable([1, 2], (arr) => `arr:${arr.join(",")}`),
    ];

    expect(showAll(items)).toEqual(["num:42", "str:hello", "arr:1,2"]);
  });
});
