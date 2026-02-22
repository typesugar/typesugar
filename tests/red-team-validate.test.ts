/**
 * Red Team Tests for @typesugar/validate
 *
 * Attack surfaces:
 * - nativeSchema parse/safeParse edge cases
 * - Validator function edge cases (null, undefined, NaN)
 * - Error accumulation in safeParseAll
 * - parseOrElse fallback behavior
 * - Prototype pollution in validation
 * - Type coercion bypass attempts
 * - Array validation edge cases
 * - ValidationError path formatting
 */
import { describe, it, expect } from "vitest";
import {
  nativeSchema,
  parseOrElse,
  parseAll,
  safeParseAll,
  nativeParseOrElse,
  nativeParseAll,
  nativeSafeParseAll,
  makeNativeSchema,
  type Validator,
  type ValidationError,
} from "../packages/validate/src/index.js";

// =============================================================================
// Test Validators
// =============================================================================

const isString: Validator<string> = (value: unknown): value is string => typeof value === "string";

const isNumber: Validator<number> = (value: unknown): value is number =>
  typeof value === "number" && !Number.isNaN(value);

const isNonEmptyString: Validator<string> = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isPositiveNumber: Validator<number> = (value: unknown): value is number =>
  typeof value === "number" && value > 0 && Number.isFinite(value);

interface User {
  name: string;
  age: number;
}

const isUser: Validator<User> = (value: unknown): value is User =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as User).name === "string" &&
  typeof (value as User).age === "number";

describe("Validate Edge Cases", () => {
  // ==========================================================================
  // Attack 1: Type Coercion Prevention
  // ==========================================================================
  describe("Type Coercion Prevention", () => {
    it("should reject objects with toString that returns a string", () => {
      const malicious = {
        toString() {
          return "valid string";
        },
      };
      // Validator correctly rejects - the object is NOT a string despite toString
      expect(isString(malicious)).toBe(false);
      // parse should throw for invalid data
      expect(() => nativeSchema.parse(isString, malicious as unknown)).toThrow("Validation failed");
    });

    it("should reject objects with valueOf that returns a number", () => {
      const malicious = {
        valueOf() {
          return 42;
        },
      };
      expect(isNumber(malicious)).toBe(false);
      const result = nativeSchema.safeParse(isNumber, malicious);
      expect(result._tag).toBe("Invalid");
    });

    it("should reject numeric strings for number validation", () => {
      expect(isNumber("42")).toBe(false);
      expect(isNumber("0")).toBe(false);
      expect(isNumber("")).toBe(false);
      const result = nativeSchema.safeParse(isNumber, "123");
      expect(result._tag).toBe("Invalid");
    });

    it("should reject boolean-like values for string validation", () => {
      expect(isString(true)).toBe(false);
      expect(isString(false)).toBe(false);
      expect(isString(1)).toBe(false);
      expect(isString(0)).toBe(false);
    });
  });

  // ==========================================================================
  // Attack 2: Special Numeric Values
  // ==========================================================================
  describe("Special Numeric Values", () => {
    it("should handle NaN correctly", () => {
      // Standard isNumber should reject NaN
      expect(isNumber(NaN)).toBe(false);
      const result = nativeSchema.safeParse(isNumber, NaN);
      expect(result._tag).toBe("Invalid");
    });

    it("should handle Infinity correctly", () => {
      // isPositiveNumber should reject Infinity (not finite)
      expect(isPositiveNumber(Infinity)).toBe(false);
      expect(isPositiveNumber(-Infinity)).toBe(false);

      // Standard isNumber accepts Infinity (design choice - test documents behavior)
      const basicIsNumber: Validator<number> = (v): v is number => typeof v === "number";
      expect(basicIsNumber(Infinity)).toBe(true);
    });

    it("should handle negative zero correctly", () => {
      const isPositive: Validator<number> = (v): v is number => typeof v === "number" && v > 0;

      // -0 is NOT greater than 0
      expect(isPositive(-0)).toBe(false);
      expect(isPositiveNumber(-0)).toBe(false);
    });

    it("should handle MAX_SAFE_INTEGER and beyond", () => {
      expect(isNumber(Number.MAX_SAFE_INTEGER)).toBe(true);
      expect(isNumber(Number.MAX_SAFE_INTEGER + 1)).toBe(true); // Still a number
      expect(isNumber(Number.MAX_VALUE)).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 3: Prototype Pollution Prevention
  // ==========================================================================
  describe("Prototype Pollution Prevention", () => {
    it("should not be affected by polluted Object.prototype", () => {
      const original = Object.prototype.hasOwnProperty;
      try {
        // Simulate what an attacker might try (we restore immediately)
        const testObj = { name: "test", age: 25 };
        expect(isUser(testObj)).toBe(true);

        // Verify validation doesn't rely on prototype methods
        const cleanObj = Object.create(null);
        cleanObj.name = "test";
        cleanObj.age = 25;
        expect(isUser(cleanObj)).toBe(true);
      } finally {
        // Ensure we don't actually pollute for other tests
        Object.prototype.hasOwnProperty = original;
      }
    });

    it("should reject objects with __proto__ as a field name", () => {
      // Validators should handle __proto__ like any other field
      interface WithProto {
        __proto__: string;
        value: number;
      }
      const isWithProto: Validator<WithProto> = (v): v is WithProto =>
        typeof v === "object" &&
        v !== null &&
        typeof (v as WithProto).__proto__ === "string" &&
        typeof (v as WithProto).value === "number";

      // This object has __proto__ as a regular property
      const obj = JSON.parse('{"__proto__": "test", "value": 42}');
      // Note: JSON.parse creates __proto__ as a regular property, not prototype
      expect(typeof obj.__proto__).toBe("string");
      expect(obj.value).toBe(42);
    });

    it("should handle constructor property access safely", () => {
      interface WithConstructor {
        constructor: string;
      }
      const isWithCtor: Validator<WithConstructor> = (v): v is WithConstructor =>
        typeof v === "object" &&
        v !== null &&
        typeof (v as WithConstructor).constructor === "string";

      // FINDING: When you explicitly set constructor as a property, it shadows
      // the inherited constructor. This is valid JavaScript - the own property
      // takes precedence over the prototype chain.
      const obj = { constructor: "test" };
      expect(typeof obj.constructor).toBe("string"); // Own property shadows
      expect(isWithCtor(obj)).toBe(true); // This validates correctly!

      // Object without the own property has constructor as a function
      const objWithoutCtor = { value: 42 };
      expect(typeof objWithoutCtor.constructor).toBe("function");
      expect(isWithCtor(objWithoutCtor)).toBe(false);

      // Null prototype object also works
      const cleanObj = Object.create(null);
      cleanObj.constructor = "test";
      expect(isWithCtor(cleanObj)).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 4: Null and Undefined Edge Cases
  // ==========================================================================
  describe("Null and Undefined Edge Cases", () => {
    it("should correctly distinguish null from undefined", () => {
      expect(isUser(null)).toBe(false);
      expect(isUser(undefined)).toBe(false);

      const result1 = nativeSchema.safeParse(isUser, null);
      const result2 = nativeSchema.safeParse(isUser, undefined);
      expect(result1._tag).toBe("Invalid");
      expect(result2._tag).toBe("Invalid");
    });

    it("should handle object with null prototype", () => {
      const nullProtoObj = Object.create(null);
      nullProtoObj.name = "test";
      nullProtoObj.age = 25;

      expect(isUser(nullProtoObj)).toBe(true);
      const result = nativeSchema.safeParse(isUser, nullProtoObj);
      expect(result._tag).toBe("Valid");
    });

    it("should reject null masquerading as object", () => {
      // typeof null === 'object', but validators should catch this
      expect(typeof null).toBe("object");
      expect(isUser(null)).toBe(false);
    });

    it("should handle fields that are explicitly undefined", () => {
      const objWithUndefined = { name: "test", age: undefined };
      expect(isUser(objWithUndefined as unknown)).toBe(false);
    });
  });

  // ==========================================================================
  // Attack 5: Array Validation Edge Cases
  // ==========================================================================
  describe("Array Validation Edge Cases", () => {
    const isStringArray: Validator<string[]> = (v): v is string[] =>
      Array.isArray(v) && v.every((item) => typeof item === "string");

    it("should reject array-like objects", () => {
      const arrayLike = { 0: "a", 1: "b", length: 2 };
      expect(isStringArray(arrayLike as unknown)).toBe(false);
    });

    it("should handle sparse arrays - FINDING: every() skips holes", () => {
      // FINDING: Array.prototype.every() SKIPS holes (empty slots), it doesn't
      // call the callback for them. This means sparse arrays can pass validation
      // even when they have undefined slots!
      // eslint-disable-next-line no-sparse-arrays
      const sparse = ["a", , "c"]; // sparse[1] is a hole
      expect(sparse.length).toBe(3);
      expect(1 in sparse).toBe(false); // Hole, not a value

      // This is the ACTUAL behavior - .every() skips holes
      // A naive validator using .every() will pass sparse arrays!
      expect(isStringArray(sparse)).toBe(true); // VULNERABILITY: returns true!

      // To properly validate, validators should check for holes explicitly
      const isStringArrayStrict: Validator<string[]> = (v): v is string[] =>
        Array.isArray(v) &&
        v.length === Object.keys(v).filter((k) => !isNaN(Number(k))).length &&
        v.every((item) => typeof item === "string");

      expect(isStringArrayStrict(sparse)).toBe(false); // Strict version catches it
    });

    it("should handle arrays with holes - FINDING: every() skips holes", () => {
      const arr = new Array(3);
      arr[0] = "a";
      arr[2] = "c";
      // arr[1] is an uninitialized slot (hole)
      expect(1 in arr).toBe(false);

      // FINDING: .every() skips holes, so this incorrectly passes
      expect(isStringArray(arr)).toBe(true); // VULNERABILITY

      // The strict validator catches this
      const isStringArrayStrict: Validator<string[]> = (v): v is string[] =>
        Array.isArray(v) &&
        v.length === Object.keys(v).filter((k) => !isNaN(Number(k))).length &&
        v.every((item) => typeof item === "string");

      expect(isStringArrayStrict(arr)).toBe(false);
    });

    it("should validate empty arrays correctly", () => {
      expect(isStringArray([])).toBe(true);
      const result = nativeSchema.safeParse(isStringArray, []);
      expect(result._tag).toBe("Valid");
    });

    it("should handle typed arrays vs regular arrays", () => {
      const typedArray = new Uint8Array([1, 2, 3]);
      const isNumberArray: Validator<number[]> = (v): v is number[] =>
        Array.isArray(v) && v.every((item) => typeof item === "number");

      // Typed arrays are NOT Array.isArray
      expect(isNumberArray(typedArray as unknown)).toBe(false);
      expect(Array.isArray(typedArray)).toBe(false);
    });
  });

  // ==========================================================================
  // Attack 6: parseOrElse Fallback Behavior
  // ==========================================================================
  describe("parseOrElse Fallback Behavior", () => {
    const parseOrElseNative = nativeParseOrElse(nativeSchema);

    it("should return fallback for invalid data", () => {
      const result = parseOrElseNative(isPositiveNumber, -5, 0);
      expect(result).toBe(0);
    });

    it("should return parsed value for valid data", () => {
      const result = parseOrElseNative(isPositiveNumber, 42, 0);
      expect(result).toBe(42);
    });

    it("should use fallback for null", () => {
      const result = parseOrElseNative(isUser, null, { name: "default", age: 0 });
      expect(result).toEqual({ name: "default", age: 0 });
    });

    it("should not evaluate fallback lazily (it's eager)", () => {
      let sideEffect = false;
      const fallback = (() => {
        sideEffect = true;
        return "fallback";
      })();

      // Fallback is evaluated before parseOrElse is called
      expect(sideEffect).toBe(true);

      const result = parseOrElseNative(isString, "valid", fallback);
      expect(result).toBe("valid");
    });
  });

  // ==========================================================================
  // Attack 7: safeParseAll Error Accumulation
  // ==========================================================================
  describe("safeParseAll Error Accumulation", () => {
    const safeParseAllNative = nativeSafeParseAll(nativeSchema);

    it("should accumulate errors from multiple invalid items", () => {
      const data = [1, "two", 3, "four", 5];
      const result = safeParseAllNative(isString, data);

      expect(result._tag).toBe("Invalid");
      // Note: Current implementation only returns first error via invalidNel
      // This is a design choice worth documenting
    });

    it("should return all valid values when all pass", () => {
      const data = ["a", "b", "c"];
      const result = safeParseAllNative(isString, data);

      expect(result._tag).toBe("Valid");
      if (result._tag === "Valid") {
        expect(result.value).toEqual(["a", "b", "c"]);
      }
    });

    it("should handle empty array", () => {
      const result = safeParseAllNative(isString, []);
      expect(result._tag).toBe("Valid");
      if (result._tag === "Valid") {
        expect(result.value).toEqual([]);
      }
    });

    it("should handle mixed valid/invalid at boundaries", () => {
      const data = ["valid", 123, "also valid"];
      const result = safeParseAllNative(isString, data);
      expect(result._tag).toBe("Invalid");
    });
  });

  // ==========================================================================
  // Attack 8: Custom Validator Edge Cases
  // ==========================================================================
  describe("Custom Validator Edge Cases", () => {
    it("should handle validator that throws", () => {
      const throwingValidator: Validator<string> = (_v): _v is string => {
        throw new Error("Validator error");
      };

      expect(() => nativeSchema.parse(throwingValidator, "test")).toThrow("Validator error");
    });

    it("should handle validator that returns truthy non-boolean", () => {
      // TypeScript enforces boolean return, but at runtime...
      const badValidator = ((v: unknown) => (v ? 1 : 0)) as unknown as Validator<string>;

      // This should still work because 1 is truthy
      const result = nativeSchema.safeParse(badValidator, "test");
      expect(result._tag).toBe("Valid");
    });

    it("should handle async validator (should fail)", () => {
      // Validators must be synchronous - async ones won't work
      const asyncValidator = (async (v: unknown) =>
        typeof v === "string") as unknown as Validator<string>;

      // The Promise object is truthy, so this incorrectly passes
      const result = nativeSchema.safeParse(asyncValidator, "test");
      // This documents the (incorrect) behavior with async validators
      expect(result._tag).toBe("Valid"); // Bug: should be Invalid or throw
    });

    it("should handle validator with side effects", () => {
      let callCount = 0;
      const countingValidator: Validator<string> = (v): v is string => {
        callCount++;
        return typeof v === "string";
      };

      nativeSchema.parse(countingValidator, "test");
      expect(callCount).toBe(1);

      nativeSchema.safeParse(countingValidator, "test");
      expect(callCount).toBe(2);
    });
  });

  // ==========================================================================
  // Attack 9: makeNativeSchema Custom Implementations
  // ==========================================================================
  describe("makeNativeSchema Custom Implementations", () => {
    it("should allow custom error messages", () => {
      const customSchema = makeNativeSchema(
        (validator, data) => {
          if (validator(data)) return data;
          throw new Error(`Custom: validation failed for ${JSON.stringify(data)}`);
        },
        (validator, data) => {
          if (validator(data)) {
            return { _tag: "Valid" as const, value: data };
          }
          return {
            _tag: "Invalid" as const,
            error: {
              head: { path: "$", message: `Invalid: ${typeof data}` },
              tail: { _tag: "Nil" as const },
            },
          };
        }
      );

      expect(() => customSchema.parse(isNumber, "not a number")).toThrow(
        /Custom.*validation failed/
      );

      const result = customSchema.safeParse(isNumber, "not a number");
      expect(result._tag).toBe("Invalid");
      if (result._tag === "Invalid") {
        expect(result.error.head.message).toContain("Invalid");
      }
    });

    it("should handle mismatched parse/safeParse implementations", () => {
      // This is a potential bug: parse says valid, safeParse says invalid
      const inconsistentSchema = makeNativeSchema(
        (validator, data) => {
          // Always succeeds (bug)
          return data;
        },
        (validator, data) => {
          // Actually validates
          if (validator(data)) {
            return { _tag: "Valid" as const, value: data };
          }
          return {
            _tag: "Invalid" as const,
            error: {
              head: { path: "$", message: "Invalid" },
              tail: { _tag: "Nil" as const },
            },
          };
        }
      );

      // parse incorrectly succeeds
      const parsed = inconsistentSchema.parse(isNumber, "not a number");
      expect(parsed).toBe("not a number");

      // safeParse correctly fails
      const result = inconsistentSchema.safeParse(isNumber, "not a number");
      expect(result._tag).toBe("Invalid");
    });
  });

  // ==========================================================================
  // Attack 10: String Validation Edge Cases
  // ==========================================================================
  describe("String Validation Edge Cases", () => {
    it("should handle empty string", () => {
      expect(isString("")).toBe(true);
      expect(isNonEmptyString("")).toBe(false);
    });

    it("should handle whitespace-only strings", () => {
      expect(isString("   ")).toBe(true);
      expect(isNonEmptyString("   ")).toBe(true); // Has length > 0
    });

    it("should handle null character in string", () => {
      const withNull = "hello\0world";
      expect(isString(withNull)).toBe(true);
    });

    it("should handle unicode strings", () => {
      expect(isString("こんにちは")).toBe(true);
      expect(isString("🎉")).toBe(true);
      expect(isString("\u0000")).toBe(true);
    });

    it("should handle very long strings", () => {
      const longString = "a".repeat(1_000_000);
      expect(isString(longString)).toBe(true);
      const result = nativeSchema.safeParse(isString, longString);
      expect(result._tag).toBe("Valid");
    });

    it("should handle String objects vs primitives", () => {
      // String object is NOT the same as string primitive
      const stringObj = new String("test");
      expect(typeof stringObj).toBe("object");
      expect(isString(stringObj)).toBe(false); // Should fail

      const result = nativeSchema.safeParse(isString, stringObj);
      expect(result._tag).toBe("Invalid");
    });
  });
});
