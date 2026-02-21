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
  mapErased,
  filterErased,
  showAll,
  sortErased,
  dedup,
  groupByHash,
  widen,
  narrow,
  extendCapabilities,
  hasCapability,
} from "../index.js";
import type {
  Erased,
  Capability,
  ShowCapability,
  EqCapability,
  OrdCapability,
  HashCapability,
  CloneCapability,
  DebugCapability,
} from "../index.js";

// ---------------------------------------------------------------------------
// Test helpers — small domain types with explicit vtable factories
// ---------------------------------------------------------------------------

interface Point {
  x: number;
  y: number;
}

const pointVtable = {
  show: (v: unknown) => {
    const p = v as Point;
    return `Point(${p.x}, ${p.y})`;
  },
  equals: (a: unknown, b: unknown) => {
    const pa = a as Point;
    const pb = b as Point;
    return pa.x === pb.x && pa.y === pb.y;
  },
  compare: (a: unknown, b: unknown) => {
    const pa = a as Point;
    const pb = b as Point;
    const dx = pa.x - pb.x;
    return dx !== 0 ? dx : pa.y - pb.y;
  },
  hash: (v: unknown) => {
    const p = v as Point;
    return p.x * 31 + p.y;
  },
  clone: (v: unknown) => {
    const p = v as Point;
    return { x: p.x, y: p.y };
  },
};

const numVtable = {
  show: (v: unknown) => String(v),
  equals: (a: unknown, b: unknown) => a === b,
  compare: (a: unknown, b: unknown) => (a as number) - (b as number),
  hash: (v: unknown) => v as number,
  clone: (v: unknown) => v,
};

const strVtable = {
  show: (v: unknown) => `"${v}"`,
  equals: (a: unknown, b: unknown) => a === b,
  compare: (a: unknown, b: unknown) => (a as string).localeCompare(b as string),
  hash: (v: unknown) => {
    let h = 0;
    const s = v as string;
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) | 0;
    }
    return h;
  },
  clone: (v: unknown) => v,
};

type FullCaps = [ShowCapability, EqCapability, OrdCapability, HashCapability, CloneCapability];

function erasePoint(p: Point): Erased<FullCaps> {
  return eraseWith<Point, FullCaps>(p, pointVtable);
}

function eraseNum(n: number): Erased<FullCaps> {
  return eraseWith<number, FullCaps>(n, numVtable);
}

function eraseStr(s: string): Erased<FullCaps> {
  return eraseWith<string, FullCaps>(s, strVtable);
}

// ---------------------------------------------------------------------------
// 1. Construction
// ---------------------------------------------------------------------------

describe("Construction", () => {
  it("eraseWith creates an erased value with vtable", () => {
    const erased = erasePoint({ x: 1, y: 2 });
    expect(erased.__erased__).toBe(true);
    expect(erased.__value).toEqual({ x: 1, y: 2 });
    expect(typeof erased.__vtable.show).toBe("function");
    expect(typeof erased.__vtable.equals).toBe("function");
  });

  it("showable creates an Erased<[ShowCapability]>", () => {
    const e = showable(42, (n) => `num:${n}`);
    expect(show(e)).toBe("num:42");
  });

  it("equatable creates an Erased<[EqCapability]>", () => {
    const a = equatable(10, (x, y) => x === y);
    const b = equatable(10, (x, y) => x === y);
    const c = equatable(20, (x, y) => x === y);
    expect(equals(a, b)).toBe(true);
    expect(equals(a, c)).toBe(false);
  });

  it("showableEq creates an Erased<[ShowCapability, EqCapability]>", () => {
    const a = showableEq(
      "hello",
      (s) => s.toUpperCase(),
      (x, y) => x === y
    );
    const b = showableEq(
      "hello",
      (s) => s.toUpperCase(),
      (x, y) => x === y
    );
    expect(show(a)).toBe("HELLO");
    expect(equals(a, b)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Method dispatch
// ---------------------------------------------------------------------------

describe("Method dispatch", () => {
  it("show() returns the string representation", () => {
    expect(show(erasePoint({ x: 3, y: 4 }))).toBe("Point(3, 4)");
    expect(show(eraseNum(42))).toBe("42");
    expect(show(eraseStr("hi"))).toBe('"hi"');
  });

  it("equals() compares two erased values", () => {
    expect(equals(erasePoint({ x: 1, y: 2 }), erasePoint({ x: 1, y: 2 }))).toBe(true);
    expect(equals(erasePoint({ x: 1, y: 2 }), erasePoint({ x: 3, y: 4 }))).toBe(false);
    expect(equals(eraseNum(5), eraseNum(5))).toBe(true);
    expect(equals(eraseNum(5), eraseNum(6))).toBe(false);
  });

  it("compare() returns ordering", () => {
    expect(compare(eraseNum(1), eraseNum(2))).toBeLessThan(0);
    expect(compare(eraseNum(2), eraseNum(2))).toBe(0);
    expect(compare(eraseNum(3), eraseNum(2))).toBeGreaterThan(0);
  });

  it("hash() returns a numeric hash", () => {
    const h = hash(erasePoint({ x: 10, y: 20 }));
    expect(typeof h).toBe("number");
    expect(h).toBe(10 * 31 + 20);
  });

  it("clone() deep-copies the value", () => {
    const original = erasePoint({ x: 1, y: 2 });
    const cloned = clone(original);
    expect(unwrapErased<Point>(cloned)).toEqual({ x: 1, y: 2 });
    expect(unwrapErased<Point>(cloned)).not.toBe(unwrapErased<Point>(original));
  });

  it("callMethod dispatches by string name", () => {
    const e = eraseNum(99);
    expect(callMethod(e, "show", 99)).toBe("99");
  });

  it("callMethod throws for missing methods", () => {
    const e = showable(1, String);
    expect(() => callMethod(e, "nonexistent")).toThrow(/not found/);
  });
});

// ---------------------------------------------------------------------------
// 3. Heterogeneous collections
// ---------------------------------------------------------------------------

describe("Heterogeneous collections", () => {
  it("stores mixed types in one array and shows them", () => {
    const items = [eraseNum(42), eraseStr("hello"), erasePoint({ x: 0, y: 0 })];
    const shown = items.map((e) => show(e));
    expect(shown).toEqual(["42", '"hello"', "Point(0, 0)"]);
  });

  it("iterates and transforms heterogeneous values", () => {
    const items = [eraseNum(1), eraseNum(2), eraseNum(3)];
    const doubled = items.map((e) => {
      const n = unwrapErased<number>(e);
      return eraseNum(n * 2);
    });
    expect(doubled.map((e) => unwrapErased<number>(e))).toEqual([2, 4, 6]);
  });
});

// ---------------------------------------------------------------------------
// 4. Collection operations
// ---------------------------------------------------------------------------

describe("Collection operations", () => {
  it("showAll returns string representations", () => {
    const list = [eraseNum(1), eraseStr("a"), erasePoint({ x: 5, y: 6 })];
    expect(showAll(list)).toEqual(["1", '"a"', "Point(5, 6)"]);
  });

  it("sortErased sorts by Ord", () => {
    const list = [eraseNum(3), eraseNum(1), eraseNum(2)];
    const sorted = sortErased(list);
    expect(sorted.map((e) => unwrapErased<number>(e))).toEqual([1, 2, 3]);
  });

  it("dedup removes consecutive duplicates", () => {
    const list = [eraseNum(1), eraseNum(1), eraseNum(2), eraseNum(2), eraseNum(3)];
    const result = dedup(list);
    expect(result.map((e) => unwrapErased<number>(e))).toEqual([1, 2, 3]);
  });

  it("dedup on empty list returns empty", () => {
    const empty: Erased<FullCaps>[] = [];
    expect(dedup(empty)).toEqual([]);
  });

  it("groupByHash groups by hash code", () => {
    const a = eraseNum(1);
    const b = eraseNum(2);
    const c = eraseNum(1);
    const groups = groupByHash([a, b, c]);
    expect(groups.get(1)?.length).toBe(2);
    expect(groups.get(2)?.length).toBe(1);
  });

  it("mapErased transforms elements", () => {
    const list = [eraseNum(10), eraseNum(20)];
    const result = mapErased(list, (e) => show(e));
    expect(result).toEqual(["10", "20"]);
  });

  it("filterErased filters elements", () => {
    const list = [eraseNum(1), eraseNum(2), eraseNum(3), eraseNum(4)];
    const evens = filterErased(list, (e) => unwrapErased<number>(e) % 2 === 0);
    expect(evens.map((e) => unwrapErased<number>(e))).toEqual([2, 4]);
  });
});

// ---------------------------------------------------------------------------
// 5. Widen / Narrow
// ---------------------------------------------------------------------------

describe("Widen / Narrow", () => {
  it("widen drops capabilities at the type level", () => {
    const full = erasePoint({ x: 1, y: 2 });
    const showOnly = widen<FullCaps, [ShowCapability]>(full);
    expect(show(showOnly)).toBe("Point(1, 2)");
    expect(showOnly.__erased__).toBe(true);
    expect(showOnly).toBe(full);
  });

  it("narrow succeeds when methods exist", () => {
    const full = erasePoint({ x: 1, y: 2 });
    const showOnly = widen<FullCaps, [ShowCapability]>(full);
    const narrowed = narrow<[ShowCapability], [ShowCapability, EqCapability]>(showOnly, ["equals"]);
    expect(narrowed).not.toBeNull();
    expect(narrowed!.__erased__).toBe(true);
  });

  it("narrow returns null when methods are missing", () => {
    const showOnly = showable("hi", String);
    const result = narrow<[ShowCapability], [ShowCapability, EqCapability]>(showOnly, ["equals"]);
    expect(result).toBeNull();
  });

  it("extendCapabilities adds methods to the vtable", () => {
    const showOnly = showable(42, (n) => `num:${n}`);
    const extended = extendCapabilities<[ShowCapability], [ShowCapability, EqCapability]>(
      showOnly,
      {
        equals: (a, b) => a === b,
      }
    );
    expect(show(extended)).toBe("num:42");
    expect(
      equals(
        extended,
        extendCapabilities<[ShowCapability], [ShowCapability, EqCapability]>(
          showable(42, (n) => `num:${n}`),
          { equals: (a, b) => a === b }
        )
      )
    ).toBe(true);
  });

  it("hasCapability detects method presence", () => {
    const full = erasePoint({ x: 1, y: 2 });
    expect(hasCapability(full, "show")).toBe(true);
    expect(hasCapability(full, "equals")).toBe(true);
    expect(hasCapability(full, "nonexistent")).toBe(false);

    const showOnly = showable("hi", String);
    expect(hasCapability(showOnly, "show")).toBe(true);
    expect(hasCapability(showOnly, "equals")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Edge cases
// ---------------------------------------------------------------------------

describe("Edge cases", () => {
  it("eraseWith with empty vtable", () => {
    const e = eraseWith(42, {});
    expect(e.__erased__).toBe(true);
    expect(e.__value).toBe(42);
  });

  it("callMethod throws descriptive error for missing method", () => {
    const e = eraseWith(1, { show: () => "1" });
    expect(() => callMethod(e, "missing")).toThrow(
      /Method "missing" not found.*Available: \[show\]/
    );
  });

  it("clone throws when CloneCapability is missing", () => {
    const e = showable("no-clone", String);
    // @ts-expect-error - intentionally passing wrong type to test runtime error
    expect(() => clone(e)).toThrow(/CloneCapability/);
  });

  it("unwrapErased extracts the raw value", () => {
    const e = eraseNum(42);
    expect(unwrapErased<number>(e)).toBe(42);
  });

  it("handles null values", () => {
    const e = showable(null, () => "null");
    expect(show(e)).toBe("null");
    expect(unwrapErased(e)).toBeNull();
  });

  it("handles undefined values", () => {
    const e = showable(undefined, () => "undefined");
    expect(show(e)).toBe("undefined");
    expect(unwrapErased(e)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7. Real-world patterns
// ---------------------------------------------------------------------------

describe("Real-world patterns", () => {
  it("plugin system — heterogeneous plugins with init/destroy", () => {
    interface PluginCapability extends Capability<"Plugin"> {
      readonly methods: {
        init(value: unknown): void;
        name(value: unknown): string;
      };
    }

    const logs: string[] = [];

    const loggerPlugin = eraseWith<{ label: string }, [PluginCapability, ShowCapability]>(
      { label: "Logger" },
      {
        init: (v) => logs.push(`init:${(v as { label: string }).label}`),
        name: (v) => (v as { label: string }).label,
        show: (v) => `Plugin(${(v as { label: string }).label})`,
      }
    );

    const metricsPlugin = eraseWith<{ endpoint: string }, [PluginCapability, ShowCapability]>(
      { endpoint: "/metrics" },
      {
        init: (v) => logs.push(`init:metrics@${(v as { endpoint: string }).endpoint}`),
        name: (v) => `Metrics(${(v as { endpoint: string }).endpoint})`,
        show: (v) => `Plugin(Metrics@${(v as { endpoint: string }).endpoint})`,
      }
    );

    const plugins = [loggerPlugin, metricsPlugin];

    for (const p of plugins) {
      callMethod(p, "init", p.__value);
    }
    expect(logs).toEqual(["init:Logger", "init:metrics@/metrics"]);

    expect(showAll(plugins)).toEqual(["Plugin(Logger)", "Plugin(Metrics@/metrics)"]);
  });

  it("event handlers — mixed handler types in one list", () => {
    const results: string[] = [];

    type HandlerCaps = [ShowCapability, EqCapability];

    const clickHandler = showableEq(
      {
        type: "click" as const,
        handler: () => results.push("clicked"),
      },
      () => `ClickHandler`,
      (a, b) => a.type === b.type
    );

    const keyHandler = showableEq(
      {
        type: "key" as const,
        key: "Enter",
        handler: () => results.push("key:Enter"),
      },
      (v) => `KeyHandler(${v.key})`,
      (a, b) => a.type === b.type && a.key === b.key
    );

    const handlers: Erased<HandlerCaps>[] = [clickHandler, keyHandler];

    expect(showAll(handlers)).toEqual(["ClickHandler", "KeyHandler(Enter)"]);
    expect(equals(handlers[0], handlers[1])).toBe(false);
  });

  it("serializable registry — store mixed types that can all serialize", () => {
    type SerCaps = [ShowCapability, EqCapability];

    const registry: Erased<SerCaps>[] = [
      showableEq(42, String, (a, b) => a === b),
      showableEq(
        "hello",
        (s) => `"${s}"`,
        (a, b) => a === b
      ),
      showableEq(true, String, (a, b) => a === b),
      showableEq(
        [1, 2, 3],
        (a) => `[${a.join(",")}]`,
        (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
      ),
    ];

    expect(showAll(registry)).toEqual(["42", '"hello"', "true", "[1,2,3]"]);

    const duped: Erased<SerCaps>[] = [
      showableEq(1, String, (a, b) => a === b),
      showableEq(1, String, (a, b) => a === b),
      showableEq(2, String, (a, b) => a === b),
    ];
    expect(dedup(duped).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 8. debug() convenience function
// ---------------------------------------------------------------------------

describe("debug()", () => {
  it("calls vtable debug method", () => {
    type Caps = [DebugCapability];
    const e = eraseWith<number, Caps>(42, {
      debug: (v) => `Debug(${v})`,
    });
    expect(debug(e)).toBe("Debug(42)");
  });

  it("works alongside show on the same value", () => {
    type Caps = [ShowCapability, DebugCapability];
    const e = eraseWith<string, Caps>("hello", {
      show: (v) => String(v),
      debug: (v) => `Debug("${v}")`,
    });
    expect(show(e)).toBe("hello");
    expect(debug(e)).toBe('Debug("hello")');
  });
});

// ---------------------------------------------------------------------------
// 9. Additional edge cases
// ---------------------------------------------------------------------------

describe("Additional edge cases", () => {
  it("narrow with empty requiredMethods succeeds", () => {
    const e = showable("test", String);
    const result = narrow(e, []);
    expect(result).not.toBeNull();
    expect(result).toBe(e);
  });

  it("dedup preserves non-consecutive duplicates", () => {
    const list = [eraseNum(1), eraseNum(2), eraseNum(1)];
    const result = dedup(list);
    expect(result.map((e) => unwrapErased<number>(e))).toEqual([1, 2, 1]);
  });

  it("sortErased then dedup removes all duplicates", () => {
    const list = [eraseNum(3), eraseNum(1), eraseNum(2), eraseNum(1), eraseNum(3)];
    const sorted = sortErased(list);
    const unique = dedup(sorted);
    expect(unique.map((e) => unwrapErased<number>(e))).toEqual([1, 2, 3]);
  });

  it("clone preserves vtable identity", () => {
    const original = erasePoint({ x: 1, y: 2 });
    const cloned = clone(original);
    expect(cloned.__vtable).toBe(original.__vtable);
  });
});
