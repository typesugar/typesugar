/**
 * Tests for Phase 2 field-level metadata decorators:
 * @since, @removed, @renamed, @defaultValue
 *
 * These tests verify:
 * 1. collectFieldMeta extracts decorator arguments from AST nodes
 * 2. The generated schema metadata drives correct migration behaviour
 * 3. End-to-end decode scenarios with versioned data
 */
import { describe, expect, it } from "vitest";
import * as ts from "typescript";
import { collectFieldMeta, codecMacro } from "../macros.js";
import { defineSchema, generateMigrations, fieldsAtVersion } from "../schema.js";
import { createJsonCodec } from "../json-codec.js";
import { createMacroTestContext } from "@typesugar/testing/macros";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse source into an AST and return the first class declaration. */
function parseClass(source: string): ts.ClassDeclaration {
  const sf = ts.createSourceFile("test.ts", source, ts.ScriptTarget.Latest, true);
  for (const stmt of sf.statements) {
    if (ts.isClassDeclaration(stmt)) return stmt;
  }
  throw new Error("No class declaration found");
}

// ---------------------------------------------------------------------------
// collectFieldMeta — unit tests for decorator extraction
// ---------------------------------------------------------------------------

describe("collectFieldMeta", () => {
  it("extracts @since(version) from a decorated property", () => {
    const cls = parseClass(`
      class Foo {
        @since(2)
        email: string;
      }
    `);
    const meta = collectFieldMeta(cls);
    expect(meta.get("email")?.since).toBe(2);
  });

  it("extracts @removed(version) from a decorated property", () => {
    const cls = parseClass(`
      class Foo {
        @removed(3)
        legacy: string;
      }
    `);
    const meta = collectFieldMeta(cls);
    expect(meta.get("legacy")?.removed).toBe(3);
  });

  it("extracts @renamed(version, oldName) from a decorated property", () => {
    const cls = parseClass(`
      class Foo {
        @renamed(2, "userName")
        displayName: string;
      }
    `);
    const meta = collectFieldMeta(cls);
    const renamed = meta.get("displayName")?.renamed;
    expect(renamed).toEqual({ version: 2, oldName: "userName" });
  });

  it("extracts @defaultValue(value) with a string literal", () => {
    const cls = parseClass(`
      class Foo {
        @defaultValue("fallback")
        tag: string;
      }
    `);
    const meta = collectFieldMeta(cls);
    expect(meta.get("tag")?.defaultValue).toBe("fallback");
    expect(meta.get("tag")?.hasDefaultValue).toBe(true);
  });

  it("extracts @defaultValue(value) with a numeric literal", () => {
    const cls = parseClass(`
      class Foo {
        @defaultValue(42)
        count: number;
      }
    `);
    const meta = collectFieldMeta(cls);
    expect(meta.get("count")?.defaultValue).toBe(42);
  });

  it("extracts @defaultValue(value) with a boolean literal", () => {
    const cls = parseClass(`
      class Foo {
        @defaultValue(false)
        active: boolean;
      }
    `);
    const meta = collectFieldMeta(cls);
    expect(meta.get("active")?.defaultValue).toBe(false);
  });

  it("extracts multiple decorators on the same property", () => {
    const cls = parseClass(`
      class Foo {
        @since(2)
        @defaultValue("none")
        email: string;
      }
    `);
    const meta = collectFieldMeta(cls);
    expect(meta.get("email")?.since).toBe(2);
    expect(meta.get("email")?.defaultValue).toBe("none");
  });

  it("returns empty map for class with no field decorators", () => {
    const cls = parseClass(`
      class Foo {
        name: string;
        age: number;
      }
    `);
    const meta = collectFieldMeta(cls);
    expect(meta.size).toBe(0);
  });

  it("ignores non-field decorators", () => {
    const cls = parseClass(`
      class Foo {
        @someOther(99)
        name: string;
      }
    `);
    const meta = collectFieldMeta(cls);
    expect(meta.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Schema evolution scenarios — @since + @defaultValue
// ---------------------------------------------------------------------------

describe("@since + @defaultValue migration", () => {
  it("v1 data gets default value for field added in v2", () => {
    const schema = defineSchema("User", {
      version: 2,
      fields: [
        { name: "name", type: "string" },
        { name: "email", type: "string", since: 2, defaultValue: "default@example.com" },
      ],
    });

    const codec = createJsonCodec<{ name: string; email: string }>(schema);
    const v1Data = JSON.stringify({ __v: 1, name: "Alice" });
    const decoded = codec.decodeAny(v1Data);

    expect(decoded.name).toBe("Alice");
    expect(decoded.email).toBe("default@example.com");
  });

  it("v2 data preserves its own email value", () => {
    const schema = defineSchema("User", {
      version: 2,
      fields: [
        { name: "name", type: "string" },
        { name: "email", type: "string", since: 2, defaultValue: "default@example.com" },
      ],
    });

    const codec = createJsonCodec<{ name: string; email: string }>(schema);
    const v2Data = JSON.stringify({ __v: 2, name: "Alice", email: "alice@real.com" });
    const decoded = codec.decodeAny(v2Data);

    expect(decoded.email).toBe("alice@real.com");
  });

  it("multi-version migration fills defaults at each step", () => {
    const schema = defineSchema("Config", {
      version: 3,
      fields: [
        { name: "host", type: "string" },
        { name: "port", type: "number", since: 2, defaultValue: 8080 },
        { name: "secure", type: "boolean", since: 3, defaultValue: false },
      ],
    });

    const codec = createJsonCodec<{ host: string; port: number; secure: boolean }>(schema);
    const v1Data = JSON.stringify({ __v: 1, host: "localhost" });
    const decoded = codec.decodeAny(v1Data);

    expect(decoded.host).toBe("localhost");
    expect(decoded.port).toBe(8080);
    expect(decoded.secure).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Schema evolution scenarios — @removed
// ---------------------------------------------------------------------------

describe("@removed migration", () => {
  it("field is stripped at removal version", () => {
    const schema = defineSchema("Settings", {
      version: 3,
      fields: [
        { name: "theme", type: "string" },
        { name: "debug", type: "boolean", removed: 3 },
      ],
    });

    const codec = createJsonCodec<{ theme: string }>(schema);
    const v1Data = JSON.stringify({ __v: 1, theme: "dark", debug: true });
    const decoded = codec.decodeAny(v1Data) as Record<string, unknown>;

    expect(decoded.theme).toBe("dark");
    expect(decoded.debug).toBeUndefined();
  });

  it("field is present at versions before removal", () => {
    const schema = defineSchema("Settings", {
      version: 3,
      fields: [
        { name: "theme", type: "string" },
        { name: "debug", type: "boolean", removed: 3 },
      ],
    });

    const active = fieldsAtVersion(schema, 2);
    const names = active.map((f) => f.name);
    expect(names).toContain("debug");
  });

  it("field is absent at removal version and beyond", () => {
    const schema = defineSchema("Settings", {
      version: 3,
      fields: [
        { name: "theme", type: "string" },
        { name: "debug", type: "boolean", removed: 3 },
      ],
    });

    const active = fieldsAtVersion(schema, 3);
    const names = active.map((f) => f.name);
    expect(names).not.toContain("debug");
  });
});

// ---------------------------------------------------------------------------
// Schema evolution scenarios — @renamed
// ---------------------------------------------------------------------------

describe("@renamed migration", () => {
  it("v1 data with oldName is mapped to newName", () => {
    const schema = defineSchema("User", {
      version: 2,
      fields: [
        {
          name: "displayName",
          type: "string",
          renamed: { version: 2, oldName: "name" },
        },
      ],
    });

    const codec = createJsonCodec<{ displayName: string }>(schema);
    const v1Data = JSON.stringify({ __v: 1, name: "Alice" });
    const decoded = codec.decodeAny(v1Data);

    expect(decoded.displayName).toBe("Alice");
    expect((decoded as any).name).toBeUndefined();
  });

  it("v2 data with newName passes through unchanged", () => {
    const schema = defineSchema("User", {
      version: 2,
      fields: [
        {
          name: "displayName",
          type: "string",
          renamed: { version: 2, oldName: "name" },
        },
      ],
    });

    const codec = createJsonCodec<{ displayName: string }>(schema);
    const v2Data = JSON.stringify({ __v: 2, displayName: "Bob" });
    const decoded = codec.decodeAny(v2Data);

    expect(decoded.displayName).toBe("Bob");
  });
});

// ---------------------------------------------------------------------------
// Combined evolution scenarios
// ---------------------------------------------------------------------------

describe("combined decorator scenarios", () => {
  it("handles since + removed + renamed in a multi-version migration", () => {
    // Version history:
    //   v1: { userName: string }
    //   v2: { displayName: string (renamed from userName), email: string (added) }
    //   v3: { displayName: string, email: string, avatar: string (added), legacy removed }
    const schema = defineSchema("Profile", {
      version: 3,
      fields: [
        {
          name: "displayName",
          type: "string",
          renamed: { version: 2, oldName: "userName" },
        },
        { name: "email", type: "string", since: 2, defaultValue: "" },
        { name: "avatar", type: "string", since: 3, defaultValue: "default.png" },
      ],
    });

    const codec = createJsonCodec<{
      displayName: string;
      email: string;
      avatar: string;
    }>(schema);

    // Migrate v1 data all the way to v3
    const v1Data = JSON.stringify({ __v: 1, userName: "Alice" });
    const decoded = codec.decodeAny(v1Data);

    expect(decoded.displayName).toBe("Alice");
    expect(decoded.email).toBe("");
    expect(decoded.avatar).toBe("default.png");
    expect((decoded as any).userName).toBeUndefined();
  });

  it("generateMigrations produces correct step count for combined schema", () => {
    const schema = defineSchema("Profile", {
      version: 3,
      fields: [
        {
          name: "displayName",
          type: "string",
          renamed: { version: 2, oldName: "userName" },
        },
        { name: "email", type: "string", since: 2, defaultValue: "" },
        { name: "avatar", type: "string", since: 3, defaultValue: "default.png" },
      ],
    });

    const history = generateMigrations(schema);
    expect(history.versions).toEqual([1, 2, 3]);
    expect(history.migrations).toHaveLength(2);
  });

  it("step-by-step migration matches decodeAny result", () => {
    const schema = defineSchema("Profile", {
      version: 3,
      fields: [
        {
          name: "displayName",
          type: "string",
          renamed: { version: 2, oldName: "userName" },
        },
        { name: "email", type: "string", since: 2, defaultValue: "" },
        { name: "avatar", type: "string", since: 3, defaultValue: "default.png" },
      ],
    });

    const history = generateMigrations(schema);
    let record: Record<string, unknown> = { userName: "Alice" };
    for (const step of history.migrations) {
      record = step.migrate(record);
    }

    expect(record).toEqual({
      displayName: "Alice",
      email: "",
      avatar: "default.png",
    });
  });
});

// ---------------------------------------------------------------------------
// @codec macro expansion with decorated fields
// ---------------------------------------------------------------------------

describe("@codec macro reads field decorators", () => {
  function expandCodec(source: string): { nodes: ts.Node[] } {
    const fullSource = `
      import { defineSchema } from "@typesugar/codec";
      ${source}
    `;
    const ctx = createMacroTestContext(fullSource);

    let decl: ts.ClassDeclaration | undefined;
    function visit(node: ts.Node) {
      if (ts.isClassDeclaration(node)) {
        decl = node;
      } else {
        ts.forEachChild(node, visit);
      }
    }
    ts.forEachChild(ctx.sourceFile, visit);

    if (!decl) throw new Error("No class found");

    // Pass version argument as numeric literal
    const versionArg = ts.factory.createNumericLiteral(3);
    const dec = ts.factory.createDecorator(
      ts.factory.createCallExpression(ts.factory.createIdentifier("codec"), undefined, [versionArg])
    );

    const result = codecMacro.expand(ctx, dec, decl, [versionArg]);
    const nodes = Array.isArray(result) ? result : [result];
    return { nodes };
  }

  it("produces a schema variable statement alongside the class", () => {
    const { nodes } = expandCodec(`
class User {
  name: string;
}
    `);
    expect(nodes.length).toBe(2);
    expect(ts.isClassDeclaration(nodes[0])).toBe(true);
    expect(ts.isVariableStatement(nodes[1])).toBe(true);

    const varStmt = nodes[1] as ts.VariableStatement;
    const varDecl = varStmt.declarationList.declarations[0];
    expect((varDecl.name as ts.Identifier).text).toBe("UserSchema");
  });
});
