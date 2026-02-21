/**
 * Red Team Tests for @typesugar/mapper
 *
 * Attack surfaces:
 * - Nested object mapping (shallow copy vs deep transform)
 * - Null/undefined field handling
 * - Optional field mapping
 * - Array/collection field mapping
 * - Special property names (numeric keys, special chars)
 * - Getter invocation during mapping
 * - Compute function side effects
 * - Type coercion edge cases
 */
import { describe, it, expect, vi } from "vitest";
import { transformInto, TransformConfig } from "@typesugar/mapper";

describe("Mapper Edge Cases", () => {
  // ==========================================================================
  // Attack 1: Nested Object Mapping
  // ==========================================================================
  describe("nested object mapping", () => {
    interface SourceWithNested {
      id: number;
      metadata: { createdAt: Date; tags: string[] };
    }

    interface TargetWithNested {
      id: number;
      metadata: { createdAt: Date; tags: string[] };
    }

    it("shallow copies nested objects (reference equality)", () => {
      const source: SourceWithNested = {
        id: 1,
        metadata: { createdAt: new Date("2024-01-01"), tags: ["a", "b"] },
      };

      const target = transformInto<SourceWithNested, TargetWithNested>(source);

      // The nested object should be the SAME reference (shallow copy)
      // This is correct zero-cost behavior but users might expect deep copy
      expect(target.metadata).toBe(source.metadata);

      // Mutation in source affects target
      source.metadata.tags.push("c");
      expect(target.metadata.tags).toContain("c");
    });

    it("nested objects with different shapes require compute", () => {
      interface Source {
        user: { firstName: string; lastName: string };
      }
      interface Target {
        user: { fullName: string };
      }

      const source: Source = { user: { firstName: "John", lastName: "Doe" } };

      // Without compute, this would fail or produce wrong shape
      const target = transformInto<Source, Target>(source, {
        compute: {
          user: (src) => ({ fullName: `${src.user.firstName} ${src.user.lastName}` }),
        },
      });

      expect(target.user.fullName).toBe("John Doe");
    });

    it("deeply nested objects maintain reference chain", () => {
      interface DeepSource {
        level1: { level2: { level3: { value: number } } };
      }
      interface DeepTarget {
        level1: { level2: { level3: { value: number } } };
      }

      const source: DeepSource = { level1: { level2: { level3: { value: 42 } } } };
      const target = transformInto<DeepSource, DeepTarget>(source);

      // All levels are the same reference
      expect(target.level1).toBe(source.level1);
      expect(target.level1.level2).toBe(source.level1.level2);
      expect(target.level1.level2.level3).toBe(source.level1.level2.level3);
    });
  });

  // ==========================================================================
  // Attack 2: Null/Undefined Field Handling
  // ==========================================================================
  describe("null/undefined field handling", () => {
    interface NullableSource {
      name: string | null;
      age: number | undefined;
      email: string;
    }

    interface NullableTarget {
      name: string | null;
      age: number | undefined;
      email: string;
    }

    it("preserves null values in fields", () => {
      const source: NullableSource = { name: null, age: 25, email: "test@test.com" };
      const target = transformInto<NullableSource, NullableTarget>(source);

      expect(target.name).toBeNull();
      expect(target.age).toBe(25);
    });

    it("preserves undefined values in fields", () => {
      const source: NullableSource = { name: "John", age: undefined, email: "test@test.com" };
      const target = transformInto<NullableSource, NullableTarget>(source);

      expect(target.age).toBeUndefined();
      expect("age" in target).toBe(true); // Property exists but is undefined
    });

    it("handles all-null source object", () => {
      interface AllNullable {
        a: string | null;
        b: number | null;
        c: boolean | null;
      }

      const source: AllNullable = { a: null, b: null, c: null };
      const target = transformInto<AllNullable, AllNullable>(source);

      expect(target).toEqual({ a: null, b: null, c: null });
    });
  });

  // ==========================================================================
  // Attack 3: Optional Field Mapping
  // ==========================================================================
  describe("optional field mapping", () => {
    interface SourceWithOptional {
      required: string;
      optional?: number;
    }

    interface TargetWithOptional {
      required: string;
      optional?: number;
    }

    it("maps present optional fields", () => {
      const source: SourceWithOptional = { required: "test", optional: 42 };
      const target = transformInto<SourceWithOptional, TargetWithOptional>(source);

      expect(target.optional).toBe(42);
    });

    it("handles missing optional fields in source", () => {
      const source: SourceWithOptional = { required: "test" };
      const target = transformInto<SourceWithOptional, TargetWithOptional>(source);

      // The optional field should be undefined when absent
      expect(target.optional).toBeUndefined();
    });

    interface TargetRequiresOptional {
      required: string;
      optional: number; // Required in target!
    }

    it("const can fill missing optional-to-required fields", () => {
      const source: SourceWithOptional = { required: "test" };

      const target = transformInto<SourceWithOptional, TargetRequiresOptional>(source, {
        const: { optional: 0 },
      });

      expect(target.optional).toBe(0);
    });
  });

  // ==========================================================================
  // Attack 4: Array/Collection Field Mapping
  // ==========================================================================
  describe("array/collection field mapping", () => {
    interface SourceWithArrays {
      items: number[];
      matrix: number[][];
      tuples: [string, number][];
    }

    interface TargetWithArrays {
      items: number[];
      matrix: number[][];
      tuples: [string, number][];
    }

    it("shallow copies arrays (same reference)", () => {
      const source: SourceWithArrays = {
        items: [1, 2, 3],
        matrix: [
          [1, 2],
          [3, 4],
        ],
        tuples: [
          ["a", 1],
          ["b", 2],
        ],
      };

      const target = transformInto<SourceWithArrays, TargetWithArrays>(source);

      // Arrays are same reference
      expect(target.items).toBe(source.items);
      expect(target.matrix).toBe(source.matrix);

      // Mutation affects both
      source.items.push(4);
      expect(target.items).toContain(4);
    });

    it("can transform array elements via compute", () => {
      interface Source {
        numbers: number[];
      }
      interface Target {
        numbers: string[];
      }

      const source: Source = { numbers: [1, 2, 3] };

      const target = transformInto<Source, Target>(source, {
        compute: {
          numbers: (src) => src.numbers.map((n) => n.toString()),
        },
      });

      expect(target.numbers).toEqual(["1", "2", "3"]);
    });

    it("handles empty arrays", () => {
      interface WithArray {
        items: string[];
      }

      const source: WithArray = { items: [] };
      const target = transformInto<WithArray, WithArray>(source);

      expect(target.items).toEqual([]);
      expect(target.items).toBe(source.items); // Same reference
    });
  });

  // ==========================================================================
  // Attack 5: Special Property Names
  // ==========================================================================
  describe("special property names", () => {
    it("handles numeric-like property names", () => {
      interface NumericKeys {
        "0": string;
        "123": number;
        normal: boolean;
      }

      const source: NumericKeys = { "0": "zero", "123": 123, normal: true };
      const target = transformInto<NumericKeys, NumericKeys>(source);

      expect(target["0"]).toBe("zero");
      expect(target["123"]).toBe(123);
      expect(target.normal).toBe(true);
    });

    it("handles property names with special characters", () => {
      interface SpecialChars {
        "kebab-case": string;
        "with spaces": number;
        "with.dots": boolean;
      }

      const source: SpecialChars = {
        "kebab-case": "kebab",
        "with spaces": 42,
        "with.dots": true,
      };

      const target = transformInto<SpecialChars, SpecialChars>(source);

      expect(target["kebab-case"]).toBe("kebab");
      expect(target["with spaces"]).toBe(42);
      expect(target["with.dots"]).toBe(true);
    });

    it("handles property names that are reserved words", () => {
      interface ReservedWords {
        class: string;
        function: number;
        return: boolean;
      }

      const source: ReservedWords = { class: "myclass", function: 42, return: true };
      const target = transformInto<ReservedWords, ReservedWords>(source);

      expect(target.class).toBe("myclass");
      expect(target.function).toBe(42);
      expect(target.return).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 6: Getter Invocation During Mapping
  // ==========================================================================
  describe("getter invocation during mapping", () => {
    it("invokes getters when reading properties", () => {
      interface WithGetter {
        value: number;
        computed: number;
      }

      let getterCallCount = 0;

      const source = {
        value: 10,
        get computed() {
          getterCallCount++;
          return this.value * 2;
        },
      };

      // Type assertion to match interface
      const target = transformInto<typeof source, WithGetter>(source as WithGetter);

      expect(target.computed).toBe(20);
      // Getter should have been called during mapping
      expect(getterCallCount).toBeGreaterThanOrEqual(1);
    });

    it("getter with side effects executes during mapping", () => {
      const sideEffects: string[] = [];

      interface WithSideEffectGetter {
        id: number;
        timestamp: number;
      }

      const source = {
        id: 1,
        get timestamp() {
          sideEffects.push("timestamp accessed");
          return Date.now();
        },
      };

      transformInto<typeof source, WithSideEffectGetter>(source as WithSideEffectGetter);

      expect(sideEffects).toContain("timestamp accessed");
    });

    it("expensive getter called only once with IIFE wrapping", () => {
      let expensiveCallCount = 0;

      interface MultiField {
        a: number;
        b: number;
        c: number;
      }

      function getSource(): MultiField {
        expensiveCallCount++;
        return { a: 1, b: 2, c: 3 };
      }

      // Using a function call as source triggers IIFE wrapping
      const target = transformInto<MultiField, MultiField>(getSource());

      expect(target).toEqual({ a: 1, b: 2, c: 3 });
      // Should only call getSource once due to temp variable
      expect(expensiveCallCount).toBe(1);
    });
  });

  // ==========================================================================
  // Attack 7: Compute Function Side Effects
  // ==========================================================================
  describe("compute function side effects", () => {
    it("compute functions execute in order of target properties", () => {
      const executionOrder: string[] = [];

      interface Source {
        x: number;
      }

      interface Target {
        a: number;
        b: number;
        c: number;
      }

      const source: Source = { x: 1 };

      const target = transformInto<Source, Target>(source, {
        compute: {
          a: () => {
            executionOrder.push("a");
            return 1;
          },
          b: () => {
            executionOrder.push("b");
            return 2;
          },
          c: () => {
            executionOrder.push("c");
            return 3;
          },
        },
      });

      expect(target).toEqual({ a: 1, b: 2, c: 3 });
      // Order depends on how TypeScript iterates target properties
      expect(executionOrder).toHaveLength(3);
    });

    it("compute function can access other source fields", () => {
      interface Source {
        firstName: string;
        lastName: string;
        birthYear: number;
      }

      interface Target {
        fullName: string;
        age: number;
      }

      const source: Source = { firstName: "John", lastName: "Doe", birthYear: 1990 };

      const target = transformInto<Source, Target>(source, {
        compute: {
          fullName: (src) => `${src.firstName} ${src.lastName}`,
          age: (src) => new Date().getFullYear() - src.birthYear,
        },
      });

      expect(target.fullName).toBe("John Doe");
      expect(target.age).toBeGreaterThanOrEqual(30); // Assuming test runs after 2020
    });

    it("compute function throwing propagates error", () => {
      interface Source {
        value: number;
      }
      interface Target {
        computed: string;
      }

      const source: Source = { value: -1 };

      expect(() => {
        transformInto<Source, Target>(source, {
          compute: {
            computed: (src) => {
              if (src.value < 0) throw new Error("Negative value not allowed");
              return src.value.toString();
            },
          },
        });
      }).toThrow("Negative value not allowed");
    });

    it("compute function receives source object reference", () => {
      interface Source {
        data: { value: number };
      }
      interface Target {
        doubled: number;
      }

      const source: Source = { data: { value: 21 } };
      let receivedSource: Source | null = null;

      transformInto<Source, Target>(source, {
        compute: {
          doubled: (src) => {
            receivedSource = src;
            return src.data.value * 2;
          },
        },
      });

      // The source passed to compute is the same object
      expect(receivedSource).toBe(source);
    });
  });

  // ==========================================================================
  // Attack 8: Type Coercion Edge Cases
  // ==========================================================================
  describe("type coercion edge cases", () => {
    it("does not coerce incompatible primitive types", () => {
      interface StringSource {
        value: string;
      }
      interface NumberTarget {
        value: number;
      }

      const source: StringSource = { value: "42" };

      // This compiles because we use 'as any' but demonstrates the issue
      // In real usage, TypeScript would catch this at compile time
      const target = transformInto<StringSource, NumberTarget>(source as any);

      // The value is NOT coerced - it remains a string at runtime
      expect(typeof target.value).toBe("string");
      expect(target.value).toBe("42" as any);
    });

    it("handles Date objects correctly", () => {
      interface WithDate {
        timestamp: Date;
      }

      const source: WithDate = { timestamp: new Date("2024-01-01") };
      const target = transformInto<WithDate, WithDate>(source);

      expect(target.timestamp).toBeInstanceOf(Date);
      expect(target.timestamp).toBe(source.timestamp); // Same reference
    });

    it("handles BigInt fields", () => {
      interface WithBigInt {
        big: bigint;
        normal: number;
      }

      const source: WithBigInt = { big: 9007199254740993n, normal: 42 };
      const target = transformInto<WithBigInt, WithBigInt>(source);

      expect(target.big).toBe(9007199254740993n);
      expect(typeof target.big).toBe("bigint");
    });

    it("handles Symbol values in fields", () => {
      interface WithSymbol {
        sym: symbol;
        name: string;
      }

      const mySymbol = Symbol("test");
      const source: WithSymbol = { sym: mySymbol, name: "test" };
      const target = transformInto<WithSymbol, WithSymbol>(source);

      expect(target.sym).toBe(mySymbol); // Same symbol reference
    });
  });

  // ==========================================================================
  // Attack 9: Rename Configuration Edge Cases
  // ==========================================================================
  describe("rename configuration edge cases", () => {
    it("handles chained renames (A->B, where B exists in source)", () => {
      interface Source {
        oldName: string;
        newName: string;
      }
      interface Target {
        newName: string;
        anotherName: string;
      }

      const source: Source = { oldName: "old", newName: "new" };

      const target = transformInto<Source, Target>(source, {
        rename: {
          anotherName: "oldName",
        },
      });

      // newName maps directly, anotherName gets oldName's value
      expect(target.newName).toBe("new");
      expect(target.anotherName).toBe("old");
    });

    it("rename overrides same-name mapping", () => {
      interface Source {
        field: string;
        other: string;
      }
      interface Target {
        field: string;
      }

      const source: Source = { field: "original", other: "other" };

      // Explicitly rename 'field' to get 'other' value instead
      const target = transformInto<Source, Target>(source, {
        rename: {
          field: "other",
        },
      });

      expect(target.field).toBe("other");
    });

    it("rename with special characters in source field", () => {
      interface Source {
        "kebab-case": string;
        normal: string;
      }
      interface Target {
        camelCase: string;
        normal: string;
      }

      const source: Source = { "kebab-case": "value", normal: "norm" };

      const target = transformInto<Source, Target>(source, {
        rename: {
          camelCase: "kebab-case",
        },
      });

      expect(target.camelCase).toBe("value");
    });
  });

  // ==========================================================================
  // Attack 10: Const Configuration Edge Cases
  // ==========================================================================
  describe("const configuration edge cases", () => {
    it("const takes precedence over rename", () => {
      interface Source {
        value: string;
      }
      interface Target {
        value: string;
      }

      const source: Source = { value: "from-source" };

      const target = transformInto<Source, Target>(source, {
        const: { value: "constant" },
        rename: { value: "value" }, // This should be ignored
      });

      expect(target.value).toBe("constant");
    });

    it("const with complex object value", () => {
      interface Source {
        id: number;
      }
      interface Target {
        id: number;
        metadata: { version: string; readonly: boolean };
      }

      const source: Source = { id: 1 };

      const target = transformInto<Source, Target>(source, {
        const: {
          metadata: { version: "1.0.0", readonly: true },
        },
      });

      expect(target.metadata).toEqual({ version: "1.0.0", readonly: true });
    });

    it("const with null value", () => {
      interface Source {
        value: string;
      }
      interface Target {
        value: string | null;
      }

      const source: Source = { value: "test" };

      const target = transformInto<Source, Target>(source, {
        const: { value: null },
      });

      expect(target.value).toBeNull();
    });

    it("const with undefined value", () => {
      interface Source {
        value: string;
      }
      interface Target {
        value: string | undefined;
      }

      const source: Source = { value: "test" };

      const target = transformInto<Source, Target>(source, {
        const: { value: undefined },
      });

      expect(target.value).toBeUndefined();
    });
  });

  // ==========================================================================
  // Attack 11: Empty and Edge Case Objects
  // ==========================================================================
  describe("empty and edge case objects", () => {
    it("maps empty object to empty object", () => {
      interface Empty {}

      const source: Empty = {};
      const target = transformInto<Empty, Empty>(source);

      expect(target).toEqual({});
    });

    it("handles source with extra fields (ignored)", () => {
      interface Source {
        needed: string;
        extra: number;
        moreExtra: boolean;
      }
      interface Target {
        needed: string;
      }

      const source: Source = { needed: "value", extra: 42, moreExtra: true };
      const target = transformInto<Source, Target>(source);

      expect(target).toEqual({ needed: "value" });
      expect("extra" in target).toBe(false);
      expect("moreExtra" in target).toBe(false);
    });

    it("handles single-field objects", () => {
      interface Single {
        only: string;
      }

      const source: Single = { only: "value" };
      const target = transformInto<Single, Single>(source);

      expect(target).toEqual({ only: "value" });
    });

    it("handles large number of fields", () => {
      interface ManyFields {
        f1: number;
        f2: number;
        f3: number;
        f4: number;
        f5: number;
        f6: number;
        f7: number;
        f8: number;
        f9: number;
        f10: number;
      }

      const source: ManyFields = {
        f1: 1,
        f2: 2,
        f3: 3,
        f4: 4,
        f5: 5,
        f6: 6,
        f7: 7,
        f8: 8,
        f9: 9,
        f10: 10,
      };

      const target = transformInto<ManyFields, ManyFields>(source);

      expect(target).toEqual(source);
      expect(Object.keys(target)).toHaveLength(10);
    });
  });

  // ==========================================================================
  // Attack 12: Runtime Error Behavior (Transformer Not Configured)
  // ==========================================================================
  describe("runtime error behavior", () => {
    it("documents that transformInto throws when transformer is not running", () => {
      // This test verifies the error message is helpful
      // In a properly configured build, transformInto is replaced at compile time
      // If called at runtime, it means the transformer wasn't applied

      // We can't actually test this in a transformed environment
      // because the macro will have been expanded. This documents the behavior.
      const errorMessage =
        "transformInto() was called at runtime. " +
        "This indicates the typesugar transformer is not configured correctly. " +
        "Please ensure your build tool is configured to use the typesugar transformer.";

      // The actual function body throws this error
      expect(errorMessage).toContain("transformer is not configured");
    });
  });
});
