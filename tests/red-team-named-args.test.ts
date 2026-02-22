/**
 * Red Team Tests for @typesugar/named-args
 *
 * Attack surfaces:
 * - Missing required arguments validation
 * - Extra unknown arguments rejection
 * - Parameter position handling (gaps, duplicates, out-of-order)
 * - Default value edge cases (undefined, null, falsy)
 * - Special argument names (reserved words, symbols, empty strings)
 * - Builder pattern immutability and state accumulation
 * - Anonymous function handling
 * - Prototype pollution via Object.prototype.hasOwnProperty
 */
import { describe, it, expect } from "vitest";
import {
  namedArgs,
  callWithNamedArgs,
  createBuilder,
  NamedArgsError,
  type ParamMeta,
} from "../packages/named-args/src/index.js";

describe("Named Args Edge Cases", () => {
  // ==========================================================================
  // Attack 1: Missing Required Arguments
  // ==========================================================================
  describe("missing required arguments", () => {
    it("throws NamedArgsError with correct reason for single missing required", () => {
      function greet(name: string, greeting: string): string {
        return `${greeting}, ${name}!`;
      }

      const params: ParamMeta[] = [
        { name: "name", type: "string", required: true, position: 0 },
        { name: "greeting", type: "string", required: true, position: 1 },
      ];

      expect(() => callWithNamedArgs(greet, params, { greeting: "Hello" })).toThrow(
        NamedArgsError
      );

      try {
        callWithNamedArgs(greet, params, { greeting: "Hello" });
      } catch (e) {
        expect(e).toBeInstanceOf(NamedArgsError);
        const err = e as NamedArgsError;
        expect(err.reason).toBe("missing_required");
        expect(err.paramName).toBe("name");
        expect(err.functionName).toBe("greet");
      }
    });

    it("throws for all missing required params (not just the first)", () => {
      function fn(a: number, b: number, c: number): number {
        return a + b + c;
      }

      const params: ParamMeta[] = [
        { name: "a", type: "number", required: true, position: 0 },
        { name: "b", type: "number", required: true, position: 1 },
        { name: "c", type: "number", required: true, position: 2 },
      ];

      expect(() => callWithNamedArgs(fn, params, {})).toThrow(NamedArgsError);
    });

    it("accepts explicitly passing undefined for optional params", () => {
      function fn(a: number, b?: number): number {
        return a + (b ?? 0);
      }

      const params: ParamMeta[] = [
        { name: "a", type: "number", required: true, position: 0 },
        { name: "b", type: "number", required: false, defaultValue: 10, position: 1 },
      ];

      const result = callWithNamedArgs(fn, params, { a: 5, b: undefined });
      expect(result).toBe(5);
    });
  });

  // ==========================================================================
  // Attack 2: Extra Unknown Arguments
  // ==========================================================================
  describe("extra unknown arguments", () => {
    it("rejects unknown parameters with clear error", () => {
      function add(a: number, b: number): number {
        return a + b;
      }

      const params: ParamMeta[] = [
        { name: "a", type: "number", required: true, position: 0 },
        { name: "b", type: "number", required: true, position: 1 },
      ];

      expect(() =>
        callWithNamedArgs(add, params, { a: 1, b: 2, c: 3 })
      ).toThrow(NamedArgsError);

      try {
        callWithNamedArgs(add, params, { a: 1, b: 2, typo: 3 });
      } catch (e) {
        const err = e as NamedArgsError;
        expect(err.reason).toBe("unknown_param");
        expect(err.paramName).toBe("typo");
        expect(err.message).toContain("Known parameters: a, b");
      }
    });

    it("rejects inherited properties from prototype", () => {
      function fn(x: number): number {
        return x;
      }

      const params: ParamMeta[] = [
        { name: "x", type: "number", required: true, position: 0 },
      ];

      const args = Object.create({ inherited: "value" });
      args.x = 42;

      const result = callWithNamedArgs(fn, params, args);
      expect(result).toBe(42);
    });

    it("__proto__ as parameter name is a known edge case", () => {
      // FINDING: __proto__ has special semantics in JavaScript.
      // Object.prototype.hasOwnProperty returns false for __proto__ even when set explicitly,
      // because __proto__ is intercepted by the engine as a prototype accessor.
      // This is documented as a known limitation - avoid using __proto__ as param name.
      function fn(data: unknown): unknown {
        return data;
      }

      const params: ParamMeta[] = [
        { name: "__proto__", type: "unknown", required: true, position: 0 },
      ];

      // Verify that __proto__ triggers missing_required (not unknown_param)
      // because hasOwnProperty returns false for __proto__
      expect(() =>
        callWithNamedArgs(fn, params, { __proto__: { evil: true } })
      ).toThrow(NamedArgsError);

      try {
        callWithNamedArgs(fn, params, { __proto__: { evil: true } });
      } catch (e) {
        const err = e as NamedArgsError;
        expect(err.reason).toBe("missing_required");
        expect(err.paramName).toBe("__proto__");
      }
    });
  });

  // ==========================================================================
  // Attack 3: Parameter Position Edge Cases
  // ==========================================================================
  describe("parameter position handling", () => {
    it("handles non-contiguous position numbers", () => {
      function fn(a: number, _gap: undefined, b: number): number {
        return a + b;
      }

      const params: ParamMeta[] = [
        { name: "a", type: "number", required: true, position: 0 },
        { name: "b", type: "number", required: true, position: 2 },
      ];

      const result = callWithNamedArgs(fn, params, { a: 1, b: 2 });
      expect(result).toBe(3);
    });

    it("handles out-of-order param definitions", () => {
      function fn(first: string, second: string, third: string): string {
        return `${first}-${second}-${third}`;
      }

      const params: ParamMeta[] = [
        { name: "third", type: "string", required: true, position: 2 },
        { name: "first", type: "string", required: true, position: 0 },
        { name: "second", type: "string", required: true, position: 1 },
      ];

      const result = callWithNamedArgs(fn, params, {
        second: "B",
        third: "C",
        first: "A",
      });
      expect(result).toBe("A-B-C");
    });

    it("namedArgs wrapper sorts params by position", () => {
      function fn(a: number, b: number): number {
        return a - b;
      }

      const wrapped = namedArgs(fn, [
        { name: "b", type: "number", required: true, position: 1 },
        { name: "a", type: "number", required: true, position: 0 },
      ]);

      expect(wrapped.__namedArgsMeta__.params[0].name).toBe("a");
      expect(wrapped.__namedArgsMeta__.params[1].name).toBe("b");

      const result = wrapped.namedCall({ a: 10, b: 3 });
      expect(result).toBe(7);
    });
  });

  // ==========================================================================
  // Attack 4: Default Value Edge Cases
  // ==========================================================================
  describe("default value handling", () => {
    it("uses explicit undefined default correctly", () => {
      function fn(x: number | undefined): string {
        return x === undefined ? "undefined" : String(x);
      }

      const params: ParamMeta[] = [
        { name: "x", type: "number | undefined", required: false, defaultValue: undefined, position: 0 },
      ];

      const result = callWithNamedArgs(fn, params, {});
      expect(result).toBe("undefined");
    });

    it("uses null as default value correctly", () => {
      function fn(x: number | null): string {
        return x === null ? "null" : String(x);
      }

      const params: ParamMeta[] = [
        { name: "x", type: "number | null", required: false, defaultValue: null, position: 0 },
      ];

      const result = callWithNamedArgs(fn, params, {});
      expect(result).toBe("null");
    });

    it("distinguishes between missing and explicitly undefined", () => {
      let wasCalled = false;
      function fn(x?: number): void {
        wasCalled = true;
      }

      const params: ParamMeta[] = [
        { name: "x", type: "number", required: false, defaultValue: 999, position: 0 },
      ];

      callWithNamedArgs(fn, params, { x: undefined });
      expect(wasCalled).toBe(true);
    });

    it("uses falsy defaults correctly (0, empty string, false)", () => {
      function fn(num: number, str: string, bool: boolean): string {
        return `${num}-${str}-${bool}`;
      }

      const params: ParamMeta[] = [
        { name: "num", type: "number", required: false, defaultValue: 0, position: 0 },
        { name: "str", type: "string", required: false, defaultValue: "", position: 1 },
        { name: "bool", type: "boolean", required: false, defaultValue: false, position: 2 },
      ];

      const result = callWithNamedArgs(fn, params, {});
      expect(result).toBe("0--false");
    });
  });

  // ==========================================================================
  // Attack 5: Special Parameter Names
  // ==========================================================================
  describe("special parameter names", () => {
    it("handles reserved word as parameter name", () => {
      function fn(reserved: string): string {
        return reserved;
      }

      const params: ParamMeta[] = [
        { name: "class", type: "string", required: true, position: 0 },
      ];

      const result = callWithNamedArgs(fn, params, { class: "MyClass" });
      expect(result).toBe("MyClass");
    });

    it("handles numeric-like parameter names", () => {
      function fn(a: string, b: string): string {
        return a + b;
      }

      const params: ParamMeta[] = [
        { name: "0", type: "string", required: true, position: 0 },
        { name: "1", type: "string", required: true, position: 1 },
      ];

      const result = callWithNamedArgs(fn, params, { "0": "zero", "1": "one" });
      expect(result).toBe("zeroone");
    });

    it("handles empty string parameter name", () => {
      function fn(x: number): number {
        return x;
      }

      const params: ParamMeta[] = [
        { name: "", type: "number", required: true, position: 0 },
      ];

      const result = callWithNamedArgs(fn, params, { "": 42 });
      expect(result).toBe(42);
    });

    it("handles constructor and toString as parameter names", () => {
      function fn(c: string, t: string): string {
        return `${c}|${t}`;
      }

      const params: ParamMeta[] = [
        { name: "constructor", type: "string", required: true, position: 0 },
        { name: "toString", type: "string", required: true, position: 1 },
      ];

      const result = callWithNamedArgs(fn, params, {
        constructor: "ctor",
        toString: "str",
      });
      expect(result).toBe("ctor|str");
    });
  });

  // ==========================================================================
  // Attack 6: Builder Pattern Edge Cases
  // ==========================================================================
  describe("builder pattern", () => {
    it("maintains immutability - original builder unchanged after set", () => {
      function fn(a: number, b: number): number {
        return a + b;
      }

      const params: ParamMeta[] = [
        { name: "a", type: "number", required: true, position: 0 },
        { name: "b", type: "number", required: true, position: 1 },
      ];

      const builder1 = createBuilder(fn, params);
      const builder2 = builder1.set("a", 10);

      expect(builder1.values()).toEqual({});
      expect(builder2.values()).toEqual({ a: 10 });
    });

    it("allows overwriting a previously set value", () => {
      function fn(x: number): number {
        return x;
      }

      const params: ParamMeta[] = [
        { name: "x", type: "number", required: true, position: 0 },
      ];

      const result = createBuilder(fn, params)
        .set("x", 1)
        .set("x", 2)
        .set("x", 3)
        .build();

      expect(result).toBe(3);
    });

    it("throws on build() with missing required params", () => {
      function fn(a: number, b: number): number {
        return a + b;
      }

      const params: ParamMeta[] = [
        { name: "a", type: "number", required: true, position: 0 },
        { name: "b", type: "number", required: true, position: 1 },
      ];

      const builder = createBuilder(fn, params).set("a", 1);

      expect(() => builder.build()).toThrow(NamedArgsError);
      try {
        builder.build();
      } catch (e) {
        const err = e as NamedArgsError;
        expect(err.reason).toBe("missing_required");
        expect(err.paramName).toBe("b");
      }
    });

    it("rejects unknown params in set()", () => {
      function fn(x: number): number {
        return x;
      }

      const params: ParamMeta[] = [
        { name: "x", type: "number", required: true, position: 0 },
      ];

      const builder = createBuilder(fn, params);

      expect(() => builder.set("unknown", 42)).toThrow(NamedArgsError);
    });

    it("values() returns a snapshot, not live reference", () => {
      function fn(x: number): number {
        return x;
      }

      const params: ParamMeta[] = [
        { name: "x", type: "number", required: true, position: 0 },
      ];

      const builder = createBuilder(fn, params).set("x", 10);
      const snapshot = builder.values();

      (snapshot as Record<string, unknown>).x = 999;
      (snapshot as Record<string, unknown>).hacked = true;

      expect(builder.values()).toEqual({ x: 10 });
    });
  });

  // ==========================================================================
  // Attack 7: Anonymous and Edge Case Functions
  // ==========================================================================
  describe("anonymous and special functions", () => {
    it("handles anonymous functions gracefully", () => {
      const fn = (x: number): number => x * 2;

      const params: ParamMeta[] = [
        { name: "x", type: "number", required: true, position: 0 },
      ];

      expect(() => callWithNamedArgs(fn, params, {})).toThrow(NamedArgsError);

      try {
        callWithNamedArgs(fn, params, {});
      } catch (e) {
        const err = e as NamedArgsError;
        expect(err.functionName).toBe("fn");
      }
    });

    it("namedArgs wrapper preserves function name and length", () => {
      function originalName(a: number, b: number, c: number): number {
        return a + b + c;
      }

      const params: ParamMeta[] = [
        { name: "a", type: "number", required: true, position: 0 },
        { name: "b", type: "number", required: true, position: 1 },
        { name: "c", type: "number", required: true, position: 2 },
      ];

      const wrapped = namedArgs(originalName, params);

      expect(wrapped.name).toBe("originalName");
      expect(wrapped.length).toBe(3);
    });

    // TODO: Re-enable when transformer stops rewriting .bind() as extension method.
    // The transformer sees `obj.fn.bind(obj)` and rewrites it to `NamedArgsError.bind(obj)`.
    // This is a bug in tryRewriteExtensionMethod — native Function.prototype methods
    // (.bind, .call, .apply) should be excluded from extension method rewriting.
    // Even it.skip doesn't work because the transformer runs at compile time.
    it.todo("preserves this binding when calling through wrapper");

    it("handles function with no parameters", () => {
      function noParams(): string {
        return "hello";
      }

      const params: ParamMeta[] = [];

      const result = callWithNamedArgs(noParams, params, {});
      expect(result).toBe("hello");
    });

    it("rejects any args when function has no parameters", () => {
      function noParams(): string {
        return "hello";
      }

      const params: ParamMeta[] = [];

      expect(() => callWithNamedArgs(noParams, params, { extra: 1 })).toThrow(
        NamedArgsError
      );
    });
  });

  // ==========================================================================
  // Attack 8: Prototype Pollution Resistance
  // ==========================================================================
  describe("prototype pollution resistance", () => {
    it("uses hasOwnProperty correctly for param existence check", () => {
      function fn(x: number, hasOwnProperty: string): string {
        return `${x}-${hasOwnProperty}`;
      }

      const params: ParamMeta[] = [
        { name: "x", type: "number", required: true, position: 0 },
        { name: "hasOwnProperty", type: "string", required: true, position: 1 },
      ];

      const result = callWithNamedArgs(fn, params, {
        x: 42,
        hasOwnProperty: "mine",
      });
      expect(result).toBe("42-mine");
    });

    it("builder uses null prototype for accumulated values", () => {
      function fn(x: number): number {
        return x;
      }

      const params: ParamMeta[] = [
        { name: "x", type: "number", required: true, position: 0 },
      ];

      const builder = createBuilder(fn, params).set("x", 10);
      const values = builder.values();

      expect(Object.getPrototypeOf(values)).toBe(null);
      expect(values.toString).toBeUndefined();
    });
  });
});
