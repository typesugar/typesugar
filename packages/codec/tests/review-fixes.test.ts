/**
 * Regression tests for the deep-review codec findings (#21, #30, #31).
 */
import { describe, it, expect } from "vitest";
import {
  defineSchema,
  createJsonCodec,
  createBinaryCodec,
  schema,
  type FieldLayout,
} from "../src/index.js";

describe("#21 binary decodeAny uses the data's own version layout", () => {
  const s = defineSchema("P", {
    version: 2,
    format: "binary",
    fields: [
      { name: "x", type: "number" },
      { name: "y", type: "number", since: 2, defaultValue: 7 },
    ],
  });
  const v1Layout: FieldLayout[] = [{ name: "x", offset: 0, size: 2, type: "uint16" }];
  const v2Layout: FieldLayout[] = [
    { name: "x", offset: 0, size: 4, type: "uint32" },
    { name: "y", offset: 4, size: 2, type: "uint16" },
  ];

  it("decodes v1 bytes with the v1 layout, then migrates", () => {
    const v1 = createBinaryCodec<{ x: number }>(
      defineSchema("P", { version: 1, format: "binary", fields: [{ name: "x", type: "number" }] }),
      v1Layout
    );
    const old = v1.encode({ x: 513 }) as Uint8Array;
    const v2 = createBinaryCodec<{ x: number; y: number }>(s, v2Layout, { 1: v1Layout });
    expect(v2.decodeAny(old)).toEqual({ x: 513, y: 7 });
  });

  it("refuses old data without a registered layout instead of misreading it", () => {
    const v1 = createBinaryCodec<{ x: number }>(
      defineSchema("P", { version: 1, format: "binary", fields: [{ name: "x", type: "number" }] }),
      v1Layout
    );
    const v2 = createBinaryCodec<{ x: number; y: number }>(s, v2Layout);
    expect(() => v2.decodeAny(v1.encode({ x: 1 }))).toThrow(/no binary layout for v1/);
  });

  it("decode checks buffer length", () => {
    const v2 = createBinaryCodec<{ x: number; y: number }>(s, v2Layout);
    const bytes = v2.encode({ x: 1, y: 2 }) as Uint8Array;
    expect(() => v2.decode(bytes.subarray(0, 6))).toThrow(/truncated/);
  });

  it("rejects data from a newer version", () => {
    const s3 = defineSchema("P", {
      version: 3,
      format: "binary",
      fields: [{ name: "x", type: "number" }],
    });
    const v3 = createBinaryCodec<{ x: number }>(s3, v1Layout);
    const v2 = createBinaryCodec<{ x: number; y: number }>(s, v2Layout);
    expect(() => v2.decodeAny(v3.encode({ x: 1 }))).toThrow(/Cannot decode v3/);
  });
});

describe("#31 binary strings and integers", () => {
  const s = defineSchema("S", {
    version: 1,
    format: "binary",
    fields: [{ name: "t", type: "string" }],
  });
  it("does not cut a UTF-8 sequence in half", () => {
    const c = createBinaryCodec<{ t: string }>(s, [
      { name: "t", offset: 0, size: 5, type: "string" },
    ]);
    // "a€b" is 1 + 3 + 1 bytes; only 3 bytes of payload fit.
    expect(c.decode(c.encode({ t: "a€b" }))).toEqual({ t: "a" });
  });
  it("out-of-range integers throw instead of wrapping", () => {
    const n = defineSchema("N", {
      version: 1,
      format: "binary",
      fields: [{ name: "n", type: "number" }],
    });
    const c = createBinaryCodec<{ n: number }>(n, [
      { name: "n", offset: 0, size: 1, type: "uint8" },
    ]);
    expect(() => c.encode({ n: 300 })).toThrow(RangeError);
    expect(() => c.encode({ n: -1 })).toThrow(RangeError);
    expect(() => c.encode({ n: 1.5 })).toThrow(RangeError);
    expect(c.decode(c.encode({ n: 255 }))).toEqual({ n: 255 });
  });
});

describe("#30 JSON codec type fidelity", () => {
  it("Date round-trips as a Date", () => {
    const c = createJsonCodec<{ at: Date }>(
      defineSchema("D", { version: 1, fields: [{ name: "at", type: "date" }] })
    );
    const at = new Date("2020-01-02T03:04:05.000Z");
    const out = c.decode(c.encode({ at }));
    expect(out.at).toBeInstanceOf(Date);
    expect(out.at.getTime()).toBe(at.getTime());
  });
  it("bigint round-trips", () => {
    const c = createJsonCodec<{ n: bigint }>(
      defineSchema("B", { version: 1, fields: [{ name: "n", type: "bigint" }] })
    );
    expect(c.decode(c.encode({ n: 12345678901234567890n }))).toEqual({ n: 12345678901234567890n });
  });
  it("absent optional stays absent", () => {
    const c = createJsonCodec<{ a: number; b?: string }>(
      defineSchema("O", {
        version: 1,
        fields: [
          { name: "a", type: "number" },
          { name: "b", type: "string", optional: true },
        ],
      })
    );
    expect(c.decode(c.encode({ a: 1 }))).toEqual({ a: 1 });
  });
  it("mutable defaults are not shared between decodes", () => {
    const c = schema<{ name: string; tags: string[] }>("T", 2)
      .field("name", "string")
      .field("tags", "array", { since: 2, defaultValue: [] })
      .buildCodec();
    const a = c.decodeAny('{"__v":1,"name":"a"}');
    a.tags.push("x");
    const b = c.decodeAny('{"__v":1,"name":"b"}');
    expect(b.tags).toEqual([]);
  });
  it("a user field named __v is rejected", () => {
    expect(() =>
      createJsonCodec(defineSchema("V", { version: 1, fields: [{ name: "__v", type: "number" }] }))
    ).toThrow(/__v/);
  });
});
