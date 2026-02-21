import { describe, expect, it } from "vitest";
import {
  defineSchema,
  fieldsAtVersion,
  generateMigrations,
  validateSchema,
} from "../schema.js";
import type { FieldMeta } from "../types.js";

describe("defineSchema", () => {
  it("creates a schema with defaults", () => {
    const s = defineSchema("Foo", {
      version: 1,
      fields: [{ name: "a", type: "string" }],
    });
    expect(s.name).toBe("Foo");
    expect(s.version).toBe(1);
    expect(s.format).toBe("json");
    expect(s.fields).toHaveLength(1);
  });

  it("respects explicit format", () => {
    const s = defineSchema("Foo", {
      version: 1,
      format: "binary",
      fields: [],
    });
    expect(s.format).toBe("binary");
  });
});

describe("validateSchema", () => {
  it("passes for a valid v1 schema", () => {
    const s = defineSchema("User", {
      version: 1,
      fields: [
        { name: "name", type: "string" },
        { name: "age", type: "number" },
      ],
    });
    expect(validateSchema(s)).toEqual([]);
  });

  it("errors when @since exceeds current version", () => {
    const s = defineSchema("User", {
      version: 2,
      fields: [{ name: "future", type: "string", since: 5, defaultValue: "" }],
    });
    const errors = validateSchema(s);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("future");
    expect(errors[0].message).toContain("exceeds current schema version");
  });

  it("errors when @since is less than 1", () => {
    const s = defineSchema("User", {
      version: 1,
      fields: [{ name: "bad", type: "string", since: 0 }],
    });
    const errors = validateSchema(s);
    expect(errors.some((e) => e.message.includes(">= 1"))).toBe(true);
  });

  it("errors when @removed exceeds current version", () => {
    const s = defineSchema("User", {
      version: 2,
      fields: [{ name: "old", type: "string", removed: 5 }],
    });
    const errors = validateSchema(s);
    expect(errors.some((e) => e.message.includes("exceeds current"))).toBe(
      true,
    );
  });

  it("errors when @removed <= @since", () => {
    const s = defineSchema("User", {
      version: 5,
      fields: [
        { name: "bad", type: "string", since: 3, removed: 3, defaultValue: "" },
      ],
    });
    const errors = validateSchema(s);
    expect(errors.some((e) => e.message.includes("must be greater"))).toBe(
      true,
    );
  });

  it("errors when non-optional field added after v1 lacks defaultValue", () => {
    const s = defineSchema("User", {
      version: 3,
      fields: [
        { name: "name", type: "string" },
        { name: "email", type: "string", since: 2 },
      ],
    });
    const errors = validateSchema(s);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("email");
    expect(errors[0].message).toContain("@defaultValue");
  });

  it("accepts optional field added after v1 without defaultValue", () => {
    const s = defineSchema("User", {
      version: 2,
      fields: [
        { name: "name", type: "string" },
        { name: "avatar", type: "string", since: 2, optional: true },
      ],
    });
    expect(validateSchema(s)).toEqual([]);
  });

  it("accepts field added after v1 with defaultValue", () => {
    const s = defineSchema("User", {
      version: 2,
      fields: [
        { name: "name", type: "string" },
        { name: "email", type: "string", since: 2, defaultValue: "" },
      ],
    });
    expect(validateSchema(s)).toEqual([]);
  });

  it("errors when @renamed version exceeds current version", () => {
    const s = defineSchema("User", {
      version: 2,
      fields: [
        {
          name: "displayName",
          type: "string",
          renamed: { version: 5, oldName: "name" },
        },
      ],
    });
    const errors = validateSchema(s);
    expect(errors.some((e) => e.message.includes("exceeds current"))).toBe(
      true,
    );
  });
});

describe("fieldsAtVersion", () => {
  const fields: FieldMeta[] = [
    { name: "name", type: "string" },
    { name: "email", type: "string", since: 2, defaultValue: "" },
    { name: "avatar", type: "string", since: 3, optional: true },
    { name: "legacy", type: "string", removed: 2 },
  ];
  const s = defineSchema("User", { version: 3, fields });

  it("returns v1 fields", () => {
    const v1 = fieldsAtVersion(s, 1);
    const names = v1.map((f) => f.name);
    expect(names).toEqual(["name", "legacy"]);
  });

  it("returns v2 fields", () => {
    const v2 = fieldsAtVersion(s, 2);
    const names = v2.map((f) => f.name);
    expect(names).toEqual(["name", "email"]);
  });

  it("returns v3 fields", () => {
    const v3 = fieldsAtVersion(s, 3);
    const names = v3.map((f) => f.name);
    expect(names).toEqual(["name", "email", "avatar"]);
  });
});

describe("generateMigrations", () => {
  it("generates correct number of migration steps", () => {
    const s = defineSchema("User", {
      version: 3,
      fields: [
        { name: "name", type: "string" },
        { name: "email", type: "string", since: 2, defaultValue: "" },
        { name: "avatar", type: "string", since: 3, optional: true },
      ],
    });
    const history = generateMigrations(s);
    expect(history.versions).toEqual([1, 2, 3]);
    expect(history.migrations).toHaveLength(2);
    expect(history.migrations[0].from).toBe(1);
    expect(history.migrations[0].to).toBe(2);
    expect(history.migrations[1].from).toBe(2);
    expect(history.migrations[1].to).toBe(3);
  });

  it("adds fields with defaults during migration", () => {
    const s = defineSchema("User", {
      version: 2,
      fields: [
        { name: "name", type: "string" },
        { name: "email", type: "string", since: 2, defaultValue: "unknown" },
      ],
    });
    const history = generateMigrations(s);
    const result = history.migrations[0].migrate({ name: "Alice" });
    expect(result).toEqual({ name: "Alice", email: "unknown" });
  });

  it("removes fields during migration", () => {
    const s = defineSchema("User", {
      version: 2,
      fields: [
        { name: "name", type: "string" },
        { name: "legacy", type: "string", removed: 2 },
      ],
    });
    const history = generateMigrations(s);
    const result = history.migrations[0].migrate({
      name: "Alice",
      legacy: "old",
    });
    expect(result).toEqual({ name: "Alice" });
  });

  it("renames fields during migration", () => {
    const s = defineSchema("User", {
      version: 2,
      fields: [
        {
          name: "displayName",
          type: "string",
          renamed: { version: 2, oldName: "name" },
        },
      ],
    });
    const history = generateMigrations(s);
    const result = history.migrations[0].migrate({ name: "Alice" });
    expect(result).toEqual({ displayName: "Alice" });
  });

  it("handles multi-step migration", () => {
    const s = defineSchema("Config", {
      version: 3,
      fields: [
        { name: "host", type: "string" },
        { name: "port", type: "number", since: 2, defaultValue: 8080 },
        { name: "secure", type: "boolean", since: 3, defaultValue: false },
        { name: "debug", type: "boolean", removed: 3 },
      ],
    });
    const history = generateMigrations(s);

    let record: Record<string, unknown> = { host: "localhost", debug: true };
    for (const step of history.migrations) {
      record = step.migrate(record);
    }

    expect(record).toEqual({
      host: "localhost",
      port: 8080,
      secure: false,
    });
  });
});
