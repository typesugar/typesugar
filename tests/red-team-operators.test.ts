/**
 * Red Team Tests for @typesugar/operators
 *
 * Attack surfaces:
 * - Operator precedence and associativity conflicts
 * - Undefined/missing operator mappings
 * - Mixed type operations
 * - pipe() with special values (null, undefined, NaN, Infinity)
 * - compose()/flow() with non-functions or async functions
 * - ops() wrapper edge cases
 * - Operator symbol registration edge cases
 * - Prefix unary operator handling
 */
"use no typesugar";

import { describe, it, expect, beforeEach } from "vitest";
import {
  pipe,
  flow,
  compose,
  ops,
  registerOperators,
  getOperatorMethod,
  clearOperatorMappings,
} from "typesugar";

describe("Operators Edge Cases", () => {
  beforeEach(() => {
    clearOperatorMappings();
  });

  // ==========================================================================
  // Attack 1: pipe() with Special Values
  // ==========================================================================
  describe("pipe() with special values", () => {
    it("handles null as initial value", () => {
      const result = pipe(
        null,
        (x) => x ?? "default"
      );
      expect(result).toBe("default");
    });

    it("handles undefined as initial value", () => {
      const result = pipe(
        undefined,
        (x) => x ?? "fallback"
      );
      expect(result).toBe("fallback");
    });

    it("handles NaN propagation", () => {
      const result = pipe(
        NaN,
        (x: number) => x + 1,
        (x: number) => x * 2
      );
      expect(result).toBeNaN();
    });

    it("handles Infinity", () => {
      const result = pipe(
        Infinity,
        (x: number) => x + 1,
        (x: number) => x === Infinity
      );
      expect(result).toBe(true);
    });

    it("handles -0 vs +0", () => {
      const result = pipe(
        -0,
        (x: number) => 1 / x
      );
      expect(result).toBe(-Infinity);
    });

    it("handles single argument (identity)", () => {
      const obj = { a: 1 };
      const result = pipe(obj);
      expect(result).toBe(obj);
    });

    it("preserves object identity through chain", () => {
      const original = { value: 42 };
      const result = pipe(
        original,
        (x) => x,
        (x) => x
      );
      expect(result).toBe(original);
    });
  });

  // ==========================================================================
  // Attack 2: compose() and flow() Edge Cases
  // ==========================================================================
  describe("compose() and flow() edge cases", () => {
    it("compose() with single function returns that function", () => {
      const fn = (x: number) => x * 2;
      const composed = compose(fn);
      expect(composed(5)).toBe(10);
    });

    it("flow() with single function returns that function", () => {
      const fn = (x: number) => x * 2;
      const flowed = flow(fn);
      expect(flowed(5)).toBe(10);
    });

    it("compose() and flow() are inverses", () => {
      const add1 = (x: number) => x + 1;
      const mul2 = (x: number) => x * 2;
      const sub3 = (x: number) => x - 3;

      // flow: left-to-right: add1 -> mul2 -> sub3
      const flowResult = flow(add1, mul2, sub3)(5);
      // (5 + 1) * 2 - 3 = 12 - 3 = 9
      expect(flowResult).toBe(9);

      // compose: right-to-left: sub3 <- mul2 <- add1
      const composeResult = compose(sub3, mul2, add1)(5);
      // same as flow when reversed: (5 + 1) * 2 - 3 = 9
      expect(composeResult).toBe(9);
    });

    it("flow() handles functions that return undefined", () => {
      const toUndefined = (_: number): undefined => undefined;
      const checkUndefined = (x: unknown) => x === undefined;
      const result = flow(toUndefined, checkUndefined)(42);
      expect(result).toBe(true);
    });

    it("compose() handles functions that throw", () => {
      const thrower = (): never => {
        throw new Error("intentional");
      };
      const neverCalled = (_: never) => "should not reach";
      const composed = compose(neverCalled, thrower);

      expect(() => composed()).toThrow("intentional");
    });

    it("flow() with type-narrowing functions", () => {
      const toNumber = (x: string) => parseInt(x, 10);
      const toString = (x: number) => x.toString();
      const toUpper = (x: string) => x.toUpperCase();

      // This should work even though types change through the chain
      const result = flow(toNumber, toString, toUpper)("123");
      expect(result).toBe("123");
    });

    it("compose() handles functions returning objects", () => {
      const wrap = (x: number) => ({ value: x });
      const unwrap = (x: { value: number }) => x.value;
      const double = (x: number) => x * 2;

      const composed = compose(unwrap, wrap, double);
      expect(composed(5)).toBe(10);
    });
  });

  // ==========================================================================
  // Attack 3: Operator Registration Edge Cases
  // ==========================================================================
  describe("operator registration edge cases", () => {
    it("getOperatorMethod returns undefined for unregistered type", () => {
      const method = getOperatorMethod("NonExistentType", "+");
      expect(method).toBeUndefined();
    });

    it("getOperatorMethod returns undefined for unregistered operator", () => {
      registerOperators("TestType", { "+": "add" });
      const method = getOperatorMethod("TestType", "**");
      expect(method).toBeUndefined();
    });

    it("registerOperators can overwrite existing mappings", () => {
      registerOperators("Vector", { "+": "add" });
      expect(getOperatorMethod("Vector", "+")).toBe("add");

      registerOperators("Vector", { "+": "plus" });
      expect(getOperatorMethod("Vector", "+")).toBe("plus");
    });

    it("registerOperators handles empty object", () => {
      registerOperators("EmptyType", {});
      const method = getOperatorMethod("EmptyType", "+");
      expect(method).toBeUndefined();
    });

    it("registerOperators preserves other operators when adding new ones", () => {
      registerOperators("Math", { "+": "add", "-": "sub" });
      registerOperators("Math", { "*": "mul" });

      expect(getOperatorMethod("Math", "+")).toBe("add");
      expect(getOperatorMethod("Math", "-")).toBe("sub");
      expect(getOperatorMethod("Math", "*")).toBe("mul");
    });

    it("clearOperatorMappings removes all registered operators", () => {
      registerOperators("A", { "+": "add" });
      registerOperators("B", { "-": "sub" });

      clearOperatorMappings();

      expect(getOperatorMethod("A", "+")).toBeUndefined();
      expect(getOperatorMethod("B", "-")).toBeUndefined();
    });

    it("handles special operator symbols", () => {
      registerOperators("Bits", {
        "&": "bitwiseAnd",
        "|": "bitwiseOr",
        "^": "bitwiseXor",
        "<<": "leftShift",
        ">>": "rightShift",
      });

      expect(getOperatorMethod("Bits", "&")).toBe("bitwiseAnd");
      expect(getOperatorMethod("Bits", "|")).toBe("bitwiseOr");
      expect(getOperatorMethod("Bits", "^")).toBe("bitwiseXor");
      expect(getOperatorMethod("Bits", "<<")).toBe("leftShift");
      expect(getOperatorMethod("Bits", ">>")).toBe("rightShift");
    });

    it("handles comparison operators", () => {
      registerOperators("Ordered", {
        "<": "lessThan",
        "<=": "lessThanOrEqual",
        ">": "greaterThan",
        ">=": "greaterThanOrEqual",
        "==": "looseEquals",
        "===": "strictEquals",
        "!=": "looseNotEquals",
        "!==": "strictNotEquals",
      });

      expect(getOperatorMethod("Ordered", "<")).toBe("lessThan");
      expect(getOperatorMethod("Ordered", "===")).toBe("strictEquals");
    });
  });

  // ==========================================================================
  // Attack 4: ops() Runtime Behavior
  // ==========================================================================
  describe("ops() runtime fallback behavior", () => {
    it("ops() passes through primitive values unchanged", () => {
      expect(ops(42)).toBe(42);
      expect(ops("hello")).toBe("hello");
      expect(ops(true)).toBe(true);
      expect(ops(null)).toBe(null);
      expect(ops(undefined)).toBe(undefined);
    });

    it("ops() preserves object identity", () => {
      const obj = { x: 1, y: 2 };
      expect(ops(obj)).toBe(obj);
    });

    it("ops() preserves array identity", () => {
      const arr = [1, 2, 3];
      expect(ops(arr)).toBe(arr);
    });

    it("ops() with expression result", () => {
      // At runtime without macro expansion, ops just returns the expression result
      const a = 5;
      const b = 3;
      expect(ops(a + b)).toBe(8);
    });

    it("ops() handles nested expressions at runtime", () => {
      const x = 2;
      const y = 3;
      const z = 4;
      expect(ops(x + y * z)).toBe(14); // Standard precedence: 2 + (3 * 4)
    });
  });

  // ==========================================================================
  // Attack 5: Type Name Edge Cases
  // ==========================================================================
  describe("type name edge cases in operator registration", () => {
    it("handles generic type names (should strip generics)", () => {
      // When the transformer processes ops(), it strips generics from type names
      // Test that registration works with base names
      registerOperators("Array", { "+": "concat" });
      expect(getOperatorMethod("Array", "+")).toBe("concat");
    });

    it("handles type names with special characters", () => {
      // These are valid JavaScript identifiers
      registerOperators("$Dollar", { "+": "add" });
      registerOperators("_Underscore", { "+": "add" });

      expect(getOperatorMethod("$Dollar", "+")).toBe("add");
      expect(getOperatorMethod("_Underscore", "+")).toBe("add");
    });

    it("handles numeric-like type names", () => {
      registerOperators("Vector2", { "+": "add" });
      registerOperators("Vec3D", { "+": "add" });

      expect(getOperatorMethod("Vector2", "+")).toBe("add");
      expect(getOperatorMethod("Vec3D", "+")).toBe("add");
    });

    it("is case-sensitive for type names", () => {
      registerOperators("vector", { "+": "addLower" });
      registerOperators("Vector", { "+": "addUpper" });
      registerOperators("VECTOR", { "+": "addAllCaps" });

      expect(getOperatorMethod("vector", "+")).toBe("addLower");
      expect(getOperatorMethod("Vector", "+")).toBe("addUpper");
      expect(getOperatorMethod("VECTOR", "+")).toBe("addAllCaps");
    });

    it("empty string type name", () => {
      registerOperators("", { "+": "add" });
      expect(getOperatorMethod("", "+")).toBe("add");
    });
  });

  // ==========================================================================
  // Attack 6: Function Composition with Async
  // ==========================================================================
  describe("function composition with async functions", () => {
    it("pipe() can chain async functions (returns Promise)", async () => {
      const asyncDouble = async (x: number) => x * 2;
      const asyncAdd10 = async (x: number) => x + 10;

      // pipe chains the calls, but async functions return Promises
      const result = await pipe(
        Promise.resolve(5),
        async (p) => asyncDouble(await p),
        async (p) => asyncAdd10(await p)
      );

      expect(result).toBe(20); // (5 * 2) + 10
    });

    it("flow() with async functions creates async composed function", async () => {
      const asyncDouble = async (x: number) => x * 2;

      const composed = flow(
        asyncDouble,
        async (p) => (await p) + 10
      );

      const result = await composed(5);
      expect(result).toBe(20);
    });

    it("compose() with async functions", async () => {
      const asyncIncrement = async (x: number) => x + 1;

      const composed = compose(
        async (p: Promise<number>) => (await p) * 2,
        asyncIncrement
      );

      const result = await composed(5);
      expect(result).toBe(12); // (5 + 1) * 2
    });
  });

  // ==========================================================================
  // Attack 7: Edge Cases in Function Arguments
  // ==========================================================================
  describe("edge cases in function arguments", () => {
    it("pipe() with functions that have side effects", () => {
      const sideEffects: number[] = [];
      const trackAndDouble = (x: number) => {
        sideEffects.push(x);
        return x * 2;
      };
      const trackAndAdd = (x: number) => {
        sideEffects.push(x);
        return x + 1;
      };

      const result = pipe(5, trackAndDouble, trackAndAdd);

      expect(result).toBe(11); // (5 * 2) + 1
      expect(sideEffects).toEqual([5, 10]); // Side effects in order
    });

    it("flow() with multi-arg first function loses extra args", () => {
      const multiArg = (a: number, b: number) => a + b;
      const double = (x: number) => x * 2;

      // flow() creates a unary function - extra params are lost
      // This is a limitation: multi-arg functions as first arg produce NaN
      const composed = flow(multiArg as (a: number) => number, double);

      // Finding: NaN because b is undefined in (a + b), then NaN * 2
      expect(composed(5)).toBeNaN();
    });

    it("pipe() handles function returning function", () => {
      const createAdder = (x: number) => (y: number) => x + y;

      const result = pipe(
        5,
        createAdder, // returns (y) => 5 + y
        (adder) => adder(10) // calls adder(10) = 15
      );

      expect(result).toBe(15);
    });

    it("compose() with curried functions", () => {
      const curriedAdd = (a: number) => (b: number) => a + b;
      const curriedMul = (a: number) => (b: number) => a * b;

      // Apply first argument to each curried function
      const add5 = curriedAdd(5);
      const mul2 = curriedMul(2);

      const composed = compose(add5, mul2);
      expect(composed(3)).toBe(11); // (3 * 2) + 5
    });
  });

  // ==========================================================================
  // Attack 8: Method Name Edge Cases
  // ==========================================================================
  describe("method name edge cases", () => {
    it("handles method names that are JavaScript reserved words", () => {
      // These are technically valid method names in JS
      registerOperators("Reserved", {
        "+": "class", // reserved word as method name
        "-": "function",
        "*": "return",
      });

      expect(getOperatorMethod("Reserved", "+")).toBe("class");
      expect(getOperatorMethod("Reserved", "-")).toBe("function");
      expect(getOperatorMethod("Reserved", "*")).toBe("return");
    });

    it("handles method names with unicode", () => {
      registerOperators("Unicode", {
        "+": "добавить", // Russian for "add"
        "-": "減算", // Japanese for "subtract"
      });

      expect(getOperatorMethod("Unicode", "+")).toBe("добавить");
      expect(getOperatorMethod("Unicode", "-")).toBe("減算");
    });

    it("empty string as method name is treated as unregistered (falsy check)", () => {
      // Finding: Empty string is stored but returned as undefined due to falsy check
      // in getOperatorMethod: `if (explicit) return explicit;`
      registerOperators("EmptyMethod", { "+": "" });
      expect(getOperatorMethod("EmptyMethod", "+")).toBeUndefined();
    });

    it("handles method names starting with numbers (invalid identifier)", () => {
      // This will register but would fail at runtime when called
      registerOperators("NumericMethod", { "+": "123add" });
      expect(getOperatorMethod("NumericMethod", "+")).toBe("123add");
    });
  });

  // ==========================================================================
  // Attack 9: Unary Operator Registration
  // ==========================================================================
  describe("unary operator registration", () => {
    it("registers unary minus operator", () => {
      registerOperators("Negatable", { "-unary": "negate" });
      expect(getOperatorMethod("Negatable", "-unary")).toBe("negate");
    });

    it("registers unary plus operator", () => {
      registerOperators("Positable", { "+unary": "toNumber" });
      expect(getOperatorMethod("Positable", "+unary")).toBe("toNumber");
    });

    it("registers logical NOT operator", () => {
      registerOperators("Invertible", { "!": "not" });
      expect(getOperatorMethod("Invertible", "!")).toBe("not");
    });

    it("registers bitwise NOT operator", () => {
      registerOperators("BitwiseInvertible", { "~": "bitwiseNot" });
      expect(getOperatorMethod("BitwiseInvertible", "~")).toBe("bitwiseNot");
    });

    it("distinguishes binary minus from unary minus", () => {
      registerOperators("Numbers", {
        "-": "subtract",
        "-unary": "negate",
      });

      expect(getOperatorMethod("Numbers", "-")).toBe("subtract");
      expect(getOperatorMethod("Numbers", "-unary")).toBe("negate");
    });
  });

  // ==========================================================================
  // Attack 10: Multiple Registrations and Isolation
  // ==========================================================================
  describe("multiple registrations and isolation", () => {
    it("different types can have different mappings for same operator", () => {
      registerOperators("Vector", { "+": "vectorAdd" });
      registerOperators("Matrix", { "+": "matrixAdd" });
      registerOperators("Complex", { "+": "complexAdd" });

      expect(getOperatorMethod("Vector", "+")).toBe("vectorAdd");
      expect(getOperatorMethod("Matrix", "+")).toBe("matrixAdd");
      expect(getOperatorMethod("Complex", "+")).toBe("complexAdd");
    });

    it("same type can have many operators", () => {
      registerOperators("FullMath", {
        "+": "add",
        "-": "sub",
        "*": "mul",
        "/": "div",
        "%": "mod",
        "**": "pow",
        "-unary": "neg",
        "<": "lt",
        "<=": "lte",
        ">": "gt",
        ">=": "gte",
        "===": "eq",
        "!==": "neq",
      });

      expect(getOperatorMethod("FullMath", "+")).toBe("add");
      expect(getOperatorMethod("FullMath", "**")).toBe("pow");
      expect(getOperatorMethod("FullMath", "===")).toBe("eq");
    });

    it("clearOperatorMappings is isolated to test", () => {
      registerOperators("Test1", { "+": "add" });
      clearOperatorMappings();
      registerOperators("Test2", { "-": "sub" });

      expect(getOperatorMethod("Test1", "+")).toBeUndefined();
      expect(getOperatorMethod("Test2", "-")).toBe("sub");
    });
  });
});
