import { describe, expect, it } from "vitest";
import { createJsonCodec } from "../json-codec.js";
import { defineSchema } from "../schema.js";
import type { Schema } from "../types.js";

function simpleSchema(): Schema {
  return defineSchema("Point", {
    version: 1,
    fields: [
      { name: "x", type: "number" },
      { name: "y", type: "number" },
    ],
  });
}

function versionedSchema(): Schema {
  return defineSchema("UserProfile", {
    version: 3,
    fields: [
      { name: "name", type: "string" },
      { name: "email", type: "string", since: 2, defaultValue: "" },
      { name: "avatar", type: "string", since: 2, optional: true },
      { name: "preferences", type: "object", since: 3, defaultValue: {} },
      { name: "theme", type: "string", since: 3, defaultValue: "light" },
      { name: "legacyField", type: "string", removed: 3, optional: true },
    ],
  });
}

describe("basic encode/decode", () => {
  it("round-trips a simple value", () => {
    const codec = createJsonCodec<{ x: number; y: number }>(simpleSchema());
    const original = { x: 10, y: 20 };
    const encoded = codec.encode(original);
    const decoded = codec.decode(encoded);
    expect(decoded).toEqual(original);
  });

  it("encodes with __v field", () => {
    const codec = createJsonCodec<{ x: number; y: number }>(simpleSchema());
    const json = JSON.parse(codec.encode({ x: 1, y: 2 }) as string);
    expect(json.__v).toBe(1);
  });

  it("strips __v on decode", () => {
    const codec = createJsonCodec<{ x: number; y: number }>(simpleSchema());
    const decoded = codec.decode('{"__v": 1, "x": 5, "y": 10}');
    expect(decoded).toEqual({ x: 5, y: 10 });
    expect((decoded as any).__v).toBeUndefined();
  });
});

describe("version detection", () => {
  it("detects version from __v field", () => {
    const codec = createJsonCodec<{ name: string }>(
      defineSchema("Foo", { version: 2, fields: [{ name: "name", type: "string" }] })
    );
    expect(() => codec.decode('{"__v": 1, "name": "Alice"}')).toThrow("Version mismatch");
  });

  it("defaults to v1 when __v is missing", () => {
    const codec = createJsonCodec<{ name: string }>(
      defineSchema("Foo", { version: 2, fields: [{ name: "name", type: "string" }] })
    );
    expect(() => codec.decode('{"name": "Alice"}')).toThrow("Version mismatch");
  });
});

describe("schema evolution via decodeAny", () => {
  it("migrates v1 data to v3", () => {
    const codec = createJsonCodec<{
      name: string;
      email: string;
      preferences: Record<string, unknown>;
      theme: string;
    }>(versionedSchema());

    const v1Data = JSON.stringify({ __v: 1, name: "Alice" });
    const decoded = codec.decodeAny(v1Data);

    expect(decoded.name).toBe("Alice");
    expect(decoded.email).toBe("");
    expect(decoded.preferences).toEqual({});
    expect(decoded.theme).toBe("light");
    expect((decoded as any).legacyField).toBeUndefined();
  });

  it("migrates v2 data to v3", () => {
    const codec = createJsonCodec<{
      name: string;
      email: string;
      preferences: Record<string, unknown>;
      theme: string;
    }>(versionedSchema());

    const v2Data = JSON.stringify({
      __v: 2,
      name: "Bob",
      email: "bob@test.com",
      avatar: "bob.png",
      legacyField: "old",
    });
    const decoded = codec.decodeAny(v2Data);

    expect(decoded.name).toBe("Bob");
    expect(decoded.email).toBe("bob@test.com");
    expect(decoded.preferences).toEqual({});
    expect(decoded.theme).toBe("light");
    expect((decoded as any).legacyField).toBeUndefined();
  });

  it("passes through current version unchanged", () => {
    const codec = createJsonCodec<{
      name: string;
      email: string;
      preferences: Record<string, unknown>;
      theme: string;
    }>(versionedSchema());

    const v3Data = JSON.stringify({
      __v: 3,
      name: "Carol",
      email: "carol@test.com",
      preferences: { lang: "en" },
      theme: "dark",
    });
    const decoded = codec.decodeAny(v3Data);

    expect(decoded.name).toBe("Carol");
    expect(decoded.theme).toBe("dark");
    expect(decoded.preferences).toEqual({ lang: "en" });
  });
});

describe("default values", () => {
  it("fills defaults for missing fields on encode", () => {
    const s = defineSchema("Config", {
      version: 2,
      fields: [
        { name: "host", type: "string" },
        { name: "port", type: "number", since: 2, defaultValue: 3000 },
      ],
    });
    const codec = createJsonCodec<{ host: string; port: number }>(s);
    const json = JSON.parse(codec.encode({ host: "localhost" } as any) as string);
    expect(json.port).toBe(3000);
  });
});

describe("optional fields", () => {
  it("encodes null for missing optional fields", () => {
    const s = defineSchema("User", {
      version: 1,
      fields: [
        { name: "name", type: "string" },
        { name: "bio", type: "string", optional: true },
      ],
    });
    const codec = createJsonCodec<{ name: string; bio: string | null }>(s);
    const json = JSON.parse(codec.encode({ name: "Alice" } as any) as string);
    expect(json.bio).toBeNull();
  });
});

describe("error handling", () => {
  it("throws on invalid JSON", () => {
    const codec = createJsonCodec<{ x: number }>(simpleSchema());
    expect(() => codec.decode("not json")).toThrow();
  });

  it("accepts Uint8Array input", () => {
    const codec = createJsonCodec<{ x: number; y: number }>(simpleSchema());
    const bytes = new TextEncoder().encode('{"__v": 1, "x": 1, "y": 2}');
    const decoded = codec.decode(bytes);
    expect(decoded).toEqual({ x: 1, y: 2 });
  });
});

describe("complex types", () => {
  it("handles nested objects", () => {
    const s = defineSchema("Config", {
      version: 1,
      fields: [
        { name: "db", type: "object" },
        { name: "cache", type: "object" },
      ],
    });
    const codec = createJsonCodec<{
      db: { host: string; port: number };
      cache: { ttl: number };
    }>(s);

    const original = {
      db: { host: "localhost", port: 5432 },
      cache: { ttl: 300 },
    };
    const decoded = codec.decode(codec.encode(original));
    expect(decoded).toEqual(original);
  });

  it("handles arrays", () => {
    const s = defineSchema("Tags", {
      version: 1,
      fields: [{ name: "items", type: "array" }],
    });
    const codec = createJsonCodec<{ items: string[] }>(s);
    const original = { items: ["a", "b", "c"] };
    const decoded = codec.decode(codec.encode(original));
    expect(decoded).toEqual(original);
  });
});

describe("future version rejection", () => {
  it("decodeAny throws for data from a future version", () => {
    const codec = createJsonCodec<{ name: string }>(
      defineSchema("Foo", {
        version: 2,
        fields: [{ name: "name", type: "string" }],
      })
    );
    const futureData = JSON.stringify({ __v: 5, name: "Alice" });
    expect(() => codec.decodeAny(futureData)).toThrow(/v5.*v2/);
  });

  it("decodeAny passes through current version unchanged", () => {
    const codec = createJsonCodec<{ name: string }>(
      defineSchema("Foo", {
        version: 2,
        fields: [{ name: "name", type: "string" }],
      })
    );
    const currentData = JSON.stringify({ __v: 2, name: "Bob" });
    expect(codec.decodeAny(currentData)).toEqual({ name: "Bob" });
  });
});
