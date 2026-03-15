/**
 * Package-level tests for @typesugar/reflect
 *
 * Tests that exports exist with correct types and that the
 * TypeInfo/FieldInfo/MethodInfo structures work as expected.
 *
 * Note: Full macro expansion tests are in the root tests/reflect.test.ts
 * since they require the transformer.
 */
import { describe, it, expect } from "vitest";
import {
  reflect,
  typeInfo,
  fieldNames,
  validator,
  reflectAttribute,
  typeInfoMacro,
  fieldNamesMacro,
  validatorMacro,
  type TypeInfo,
  type FieldInfo,
  type MethodInfo,
  type ParameterInfo,
  type ValidationResult,
} from "../src/index";

describe("@typesugar/reflect exports", () => {
  describe("runtime stubs", () => {
    it("exports reflect decorator stub", () => {
      expect(reflect).toBeDefined();
      expect(typeof reflect).toBe("function");
    });

    it("exports typeInfo stub", () => {
      expect(typeInfo).toBeDefined();
      expect(typeof typeInfo).toBe("function");
    });

    it("exports fieldNames stub", () => {
      expect(fieldNames).toBeDefined();
      expect(typeof fieldNames).toBe("function");
    });

    it("exports validator stub", () => {
      expect(validator).toBeDefined();
      expect(typeof validator).toBe("function");
    });
  });

  describe("macro definitions", () => {
    it("exports reflectAttribute macro", () => {
      expect(reflectAttribute).toBeDefined();
      expect(reflectAttribute.name).toBe("reflect");
    });

    it("exports typeInfoMacro", () => {
      expect(typeInfoMacro).toBeDefined();
      expect(typeInfoMacro.name).toBe("typeInfo");
    });

    it("exports fieldNamesMacro", () => {
      expect(fieldNamesMacro).toBeDefined();
      expect(fieldNamesMacro.name).toBe("fieldNames");
    });

    it("exports validatorMacro", () => {
      expect(validatorMacro).toBeDefined();
      expect(validatorMacro.name).toBe("validator");
    });
  });
});

describe("TypeInfo structure", () => {
  it("accepts valid interface TypeInfo", () => {
    const info: TypeInfo = {
      name: "User",
      kind: "interface",
      fields: [
        { name: "id", type: "number", optional: false, readonly: false },
        { name: "name", type: "string", optional: false, readonly: false },
      ],
      methods: [],
      typeParameters: [],
    };

    expect(info.name).toBe("User");
    expect(info.kind).toBe("interface");
    expect(info.fields).toHaveLength(2);
  });

  it("accepts valid class TypeInfo with methods", () => {
    const info: TypeInfo = {
      name: "Calculator",
      kind: "class",
      fields: [{ name: "value", type: "number", optional: false, readonly: false }],
      methods: [
        {
          name: "add",
          parameters: [{ name: "n", type: "number", optional: false }],
          returnType: "Calculator",
          isAsync: false,
          isStatic: false,
        },
      ],
      typeParameters: [],
    };

    expect(info.kind).toBe("class");
    expect(info.methods).toHaveLength(1);
    expect(info.methods![0].name).toBe("add");
  });

  it("supports all type kinds", () => {
    const kinds: TypeInfo["kind"][] = [
      "interface",
      "class",
      "type",
      "enum",
      "primitive",
      "union",
      "intersection",
      "array",
      "tuple",
      "function",
    ];

    for (const kind of kinds) {
      const info: TypeInfo = { name: "Test", kind };
      expect(info.kind).toBe(kind);
    }
  });

  it("captures type parameters", () => {
    const info: TypeInfo = {
      name: "Result",
      kind: "type",
      typeParameters: ["T", "E"],
    };

    expect(info.typeParameters).toEqual(["T", "E"]);
  });

  it("captures extends clause", () => {
    const info: TypeInfo = {
      name: "Admin",
      kind: "interface",
      extends: ["User", "Permissions"],
    };

    expect(info.extends).toEqual(["User", "Permissions"]);
  });
});

describe("FieldInfo structure", () => {
  it("represents required fields", () => {
    const field: FieldInfo = {
      name: "id",
      type: "number",
      optional: false,
      readonly: false,
    };

    expect(field.optional).toBe(false);
  });

  it("represents optional fields", () => {
    const field: FieldInfo = {
      name: "nickname",
      type: "string",
      optional: true,
      readonly: false,
    };

    expect(field.optional).toBe(true);
  });

  it("represents readonly fields", () => {
    const field: FieldInfo = {
      name: "createdAt",
      type: "Date",
      optional: false,
      readonly: true,
    };

    expect(field.readonly).toBe(true);
  });

  it("supports default values", () => {
    const field: FieldInfo = {
      name: "count",
      type: "number",
      optional: false,
      readonly: false,
      defaultValue: "0",
    };

    expect(field.defaultValue).toBe("0");
  });
});

describe("MethodInfo structure", () => {
  it("represents method with no parameters", () => {
    const method: MethodInfo = {
      name: "toString",
      parameters: [],
      returnType: "string",
      isAsync: false,
      isStatic: false,
    };

    expect(method.parameters).toHaveLength(0);
    expect(method.returnType).toBe("string");
  });

  it("represents method with parameters", () => {
    const method: MethodInfo = {
      name: "between",
      parameters: [
        { name: "min", type: "number", optional: false },
        { name: "max", type: "number", optional: false },
      ],
      returnType: "boolean",
      isAsync: false,
      isStatic: false,
    };

    expect(method.parameters).toHaveLength(2);
    expect(method.parameters[0].name).toBe("min");
  });

  it("represents async method", () => {
    const method: MethodInfo = {
      name: "fetch",
      parameters: [{ name: "url", type: "string", optional: false }],
      returnType: "Promise<Response>",
      isAsync: true,
      isStatic: false,
    };

    expect(method.isAsync).toBe(true);
  });

  it("represents static method", () => {
    const method: MethodInfo = {
      name: "create",
      parameters: [],
      returnType: "Instance",
      isAsync: false,
      isStatic: true,
    };

    expect(method.isStatic).toBe(true);
  });
});

describe("ParameterInfo structure", () => {
  it("represents required parameter", () => {
    const param: ParameterInfo = {
      name: "value",
      type: "string",
      optional: false,
    };

    expect(param.optional).toBe(false);
  });

  it("represents optional parameter", () => {
    const param: ParameterInfo = {
      name: "options",
      type: "Options",
      optional: true,
    };

    expect(param.optional).toBe(true);
  });

  it("supports default values", () => {
    const param: ParameterInfo = {
      name: "count",
      type: "number",
      optional: true,
      defaultValue: "10",
    };

    expect(param.defaultValue).toBe("10");
  });
});

describe("ValidationResult type", () => {
  it("represents success", () => {
    const result: ValidationResult<{ name: string }> = {
      success: true,
      value: { name: "test" },
    };

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.name).toBe("test");
    }
  });

  it("represents failure", () => {
    const result: ValidationResult<unknown> = {
      success: false,
      errors: ["Invalid type for field 'id': expected number"],
    };

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toHaveLength(1);
    }
  });
});

describe("fieldNames utility pattern", () => {
  it("extracts field names from TypeInfo", () => {
    const info: TypeInfo = {
      name: "User",
      kind: "interface",
      fields: [
        { name: "id", type: "number", optional: false, readonly: false },
        { name: "name", type: "string", optional: false, readonly: false },
        { name: "email", type: "string", optional: true, readonly: false },
      ],
    };

    const names = info.fields!.map((f) => f.name);
    expect(names).toEqual(["id", "name", "email"]);
  });
});

describe("validator utility pattern", () => {
  it("validates objects against TypeInfo", () => {
    const userInfo: TypeInfo = {
      name: "User",
      kind: "interface",
      fields: [
        { name: "id", type: "number", optional: false, readonly: false },
        { name: "name", type: "string", optional: false, readonly: false },
      ],
    };

    const validate = (obj: Record<string, unknown>, info: TypeInfo): boolean => {
      for (const field of info.fields ?? []) {
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

    expect(validate({ id: 1, name: "John" }, userInfo)).toBe(true);
    expect(validate({ id: "1", name: "John" }, userInfo)).toBe(false);
    expect(validate({ name: "John" }, userInfo)).toBe(false);
  });
});
