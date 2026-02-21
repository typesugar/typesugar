import { describe, expect, it } from "vitest";
import { createBinaryCodec, type FieldLayout } from "../binary-codec.js";
import { defineSchema } from "../schema.js";

describe("fixed layout encode/decode", () => {
  const layout: FieldLayout[] = [
    { name: "x", offset: 0, size: 4, type: "float32" },
    { name: "y", offset: 4, size: 4, type: "float32" },
  ];
  const schema = defineSchema("Point", {
    version: 1,
    format: "binary",
    fields: [
      { name: "x", type: "number" },
      { name: "y", type: "number" },
    ],
  });

  it("round-trips float32 values", () => {
    const codec = createBinaryCodec<{ x: number; y: number }>(schema, layout);
    const encoded = codec.encode({ x: 1.5, y: 2.5 });
    expect(encoded).toBeInstanceOf(Uint8Array);

    const decoded = codec.decode(encoded);
    expect(decoded.x).toBeCloseTo(1.5);
    expect(decoded.y).toBeCloseTo(2.5);
  });
});

describe("multiple numeric types", () => {
  const layout: FieldLayout[] = [
    { name: "a", offset: 0, size: 1, type: "uint8" },
    { name: "b", offset: 1, size: 2, type: "uint16" },
    { name: "c", offset: 3, size: 4, type: "uint32" },
    { name: "d", offset: 7, size: 8, type: "float64" },
  ];
  const schema = defineSchema("Multi", {
    version: 1,
    format: "binary",
    fields: [
      { name: "a", type: "number" },
      { name: "b", type: "number" },
      { name: "c", type: "number" },
      { name: "d", type: "number" },
    ],
  });

  it("round-trips mixed numeric types", () => {
    const codec = createBinaryCodec<{
      a: number;
      b: number;
      c: number;
      d: number;
    }>(schema, layout);

    const original = { a: 255, b: 65535, c: 4294967295, d: Math.PI };
    const decoded = codec.decode(codec.encode(original));

    expect(decoded.a).toBe(255);
    expect(decoded.b).toBe(65535);
    expect(decoded.c).toBe(4294967295);
    expect(decoded.d).toBeCloseTo(Math.PI);
  });

  it("handles signed integers", () => {
    const signedLayout: FieldLayout[] = [
      { name: "a", offset: 0, size: 1, type: "int8" },
      { name: "b", offset: 1, size: 2, type: "int16" },
      { name: "c", offset: 3, size: 4, type: "int32" },
    ];
    const s = defineSchema("Signed", {
      version: 1,
      format: "binary",
      fields: [
        { name: "a", type: "number" },
        { name: "b", type: "number" },
        { name: "c", type: "number" },
      ],
    });
    const codec = createBinaryCodec<{ a: number; b: number; c: number }>(
      s,
      signedLayout,
    );

    const original = { a: -128, b: -32768, c: -2147483648 };
    const decoded = codec.decode(codec.encode(original));

    expect(decoded.a).toBe(-128);
    expect(decoded.b).toBe(-32768);
    expect(decoded.c).toBe(-2147483648);
  });
});

describe("string fields", () => {
  const layout: FieldLayout[] = [
    { name: "label", offset: 0, size: 34, type: "string" },
  ];
  const schema = defineSchema("Label", {
    version: 1,
    format: "binary",
    fields: [{ name: "label", type: "string" }],
  });

  it("round-trips short strings", () => {
    const codec = createBinaryCodec<{ label: string }>(schema, layout);
    const decoded = codec.decode(codec.encode({ label: "hello" }));
    expect(decoded.label).toBe("hello");
  });

  it("truncates strings exceeding field size", () => {
    const codec = createBinaryCodec<{ label: string }>(schema, layout);
    const long = "a".repeat(100);
    const decoded = codec.decode(codec.encode({ label: long }));
    expect(decoded.label.length).toBeLessThanOrEqual(32);
  });
});

describe("version header", () => {
  const layout: FieldLayout[] = [
    { name: "value", offset: 0, size: 4, type: "uint32" },
  ];
  const schema = defineSchema("Versioned", {
    version: 42,
    format: "binary",
    fields: [{ name: "value", type: "number" }],
  });

  it("writes magic bytes and version", () => {
    const codec = createBinaryCodec<{ value: number }>(schema, layout);
    const encoded = codec.encode({ value: 123 }) as Uint8Array;

    expect(encoded[0]).toBe(0x54);
    expect(encoded[1]).toBe(0x53);
    const view = new DataView(
      encoded.buffer,
      encoded.byteOffset,
      encoded.byteLength,
    );
    expect(view.getUint16(2, true)).toBe(42);
  });

  it("rejects data with wrong magic bytes", () => {
    const codec = createBinaryCodec<{ value: number }>(schema, layout);
    const bad = new Uint8Array([0x00, 0x00, 0x00, 42, 0, 0, 0, 123]);
    expect(() => codec.decode(bad)).toThrow("bad magic bytes");
  });

  it("rejects data with wrong version on strict decode", () => {
    const codec = createBinaryCodec<{ value: number }>(schema, layout);
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setUint8(0, 0x54);
    view.setUint8(1, 0x53);
    view.setUint16(2, 1, true);
    view.setUint32(4, 123, true);
    expect(() => codec.decode(new Uint8Array(buf))).toThrow(
      "Version mismatch",
    );
  });
});

describe("round-trip encode/decode", () => {
  it("preserves all field values", () => {
    const layout: FieldLayout[] = [
      { name: "id", offset: 0, size: 4, type: "uint32" },
      { name: "score", offset: 4, size: 8, type: "float64" },
      { name: "flags", offset: 12, size: 1, type: "uint8" },
    ];
    const schema = defineSchema("Record", {
      version: 1,
      format: "binary",
      fields: [
        { name: "id", type: "number" },
        { name: "score", type: "number" },
        { name: "flags", type: "number" },
      ],
    });
    const codec = createBinaryCodec<{
      id: number;
      score: number;
      flags: number;
    }>(schema, layout);

    const original = { id: 42, score: 99.5, flags: 7 };
    const decoded = codec.decode(codec.encode(original));
    expect(decoded).toEqual(original);
  });
});

describe("big-endian encoding", () => {
  it("respects explicit BE encoding", () => {
    const layout: FieldLayout[] = [
      { name: "value", offset: 0, size: 4, type: "uint32", encoding: "be" },
    ];
    const schema = defineSchema("BE", {
      version: 1,
      format: "binary",
      fields: [{ name: "value", type: "number" }],
    });
    const codec = createBinaryCodec<{ value: number }>(schema, layout);

    const encoded = codec.encode({ value: 0x01020304 }) as Uint8Array;
    const view = new DataView(
      encoded.buffer,
      encoded.byteOffset,
      encoded.byteLength,
    );
    expect(view.getUint32(4, false)).toBe(0x01020304);
  });
});

describe("binary codec error handling", () => {
  it("throws when given string input", () => {
    const layout: FieldLayout[] = [
      { name: "x", offset: 0, size: 4, type: "float32" },
    ];
    const schema = defineSchema("Foo", {
      version: 1,
      format: "binary",
      fields: [{ name: "x", type: "number" }],
    });
    const codec = createBinaryCodec<{ x: number }>(schema, layout);
    expect(() => codec.decode("not bytes" as any)).toThrow(
      "Uint8Array",
    );
  });
});
