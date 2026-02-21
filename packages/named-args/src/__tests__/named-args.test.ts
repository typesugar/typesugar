import { describe, it, expect } from "vitest";
import {
  namedArgs,
  callWithNamedArgs,
  registerNamedArgs,
  getNamedArgsMeta,
  NamedArgsError,
} from "../index.js";
import type { ParamMeta } from "../index.js";

function add(a: number, b: number): number {
  return a + b;
}

const addParams: ParamMeta[] = [
  { name: "a", type: "number", required: true, position: 0 },
  { name: "b", type: "number", required: true, position: 1 },
];

function greet(name: string, greeting: string = "Hello"): string {
  return `${greeting}, ${name}!`;
}

const greetParams: ParamMeta[] = [
  { name: "name", type: "string", required: true, position: 0 },
  {
    name: "greeting",
    type: "string",
    required: false,
    defaultValue: "Hello",
    position: 1,
  },
];

describe("namedArgs", () => {
  describe("basic usage", () => {
    it("wraps a function and preserves positional calling", () => {
      const wrapped = namedArgs(add, addParams);
      expect(wrapped(3, 4)).toBe(7);
    });

    it("supports named calling via .namedCall()", () => {
      const wrapped = namedArgs(add, addParams);
      expect(wrapped.namedCall({ a: 10, b: 20 })).toBe(30);
    });

    it("attaches __namedArgsMeta__", () => {
      const wrapped = namedArgs(add, addParams);
      expect(wrapped.__namedArgsMeta__).toBeDefined();
      expect(wrapped.__namedArgsMeta__.functionName).toBe("add");
      expect(wrapped.__namedArgsMeta__.requiredParams).toEqual(["a", "b"]);
    });
  });

  describe("reordering", () => {
    it("handles params in different order", () => {
      const wrapped = namedArgs(add, addParams);
      expect(wrapped.namedCall({ b: 5, a: 3 })).toBe(8);
    });

    it("reorders many params correctly", () => {
      function create(x: number, y: number, z: number, w: number) {
        return [x, y, z, w];
      }
      const params: ParamMeta[] = [
        { name: "x", type: "number", required: true, position: 0 },
        { name: "y", type: "number", required: true, position: 1 },
        { name: "z", type: "number", required: true, position: 2 },
        { name: "w", type: "number", required: true, position: 3 },
      ];
      const wrapped = namedArgs(create, params);
      expect(wrapped.namedCall({ w: 4, z: 3, x: 1, y: 2 })).toEqual([1, 2, 3, 4]);
    });
  });

  describe("defaults", () => {
    it("fills default values for missing optional params", () => {
      const wrapped = namedArgs(greet, greetParams);
      expect(wrapped.namedCall({ name: "World" })).toBe("Hello, World!");
    });

    it("overrides defaults when provided", () => {
      const wrapped = namedArgs(greet, greetParams);
      expect(wrapped.namedCall({ name: "World", greeting: "Hi" })).toBe("Hi, World!");
    });
  });

  describe("required validation", () => {
    it("throws NamedArgsError for missing required param", () => {
      const wrapped = namedArgs(add, addParams);
      expect(() => wrapped.namedCall({ a: 1 } as any)).toThrow(NamedArgsError);
      expect(() => wrapped.namedCall({ a: 1 } as any)).toThrow(/Missing required parameter 'b'/);
    });

    it("error has correct properties", () => {
      const wrapped = namedArgs(add, addParams);
      try {
        wrapped.namedCall({} as any);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(NamedArgsError);
        const e = err as NamedArgsError;
        expect(e.reason).toBe("missing_required");
        expect(e.functionName).toBe("add");
        expect(e.paramName).toBe("a");
      }
    });
  });

  describe("unknown params", () => {
    it("throws NamedArgsError for unknown param", () => {
      const wrapped = namedArgs(add, addParams);
      expect(() => wrapped.namedCall({ a: 1, b: 2, c: 3 } as any)).toThrow(NamedArgsError);
      expect(() => wrapped.namedCall({ a: 1, b: 2, c: 3 } as any)).toThrow(/Unknown parameter 'c'/);
    });

    it("error includes known parameter names", () => {
      const wrapped = namedArgs(add, addParams);
      try {
        wrapped.namedCall({ a: 1, b: 2, z: 99 } as any);
        expect.fail("should have thrown");
      } catch (err) {
        const e = err as NamedArgsError;
        expect(e.reason).toBe("unknown_param");
        expect(e.message).toContain("a, b");
      }
    });
  });

  describe("positional calling preserved", () => {
    it("original function still callable positionally", () => {
      const wrapped = namedArgs(add, addParams);
      expect(wrapped(100, 200)).toBe(300);
    });
  });

  describe("mixed types", () => {
    it("handles string, number, boolean, object, array params", () => {
      function mixed(s: string, n: number, b: boolean, o: object, a: number[]) {
        return { s, n, b, o, a };
      }
      const params: ParamMeta[] = [
        { name: "s", type: "string", required: true, position: 0 },
        { name: "n", type: "number", required: true, position: 1 },
        { name: "b", type: "boolean", required: true, position: 2 },
        { name: "o", type: "object", required: true, position: 3 },
        { name: "a", type: "number[]", required: true, position: 4 },
      ];
      const wrapped = namedArgs(mixed, params);
      const result = wrapped.namedCall({
        a: [1, 2],
        o: { key: "val" },
        b: true,
        n: 42,
        s: "hello",
      });
      expect(result).toEqual({
        s: "hello",
        n: 42,
        b: true,
        o: { key: "val" },
        a: [1, 2],
      });
    });
  });

  describe("many params", () => {
    it("handles 8+ parameters", () => {
      function manyArgs(
        a: number,
        b: number,
        c: number,
        d: number,
        e: number,
        f: number,
        g: number,
        h: number
      ) {
        return a + b + c + d + e + f + g + h;
      }
      const params: ParamMeta[] = "abcdefgh".split("").map((name, i) => ({
        name,
        type: "number",
        required: true,
        position: i,
      }));
      const wrapped = namedArgs(manyArgs, params);
      expect(
        wrapped.namedCall({
          h: 8,
          g: 7,
          f: 6,
          e: 5,
          d: 4,
          c: 3,
          b: 2,
          a: 1,
        })
      ).toBe(36);
    });
  });

  describe("edge cases", () => {
    it("works with no params", () => {
      function noArgs() {
        return 42;
      }
      const wrapped = namedArgs(noArgs, []);
      expect(wrapped.namedCall({})).toBe(42);
    });

    it("works with all optional params", () => {
      function allOptional(x?: number, y?: number) {
        return (x ?? 0) + (y ?? 0);
      }
      const params: ParamMeta[] = [
        { name: "x", type: "number", required: false, defaultValue: 0, position: 0 },
        { name: "y", type: "number", required: false, defaultValue: 0, position: 1 },
      ];
      const wrapped = namedArgs(allOptional, params);
      expect(wrapped.namedCall({})).toBe(0);
      expect(wrapped.namedCall({ x: 10 })).toBe(10);
      expect(wrapped.namedCall({ y: 5 })).toBe(5);
      expect(wrapped.namedCall({ x: 3, y: 7 })).toBe(10);
    });

    it("works with all required params", () => {
      const wrapped = namedArgs(add, addParams);
      expect(wrapped.namedCall({ a: 1, b: 2 })).toBe(3);
    });

    it("distinguishes undefined value from missing param", () => {
      function identity(x: unknown) {
        return x;
      }
      const params: ParamMeta[] = [{ name: "x", type: "unknown", required: true, position: 0 }];
      const wrapped = namedArgs(identity, params);
      expect(wrapped.namedCall({ x: undefined })).toBeUndefined();
    });
  });
});

describe("callWithNamedArgs (standalone)", () => {
  it("calls function with reordered args", () => {
    expect(callWithNamedArgs(add, addParams, { b: 10, a: 5 })).toBe(15);
  });
});

describe("registry", () => {
  it("registers and retrieves metadata", () => {
    const fn = namedArgs(add, addParams);
    const meta = getNamedArgsMeta("add");
    expect(meta).toBeDefined();
    expect(meta!.functionName).toBe("add");
    expect(meta!.params).toHaveLength(2);
    expect(meta!.requiredParams).toEqual(["a", "b"]);
    expect(meta!.optionalParams).toEqual([]);
  });

  it("registerNamedArgs can be called directly", () => {
    registerNamedArgs({
      functionName: "testFn",
      params: [],
      requiredParams: [],
      optionalParams: [],
    });
    expect(getNamedArgsMeta("testFn")).toBeDefined();
  });

  it("returns undefined for unregistered functions", () => {
    expect(getNamedArgsMeta("nonexistent_fn_xyz")).toBeUndefined();
  });
});
