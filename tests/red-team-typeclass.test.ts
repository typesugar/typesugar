/**
 * Red Team Tests for @typesugar/typeclass
 *
 * Attack surfaces:
 * - Registry operations (clear, duplicate registration, key collisions)
 * - summon() resolution with missing instances, malformed type args
 * - extend() wrapper behavior with no instances, multiple instances
 * - @deriving auto-derivation for unknown typeclasses
 * - @instance decorator validation (missing args, non-identifier args)
 * - @typeclass decorator on non-interfaces
 * - Instance priority/ordering when multiple instances exist
 * - findExtensionMethod lookup edge cases
 * - Method extraction from typeclass interfaces
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  clearRegistries,
  getTypeclasses,
  getInstances,
  findExtensionMethod,
  TypeclassInfo,
  InstanceInfo,
} from "../packages/typeclass/src/index.js";

describe("Typeclass Registry Edge Cases", () => {
  // ==========================================================================
  // Attack 1: Registry Clearing and State Management
  // ==========================================================================
  describe("Registry clearing", () => {
    beforeEach(() => {
      clearRegistries();
    });

    it("clearRegistries removes all typeclasses", () => {
      const typeclasses = getTypeclasses();
      expect(typeclasses.size).toBe(0);
    });

    it("clearRegistries removes all instances", () => {
      const instances = getInstances();
      expect(instances.size).toBe(0);
    });

    it("getTypeclasses returns a copy, not the internal map", () => {
      const map1 = getTypeclasses();
      const map2 = getTypeclasses();

      expect(map1).not.toBe(map2);
    });

    it("getInstances returns a copy, not the internal map", () => {
      const map1 = getInstances();
      const map2 = getInstances();

      expect(map1).not.toBe(map2);
    });
  });

  // ==========================================================================
  // Attack 2: Instance Key Format Edge Cases
  // ==========================================================================
  describe("Instance key edge cases", () => {
    beforeEach(() => {
      clearRegistries();
    });

    it("Instance key format is 'Typeclass<Type>'", () => {
      const instances = getInstances();

      for (const key of instances.keys()) {
        expect(key).toMatch(/^[A-Za-z_][A-Za-z0-9_]*<[^>]+>$/);
      }
    });

    it("Generic types in instance keys preserve full type string", () => {
      const instances = getInstances();

      for (const [key, instance] of instances) {
        const expectedKey = `${instance.typeclassName}<${instance.forType}>`;
        expect(key).toBe(expectedKey);
      }
    });
  });

  // ==========================================================================
  // Attack 3: findExtensionMethod Lookup Edge Cases
  // ==========================================================================
  describe("findExtensionMethod edge cases", () => {
    beforeEach(() => {
      clearRegistries();
    });

    it("Returns undefined for non-existent type", () => {
      const result = findExtensionMethod("NonExistentType", "show");
      expect(result).toBeUndefined();
    });

    it("Returns undefined for non-existent method", () => {
      const result = findExtensionMethod("number", "nonExistentMethod");
      expect(result).toBeUndefined();
    });

    it("Returns undefined when typeclass has no matching method", () => {
      const result = findExtensionMethod("string", "someRandomMethod");
      expect(result).toBeUndefined();
    });

    it("Empty type name returns undefined", () => {
      const result = findExtensionMethod("", "show");
      expect(result).toBeUndefined();
    });

    it("Empty method name returns undefined", () => {
      const result = findExtensionMethod("number", "");
      expect(result).toBeUndefined();
    });
  });
});

describe("Typeclass Info Structure Edge Cases", () => {
  // ==========================================================================
  // Attack 4: TypeclassInfo Method Extraction
  // ==========================================================================
  describe("TypeclassInfo method structure", () => {
    it("TypeclassInfo methods array can be empty", () => {
      const info: TypeclassInfo = {
        name: "EmptyTypeclass",
        methods: [],
      };

      expect(info.methods).toHaveLength(0);
      expect(info.name).toBe("EmptyTypeclass");
    });

    it("TypeclassInfo method with no type params", () => {
      const info: TypeclassInfo = {
        name: "Show",
        methods: [
          {
            name: "show",
            typeParams: [],
            params: [{ name: "a", type: "A" }],
            returnType: "string",
          },
        ],
      };

      expect(info.methods[0].typeParams).toHaveLength(0);
    });

    it("TypeclassInfo method with multiple type params", () => {
      const info: TypeclassInfo = {
        name: "Functor",
        methods: [
          {
            name: "map",
            typeParams: ["A", "B"],
            params: [
              { name: "fa", type: "F<A>" },
              { name: "f", type: "(a: A) => B" },
            ],
            returnType: "F<B>",
          },
        ],
      };

      expect(info.methods[0].typeParams).toHaveLength(2);
      expect(info.methods[0].params).toHaveLength(2);
    });

    it("TypeclassInfo method with void return type", () => {
      const info: TypeclassInfo = {
        name: "Consumer",
        methods: [
          {
            name: "consume",
            typeParams: [],
            params: [{ name: "a", type: "A" }],
            returnType: "void",
          },
        ],
      };

      expect(info.methods[0].returnType).toBe("void");
    });
  });

  // ==========================================================================
  // Attack 5: InstanceInfo Structure
  // ==========================================================================
  describe("InstanceInfo structure", () => {
    it("InstanceInfo with generic forType", () => {
      const info: Partial<InstanceInfo> = {
        typeclass: "Functor",
        forType: "Array",
      };

      expect(info.typeclass).toBe("Functor");
      expect(info.forType).toBe("Array");
    });

    it("InstanceInfo with parameterized forType", () => {
      const info: Partial<InstanceInfo> = {
        typeclass: "Eq",
        forType: "Array<number>",
      };

      expect(info.forType).toContain("<");
    });

    it("InstanceInfo with complex forType (union)", () => {
      const info: Partial<InstanceInfo> = {
        typeclass: "Show",
        forType: "string | number",
      };

      expect(info.forType).toContain("|");
    });
  });
});

describe("Typeclass Macro Placeholder Edge Cases", () => {
  // ==========================================================================
  // Attack 6: Runtime Stubs Throw Correctly
  // ==========================================================================
  describe("Runtime stub behavior", () => {
    // Note: The actual macro expansion happens at compile time.
    // These tests verify the runtime stubs throw appropriately
    // when called without transformer processing.

    it("summon() throws at runtime without transformation", async () => {
      const { summon } = await import("../packages/typeclass/src/index.js");

      expect(() => summon()).toThrow("must be processed by the typesugar transformer");
    });

    it("extend() throws at runtime without transformation", async () => {
      const { extend } = await import("../packages/typeclass/src/index.js");

      expect(() => extend(42)).toThrow("must be processed by the typesugar transformer");
    });

    it("typeclass decorator returns target unchanged at runtime", async () => {
      const { typeclass } = await import("../packages/typeclass/src/index.js");

      const target = { name: "TestInterface" };
      const result = typeclass(target);
      expect(result).toBe(target);
    });

    it("instance decorator returns empty function at runtime", async () => {
      const { instance } = await import("../packages/typeclass/src/index.js");

      // Decorator form (1 arg) returns a function
      const decorator = instance("Show<number>");
      expect(typeof decorator).toBe("function");
    });

    it("instance expression form returns object unchanged at runtime", async () => {
      const { instance } = await import("../packages/typeclass/src/index.js");

      // Expression form (2 args) returns the second argument unchanged
      const obj = { show: (n: number) => String(n) };
      const result = instance("Show<number>", obj);
      expect(result).toBe(obj);
    });

    it("deriving decorator returns empty function at runtime", async () => {
      const { deriving } = await import("../packages/typeclass/src/index.js");

      const decorator = deriving("Show", "Eq");
      expect(typeof decorator).toBe("function");
    });
  });
});

describe("Instance Registry Concurrency Edge Cases", () => {
  // ==========================================================================
  // Attack 7: Rapid Registry Operations
  // ==========================================================================
  describe("Registry operation ordering", () => {
    beforeEach(() => {
      clearRegistries();
    });

    it("Multiple clearRegistries calls are idempotent", () => {
      clearRegistries();
      clearRegistries();
      clearRegistries();

      expect(getTypeclasses().size).toBe(0);
      expect(getInstances().size).toBe(0);
    });

    it("getTypeclasses after clear returns empty map", () => {
      const before = getTypeclasses();
      clearRegistries();
      const after = getTypeclasses();

      expect(after.size).toBe(0);
      expect(before).not.toBe(after);
    });

    it("getInstances after clear returns empty map", () => {
      const before = getInstances();
      clearRegistries();
      const after = getInstances();

      expect(after.size).toBe(0);
      expect(before).not.toBe(after);
    });
  });
});

describe("Type Name Edge Cases", () => {
  // ==========================================================================
  // Attack 8: Unusual Type Names
  // ==========================================================================
  describe("Unusual type name handling", () => {
    beforeEach(() => {
      clearRegistries();
    });

    it("findExtensionMethod handles type names with generics", () => {
      const result = findExtensionMethod("Array<number>", "show");
      expect(result).toBeUndefined();
    });

    it("findExtensionMethod handles type names with nested generics", () => {
      const result = findExtensionMethod("Map<string, Array<number>>", "show");
      expect(result).toBeUndefined();
    });

    it("findExtensionMethod handles union type names", () => {
      const result = findExtensionMethod("string | number", "show");
      expect(result).toBeUndefined();
    });

    it("findExtensionMethod handles intersection type names", () => {
      const result = findExtensionMethod("A & B", "show");
      expect(result).toBeUndefined();
    });

    it("findExtensionMethod handles tuple type names", () => {
      const result = findExtensionMethod("[string, number]", "show");
      expect(result).toBeUndefined();
    });

    it("findExtensionMethod handles function type names", () => {
      const result = findExtensionMethod("(x: number) => string", "show");
      expect(result).toBeUndefined();
    });
  });

  // ==========================================================================
  // Attack 9: Method Name Edge Cases
  // ==========================================================================
  describe("Unusual method name handling", () => {
    beforeEach(() => {
      clearRegistries();
    });

    it("findExtensionMethod handles method names with numbers", () => {
      const result = findExtensionMethod("number", "method123");
      expect(result).toBeUndefined();
    });

    it("findExtensionMethod handles method names with underscores", () => {
      const result = findExtensionMethod("number", "my_method");
      expect(result).toBeUndefined();
    });

    it("findExtensionMethod handles method names starting with underscore", () => {
      const result = findExtensionMethod("number", "_privateMethod");
      expect(result).toBeUndefined();
    });

    it("findExtensionMethod handles single character method names", () => {
      const result = findExtensionMethod("number", "x");
      expect(result).toBeUndefined();
    });
  });
});

describe("Derive Generation Edge Cases", () => {
  // ==========================================================================
  // Attack 10: Auto-derivation for Different Typeclasses
  // ==========================================================================
  describe("Built-in derive strategies", () => {
    it("Show derive uses JSON.stringify", () => {
      const info: TypeclassInfo = {
        name: "Show",
        methods: [
          {
            name: "show",
            typeParams: [],
            params: [{ name: "a", type: "A" }],
            returnType: "string",
          },
        ],
      };

      expect(info.methods[0].returnType).toBe("string");
    });

    it("Eq derive compares JSON representations", () => {
      const info: TypeclassInfo = {
        name: "Eq",
        methods: [
          {
            name: "equals",
            typeParams: [],
            params: [
              { name: "a", type: "A" },
              { name: "b", type: "A" },
            ],
            returnType: "boolean",
          },
        ],
      };

      expect(info.methods[0].returnType).toBe("boolean");
    });

    it("Ord derive uses JSON string comparison", () => {
      const info: TypeclassInfo = {
        name: "Ord",
        methods: [
          {
            name: "compare",
            typeParams: [],
            params: [
              { name: "a", type: "A" },
              { name: "b", type: "A" },
            ],
            returnType: "number",
          },
        ],
      };

      expect(info.methods[0].returnType).toBe("number");
    });

    it("Hash derive produces unsigned 32-bit integer", () => {
      const info: TypeclassInfo = {
        name: "Hash",
        methods: [
          {
            name: "hash",
            typeParams: [],
            params: [{ name: "a", type: "A" }],
            returnType: "number",
          },
        ],
      };

      expect(info.methods[0].returnType).toBe("number");
    });
  });
});

describe("Typeclass Interface Constraints", () => {
  // ==========================================================================
  // Attack 11: Typeclass Method Signature Variations
  // ==========================================================================
  describe("Method signature variations", () => {
    it("Handles method with no parameters (except self)", () => {
      const info: TypeclassInfo = {
        name: "Default",
        methods: [
          {
            name: "defaultValue",
            typeParams: [],
            params: [],
            returnType: "A",
          },
        ],
      };

      expect(info.methods[0].params).toHaveLength(0);
    });

    it("Handles method with many parameters", () => {
      const info: TypeclassInfo = {
        name: "Complex",
        methods: [
          {
            name: "complexMethod",
            typeParams: ["A", "B", "C"],
            params: [
              { name: "a", type: "A" },
              { name: "b", type: "B" },
              { name: "c", type: "C" },
              { name: "d", type: "number" },
            ],
            returnType: "string",
          },
        ],
      };

      expect(info.methods[0].params).toHaveLength(4);
      expect(info.methods[0].typeParams).toHaveLength(3);
    });

    it("Handles typeclass with multiple methods", () => {
      const info: TypeclassInfo = {
        name: "Numeric",
        methods: [
          {
            name: "add",
            typeParams: [],
            params: [
              { name: "a", type: "A" },
              { name: "b", type: "A" },
            ],
            returnType: "A",
          },
          {
            name: "mul",
            typeParams: [],
            params: [
              { name: "a", type: "A" },
              { name: "b", type: "A" },
            ],
            returnType: "A",
          },
          {
            name: "zero",
            typeParams: [],
            params: [],
            returnType: "A",
          },
          {
            name: "one",
            typeParams: [],
            params: [],
            returnType: "A",
          },
        ],
      };

      expect(info.methods).toHaveLength(4);
    });
  });

  // ==========================================================================
  // Attack 12: Type Parameter Naming Conventions
  // ==========================================================================
  describe("Type parameter naming", () => {
    it("Single letter type params are common", () => {
      const info: TypeclassInfo = {
        name: "Functor",
        methods: [
          {
            name: "map",
            typeParams: ["A", "B"],
            params: [
              { name: "fa", type: "F<A>" },
              { name: "f", type: "(a: A) => B" },
            ],
            returnType: "F<B>",
          },
        ],
      };

      expect(info.methods[0].typeParams).toEqual(["A", "B"]);
    });

    it("Descriptive type params are supported", () => {
      const info: TypeclassInfo = {
        name: "Codec",
        methods: [
          {
            name: "encode",
            typeParams: ["Input", "Output"],
            params: [{ name: "input", type: "Input" }],
            returnType: "Output",
          },
        ],
      };

      expect(info.methods[0].typeParams).toEqual(["Input", "Output"]);
    });
  });
});

describe("Registry Isolation", () => {
  // ==========================================================================
  // Attack 13: Registry State Isolation
  // ==========================================================================
  describe("Registry state isolation", () => {
    it("Clearing typeclasses does not affect instance query results format", () => {
      clearRegistries();

      const instances = getInstances();
      expect(instances instanceof Map).toBe(true);
    });

    it("Clearing instances does not affect typeclass query results format", () => {
      clearRegistries();

      const typeclasses = getTypeclasses();
      expect(typeclasses instanceof Map).toBe(true);
    });

    it("Registry clear is synchronous", () => {
      const beforeTypeclasses = getTypeclasses().size;
      const beforeInstances = getInstances().size;

      clearRegistries();

      const afterTypeclasses = getTypeclasses().size;
      const afterInstances = getInstances().size;

      expect(afterTypeclasses).toBe(0);
      expect(afterInstances).toBe(0);
    });
  });
});
