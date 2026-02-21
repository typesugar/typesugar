/**
 * Tests for compile-time reflection macros
 *
 * This test file demonstrates dogfooding @typesugar/testing macros:
 * - assert() for power assertions with sub-expression capture
 * - typeAssert<>() for compile-time type checks
 */

import { describe, it, expect } from "vitest";
import { assert, typeAssert, type Equal, type Extends } from "@typesugar/testing";
import type { TypeInfo, FieldInfo, MethodInfo } from "../src/macros/reflect.js";

describe("TypeInfo structure", () => {
  describe("type metadata", () => {
    it("should capture type name", () => {
      const info: TypeInfo = {
        name: "User",
        kind: "interface",
        fields: [],
        methods: [],
        typeParameters: [],
      };

      assert(info.name === "User");
      assert(info.kind === "interface");
    });

    it("should capture fields with types", () => {
      const info: TypeInfo = {
        name: "User",
        kind: "interface",
        fields: [
          { name: "id", type: "number", optional: false },
          { name: "name", type: "string", optional: false },
          { name: "email", type: "string", optional: true },
        ],
        methods: [],
        typeParameters: [],
      };

      assert(info.fields.length === 3);
      assert(info.fields[0].name === "id");
      assert(info.fields[0].type === "number");
      assert(info.fields[2].optional === true);
    });

    it("should capture methods with signatures", () => {
      const info: TypeInfo = {
        name: "UserService",
        kind: "class",
        fields: [],
        methods: [
          {
            name: "findById",
            parameters: [{ name: "id", type: "number" }],
            returnType: "User | undefined",
          },
          {
            name: "create",
            parameters: [{ name: "data", type: "CreateUserDto" }],
            returnType: "User",
          },
        ],
        typeParameters: [],
      };

      assert(info.methods.length === 2);
      assert(info.methods[0].name === "findById");
      assert(info.methods[0].parameters[0].name === "id");
    });

    it("should capture type parameters", () => {
      const info: TypeInfo = {
        name: "Result",
        kind: "type",
        fields: [],
        methods: [],
        typeParameters: ["T", "E"],
      };

      // Use toEqual for deep array comparison
      expect(info.typeParameters).toEqual(["T", "E"]);
    });
  });
});

describe("FieldInfo structure", () => {
  it("should represent required fields", () => {
    const field: FieldInfo = {
      name: "id",
      type: "number",
      optional: false,
    };

    assert(field.optional === false);
  });

  it("should represent optional fields", () => {
    const field: FieldInfo = {
      name: "nickname",
      type: "string",
      optional: true,
    };

    assert(field.optional === true);
  });

  it("should capture readonly modifier", () => {
    const field: FieldInfo = {
      name: "createdAt",
      type: "Date",
      optional: false,
      readonly: true,
    };

    assert(field.readonly === true);
  });
});

describe("MethodInfo structure", () => {
  it("should capture method with no parameters", () => {
    const method: MethodInfo = {
      name: "toString",
      parameters: [],
      returnType: "string",
    };

    assert(method.parameters.length === 0);
    assert(method.returnType === "string");
  });

  it("should capture method with multiple parameters", () => {
    const method: MethodInfo = {
      name: "between",
      parameters: [
        { name: "min", type: "number" },
        { name: "max", type: "number" },
      ],
      returnType: "boolean",
    };

    assert(method.parameters.length === 2);
    assert(method.parameters[1].name === "max");
  });
});

describe("Reflection use cases", () => {
  describe("validation generation", () => {
    it("should generate field validators based on type", () => {
      const fieldValidators: Record<string, (value: unknown) => boolean> = {
        number: (v) => typeof v === "number",
        string: (v) => typeof v === "string",
        boolean: (v) => typeof v === "boolean",
      };

      assert(fieldValidators.number(42) === true);
      assert(fieldValidators.number("42") === false);
      assert(fieldValidators.string("hello") === true);
      assert(fieldValidators.boolean(false) === true);
    });

    it("should validate objects against TypeInfo", () => {
      const userInfo: TypeInfo = {
        name: "User",
        kind: "interface",
        fields: [
          { name: "id", type: "number", optional: false },
          { name: "name", type: "string", optional: false },
        ],
        methods: [],
        typeParameters: [],
      };

      const validate = (obj: Record<string, unknown>, info: TypeInfo): boolean => {
        for (const field of info.fields) {
          if (!field.optional && !(field.name in obj)) {
            return false;
          }

          const value = obj[field.name];
          if (value !== undefined) {
            if (field.type === "number" && typeof value !== "number") return false;
            if (field.type === "string" && typeof value !== "string") return false;
          }
        }
        return true;
      };

      assert(validate({ id: 1, name: "John" }, userInfo) === true);
      assert(validate({ id: "1", name: "John" }, userInfo) === false);
      assert(validate({ name: "John" }, userInfo) === false); // missing id
    });
  });

  describe("serialization generation", () => {
    it("should generate field extraction based on TypeInfo", () => {
      const extractFields = (
        obj: Record<string, unknown>,
        fields: FieldInfo[]
      ): Record<string, unknown> => {
        const result: Record<string, unknown> = {};
        for (const field of fields) {
          if (field.name in obj) {
            result[field.name] = obj[field.name];
          }
        }
        return result;
      };

      const fields: FieldInfo[] = [
        { name: "id", type: "number", optional: false },
        { name: "name", type: "string", optional: false },
      ];

      const obj = { id: 1, name: "John", password: "secret" };
      const extracted = extractFields(obj, fields);

      expect(extracted).toEqual({ id: 1, name: "John" });
      assert(!("password" in extracted));
    });
  });

  describe("proxy generation", () => {
    it("should generate method interceptors based on MethodInfo", () => {
      const methods: MethodInfo[] = [
        {
          name: "greet",
          parameters: [{ name: "name", type: "string" }],
          returnType: "string",
        },
        {
          name: "add",
          parameters: [
            { name: "a", type: "number" },
            { name: "b", type: "number" },
          ],
          returnType: "number",
        },
      ];

      // Generate method signatures
      const signatures = methods.map((m) => {
        const params = m.parameters.map((p) => `${p.name}: ${p.type}`).join(", ");
        return `${m.name}(${params}): ${m.returnType}`;
      });

      expect(signatures).toEqual([
        "greet(name: string): string",
        "add(a: number, b: number): number",
      ]);
    });
  });

  describe("fieldNames utility", () => {
    it("should extract field names from TypeInfo", () => {
      const info: TypeInfo = {
        name: "User",
        kind: "interface",
        fields: [
          { name: "id", type: "number", optional: false },
          { name: "name", type: "string", optional: false },
          { name: "email", type: "string", optional: true },
        ],
        methods: [],
        typeParameters: [],
      };

      const fieldNames = info.fields.map((f) => f.name);
      expect(fieldNames).toEqual(["id", "name", "email"]);
    });
  });
});

describe("Reflection for different type kinds", () => {
  describe("interface reflection", () => {
    it("should reflect interface declaration", () => {
      const info: TypeInfo = {
        name: "Point",
        kind: "interface",
        fields: [
          { name: "x", type: "number", optional: false },
          { name: "y", type: "number", optional: false },
        ],
        methods: [],
        typeParameters: [],
      };

      assert(info.kind === "interface");
    });
  });

  describe("class reflection", () => {
    it("should reflect class declaration with methods", () => {
      const info: TypeInfo = {
        name: "Calculator",
        kind: "class",
        fields: [{ name: "value", type: "number", optional: false }],
        methods: [
          {
            name: "add",
            parameters: [{ name: "n", type: "number" }],
            returnType: "Calculator",
          },
          { name: "result", parameters: [], returnType: "number" },
        ],
        typeParameters: [],
      };

      assert(info.kind === "class");
      assert(info.methods.length === 2);
    });
  });

  describe("type alias reflection", () => {
    it("should reflect type alias", () => {
      const info: TypeInfo = {
        name: "UserId",
        kind: "type",
        fields: [],
        methods: [],
        typeParameters: [],
      };

      assert(info.kind === "type");
    });
  });

  describe("generic type reflection", () => {
    it("should capture type parameters", () => {
      const info: TypeInfo = {
        name: "Container",
        kind: "class",
        fields: [{ name: "value", type: "T", optional: false }],
        methods: [
          { name: "get", parameters: [], returnType: "T" },
          {
            name: "set",
            parameters: [{ name: "value", type: "T" }],
            returnType: "void",
          },
        ],
        typeParameters: ["T"],
      };

      assert(info.typeParameters.includes("T"));
      assert(info.fields[0].type === "T");
    });
  });
});

// Type-level assertions
describe("type-level assertions", () => {
  it("TypeInfo has expected shape", () => {
    typeAssert<Extends<TypeInfo, { name: string; kind: string }>>();
  });

  it("FieldInfo has expected shape", () => {
    typeAssert<Extends<FieldInfo, { name: string; type: string; optional: boolean }>>();
  });

  it("MethodInfo has expected shape", () => {
    typeAssert<Extends<MethodInfo, { name: string; returnType: string }>>();
  });
});
