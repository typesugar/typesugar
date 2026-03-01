/**
 * Schema Specialization Macro Tests
 *
 * Note: The actual specializeSchema() macro transformations happen at compile time.
 * These tests verify the runtime placeholder functionality and exports.
 */
import { describe, it, expect } from "vitest";
import {
  specializeSchema,
  specializeSchemaUnsafe,
  specializeSchemaExpression,
  specializeSchemaUnsafeExpression,
} from "../src/macros/schema-specialize.js";

describe("specializeSchema() expression macro", () => {
  it("should export the specializeSchema runtime placeholder", () => {
    expect(typeof specializeSchema).toBe("function");
  });

  it("should export the macro definition", () => {
    expect(specializeSchemaExpression).toBeDefined();
    expect(specializeSchemaExpression.name).toBe("specializeSchema");
  });
});

describe("specializeSchemaUnsafe() expression macro", () => {
  it("should export the specializeSchemaUnsafe runtime placeholder", () => {
    expect(typeof specializeSchemaUnsafe).toBe("function");
  });

  it("should export the macro definition", () => {
    expect(specializeSchemaUnsafeExpression).toBeDefined();
    expect(specializeSchemaUnsafeExpression.name).toBe("specializeSchemaUnsafe");
  });
});

describe("Schema specialization macro structure", () => {
  it("should export all necessary symbols from macros/schema-specialize.js", async () => {
    const schemaSpecialize = await import("../src/macros/schema-specialize.js");

    expect(schemaSpecialize.specializeSchema).toBeDefined();
    expect(schemaSpecialize.specializeSchemaUnsafe).toBeDefined();
    expect(schemaSpecialize.specializeSchemaExpression).toBeDefined();
    expect(schemaSpecialize.specializeSchemaUnsafeExpression).toBeDefined();
  });

  it("should export all necessary symbols from main index", async () => {
    const index = await import("../src/index.js");

    expect(index.specializeSchema).toBeDefined();
    expect(index.specializeSchemaUnsafe).toBeDefined();
    expect(index.specializeSchemaExpression).toBeDefined();
    expect(index.specializeSchemaUnsafeExpression).toBeDefined();
  });
});
