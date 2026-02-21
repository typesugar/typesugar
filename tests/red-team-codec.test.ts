/**
 * Red Team Tests for @typesugar/codec
 *
 * Attack surfaces:
 * - Schema validation bypass (invalid version numbers, conflicting metadata)
 * - Version migration edge cases (skipped versions, downgrade attempts)
 * - Special JSON values (NaN, Infinity, undefined, BigInt)
 * - Malicious inputs (prototype pollution, __proto__ injection)
 * - Binary codec bounds and encoding edge cases
 * - Type coercion during encode/decode roundtrip
 */
import { describe, it, expect } from "vitest";
import {
  defineSchema,
  validateSchema,
  fieldsAtVersion,
  generateMigrations,
} from "../packages/codec/src/schema.js";
import { createJsonCodec } from "../packages/codec/src/json-codec.js";
import { createBinaryCodec, type FieldLayout } from "../packages/codec/src/binary-codec.js";
import { schema } from "../packages/codec/src/decorators.js";
import type { Schema } from "../packages/codec/src/types.js";

describe("Codec Edge Cases", () => {
  // ==========================================================================
  // Attack 1: Schema Validation Bypass
  // ==========================================================================
  describe("schema validation edge cases", () => {
    it("rejects @since version exceeding schema version", () => {
      const s = defineSchema("FutureSince", {
        version: 2,
        fields: [{ name: "futureField", type: "string", since: 5 }],
      });
      const errors = validateSchema(s);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("exceeds current schema version");
    });

    it("rejects @since version of 0 or negative", () => {
      const s = defineSchema("ZeroSince", {
        version: 3,
        fields: [{ name: "badField", type: "string", since: 0 }],
      });
      const errors = validateSchema(s);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("must be >= 1");
    });

    it("rejects @removed <= @since (field removed before it was added)", () => {
      const s = defineSchema("RemovedBeforeAdded", {
        version: 5,
        fields: [{ name: "ephemeral", type: "string", since: 3, removed: 2 }],
      });
      const errors = validateSchema(s);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("must be greater than @since");
    });

    it("requires defaultValue for non-optional fields added after v1", () => {
      const s = defineSchema("MissingDefault", {
        version: 3,
        fields: [
          { name: "original", type: "string" },
          { name: "addedLater", type: "number", since: 2 },
        ],
      });
      const errors = validateSchema(s);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("must have a @defaultValue");
    });

    it("allows optional fields added after v1 without defaultValue", () => {
      const s = defineSchema("OptionalWithoutDefault", {
        version: 2,
        fields: [
          { name: "original", type: "string" },
          { name: "optionalNew", type: "string", since: 2, optional: true },
        ],
      });
      const errors = validateSchema(s);
      expect(errors.length).toBe(0);
    });
  });

  // ==========================================================================
  // Attack 2: Version Migration Chain Issues
  // ==========================================================================
  describe("version migration chains", () => {
    it("handles multi-step migrations v1 -> v2 -> v3", () => {
      interface UserV3 {
        id: number;
        username: string;
        email: string;
      }
      const s = defineSchema("User", {
        version: 3,
        fields: [
          { name: "id", type: "number" },
          { name: "username", type: "string", since: 2, renamed: { version: 2, oldName: "name" } },
          { name: "email", type: "string", since: 3, defaultValue: "" },
        ],
      });
      // Also add the old 'name' field for v1 data
      s.fields = [
        { name: "id", type: "number" },
        { name: "name", type: "string", removed: 2 },
        { name: "username", type: "string", since: 2, renamed: { version: 2, oldName: "name" } },
        { name: "email", type: "string", since: 3, defaultValue: "" },
      ] as any;

      const codec = createJsonCodec<UserV3>(s);

      // v1 data: { id: 1, name: "alice" }
      const v1Data = JSON.stringify({ id: 1, name: "alice" });
      const result = codec.decodeAny(v1Data);

      expect(result.id).toBe(1);
      expect(result.username).toBe("alice");
      expect(result.email).toBe("");
    });

    it("throws on downgrade attempt (future version data)", () => {
      const s = defineSchema("DowngradeTest", {
        version: 2,
        fields: [{ name: "data", type: "string" }],
      });
      const codec = createJsonCodec(s);

      const futureData = JSON.stringify({ __v: 5, data: "from the future" });
      expect(() => codec.decodeAny(futureData)).toThrow("Cannot decode v5 data with a v2 codec");
    });

    it("handles data without version field as v1", () => {
      interface Simple {
        value: number;
      }
      const s = defineSchema("Simple", {
        version: 2,
        fields: [
          { name: "value", type: "number" },
          { name: "newField", type: "string", since: 2, defaultValue: "default" },
        ],
      });
      const codec = createJsonCodec<Simple>(s);

      const noVersionData = JSON.stringify({ value: 42 });
      const result = codec.decodeAny(noVersionData) as any;

      expect(result.value).toBe(42);
      expect(result.newField).toBe("default");
    });

    it("preserves extra fields from future versions during migration", () => {
      const s = defineSchema("ExtraFields", {
        version: 2,
        fields: [
          { name: "known", type: "string" },
          { name: "addedInV2", type: "number", since: 2, defaultValue: 0 },
        ],
      });
      const codec = createJsonCodec<{ known: string; addedInV2: number }>(s);

      // v1 data with an unknown extra field
      const v1WithExtra = JSON.stringify({ known: "hello", unknownField: "mystery" });
      const result = codec.decodeAny(v1WithExtra) as any;

      // Note: current implementation preserves extra fields
      expect(result.known).toBe("hello");
      expect(result.addedInV2).toBe(0);
      expect(result.unknownField).toBe("mystery");
    });
  });

  // ==========================================================================
  // Attack 3: Special JSON Values (NaN, Infinity, undefined, BigInt)
  // ==========================================================================
  describe("special value handling", () => {
    it("handles NaN in numeric fields (becomes null in JSON)", () => {
      interface NumericData {
        value: number;
      }
      const s = defineSchema("NumericData", {
        version: 1,
        fields: [{ name: "value", type: "number" }],
      });
      const codec = createJsonCodec<NumericData>(s);

      const encoded = codec.encode({ value: NaN });
      const decoded = codec.decode(encoded);

      // JSON.stringify(NaN) produces null
      expect(decoded.value).toBe(null);
    });

    it("handles Infinity in numeric fields (becomes null in JSON)", () => {
      interface NumericData {
        value: number;
      }
      const s = defineSchema("InfinityData", {
        version: 1,
        fields: [{ name: "value", type: "number" }],
      });
      const codec = createJsonCodec<NumericData>(s);

      const encoded = codec.encode({ value: Infinity });
      const decoded = codec.decode(encoded);

      expect(decoded.value).toBe(null);
    });

    it("handles undefined fields (excluded from JSON output)", () => {
      interface OptionalData {
        required: string;
        optional?: string;
      }
      const s = defineSchema("OptionalData", {
        version: 1,
        fields: [
          { name: "required", type: "string" },
          { name: "optional", type: "string", optional: true },
        ],
      });
      const codec = createJsonCodec<OptionalData>(s);

      const encoded = codec.encode({ required: "hello", optional: undefined });
      const parsed = JSON.parse(encoded as string);

      expect(parsed.required).toBe("hello");
      expect(parsed.optional).toBe(null); // optional fields become null
    });

    it("loses BigInt precision (not JSON-serializable)", () => {
      interface BigData {
        huge: bigint;
      }
      const s = defineSchema("BigData", {
        version: 1,
        fields: [{ name: "huge", type: "bigint" }],
      });
      const codec = createJsonCodec<BigData>(s);

      // BigInt throws in JSON.stringify
      expect(() => codec.encode({ huge: BigInt("9007199254740993") })).toThrow();
    });

    it("handles -0 (becomes 0 in JSON roundtrip)", () => {
      interface SignedZero {
        value: number;
      }
      const s = defineSchema("SignedZero", {
        version: 1,
        fields: [{ name: "value", type: "number" }],
      });
      const codec = createJsonCodec<SignedZero>(s);

      const encoded = codec.encode({ value: -0 });
      const decoded = codec.decode(encoded);

      // -0 and 0 are equal in JS, but Object.is distinguishes them
      expect(decoded.value).toBe(0);
      expect(Object.is(decoded.value, -0)).toBe(false);
    });
  });

  // ==========================================================================
  // Attack 4: Malicious Input Injection
  // ==========================================================================
  describe("malicious input handling", () => {
    it("handles __proto__ key in JSON input", () => {
      const s = defineSchema("ProtoTest", {
        version: 1,
        fields: [{ name: "data", type: "string" }],
      });
      const codec = createJsonCodec<{ data: string }>(s);

      // Attempt prototype pollution via JSON
      const malicious = '{"__v":1,"data":"safe","__proto__":{"polluted":true}}';
      const decoded = codec.decode(malicious);

      // Verify no prototype pollution occurred
      expect((decoded as any).polluted).toBeUndefined();
      expect(({} as any).polluted).toBeUndefined();
    });

    it("handles constructor key in JSON input", () => {
      const s = defineSchema("ConstructorTest", {
        version: 1,
        fields: [{ name: "value", type: "number" }],
      });
      const codec = createJsonCodec<{ value: number }>(s);

      const malicious = '{"__v":1,"value":42,"constructor":{"prototype":{"evil":true}}}';
      const decoded = codec.decode(malicious);

      expect(decoded.value).toBe(42);
      expect(({} as any).evil).toBeUndefined();
    });

    it("handles deeply nested objects as field values", () => {
      const s = defineSchema("NestedTest", {
        version: 1,
        fields: [{ name: "payload", type: "object" }],
      });
      const codec = createJsonCodec<{ payload: unknown }>(s);

      const deep = { a: { b: { c: { d: { e: { f: "deep" } } } } } };
      const encoded = codec.encode({ payload: deep });
      const decoded = codec.decode(encoded);

      expect((decoded.payload as any).a.b.c.d.e.f).toBe("deep");
    });

    it("rejects invalid JSON gracefully", () => {
      const s = defineSchema("InvalidJson", {
        version: 1,
        fields: [{ name: "data", type: "string" }],
      });
      const codec = createJsonCodec<{ data: string }>(s);

      expect(() => codec.decode("not valid json")).toThrow();
      expect(() => codec.decode("{incomplete")).toThrow();
      expect(() => codec.decode("")).toThrow();
    });

    it("handles JSON with trailing garbage (strict parsing)", () => {
      const s = defineSchema("TrailingGarbage", {
        version: 1,
        fields: [{ name: "value", type: "number" }],
      });
      const codec = createJsonCodec<{ value: number }>(s);

      // JSON.parse is lenient about some trailing content
      // but strict about invalid syntax
      expect(() => codec.decode('{"__v":1,"value":42}extra')).toThrow();
    });
  });

  // ==========================================================================
  // Attack 5: Binary Codec Edge Cases
  // ==========================================================================
  describe("binary codec edge cases", () => {
    it("validates magic bytes on decode", () => {
      interface BinaryData {
        value: number;
      }
      const s = defineSchema("BinaryMagic", {
        version: 1,
        format: "binary",
        fields: [{ name: "value", type: "number" }],
      });
      const layout: FieldLayout[] = [{ name: "value", offset: 0, size: 4, type: "uint32" }];
      const codec = createBinaryCodec<BinaryData>(s, layout);

      // Invalid magic bytes
      const badMagic = new Uint8Array([0x00, 0x00, 0x01, 0x00, 0x2a, 0x00, 0x00, 0x00]);
      expect(() => codec.decode(badMagic)).toThrow("bad magic bytes");
    });

    it("handles version mismatch in binary format", () => {
      interface BinaryData {
        value: number;
      }
      const s = defineSchema("BinaryVersion", {
        version: 2,
        format: "binary",
        fields: [{ name: "value", type: "number" }],
      });
      const layout: FieldLayout[] = [{ name: "value", offset: 0, size: 4, type: "uint32" }];
      const codec = createBinaryCodec<BinaryData>(s, layout);

      // Valid magic, but version 1 data
      const v1Data = new Uint8Array([0x54, 0x53, 0x01, 0x00, 0x2a, 0x00, 0x00, 0x00]);
      expect(() => codec.decode(v1Data)).toThrow("Version mismatch");
    });

    it("handles integer overflow in uint fields", () => {
      interface OverflowData {
        small: number;
      }
      const s = defineSchema("Overflow", {
        version: 1,
        format: "binary",
        fields: [{ name: "small", type: "number" }],
      });
      const layout: FieldLayout[] = [{ name: "small", offset: 0, size: 1, type: "uint8" }];
      const codec = createBinaryCodec<OverflowData>(s, layout);

      // uint8 can only hold 0-255, value 300 should wrap
      const encoded = codec.encode({ small: 300 });
      const decoded = codec.decode(encoded);

      // 300 & 0xFF = 44
      expect(decoded.small).toBe(44);
    });

    it("handles negative numbers in signed vs unsigned fields", () => {
      interface SignedData {
        signedVal: number;
        unsignedVal: number;
      }
      const s = defineSchema("Signed", {
        version: 1,
        format: "binary",
        fields: [
          { name: "signedVal", type: "number" },
          { name: "unsignedVal", type: "number" },
        ],
      });
      const layout: FieldLayout[] = [
        { name: "signedVal", offset: 0, size: 2, type: "int16" },
        { name: "unsignedVal", offset: 2, size: 2, type: "uint16" },
      ];
      const codec = createBinaryCodec<SignedData>(s, layout);

      const encoded = codec.encode({ signedVal: -100, unsignedVal: -100 });
      const decoded = codec.decode(encoded);

      expect(decoded.signedVal).toBe(-100);
      // -100 as uint16 wraps to 65436
      expect(decoded.unsignedVal).toBe(65436);
    });

    it("handles float precision loss in float32", () => {
      interface FloatData {
        precise: number;
      }
      const s = defineSchema("FloatPrecision", {
        version: 1,
        format: "binary",
        fields: [{ name: "precise", type: "number" }],
      });
      const layout: FieldLayout[] = [{ name: "precise", offset: 0, size: 4, type: "float32" }];
      const codec = createBinaryCodec<FloatData>(s, layout);

      const preciseValue = 1.0000001;
      const encoded = codec.encode({ precise: preciseValue });
      const decoded = codec.decode(encoded);

      // float32 has ~7 significant digits, some precision loss expected
      expect(decoded.precise).not.toBe(preciseValue);
      expect(Math.abs(decoded.precise - preciseValue)).toBeLessThan(0.00001);
    });

    it("truncates strings that exceed field size", () => {
      interface StringData {
        text: string;
      }
      const s = defineSchema("StringTruncate", {
        version: 1,
        format: "binary",
        fields: [{ name: "text", type: "string" }],
      });
      const layout: FieldLayout[] = [{ name: "text", offset: 0, size: 10, type: "string" }]; // 10 bytes total, 2 for length
      const codec = createBinaryCodec<StringData>(s, layout);

      const longString = "This is a very long string that exceeds the field size";
      const encoded = codec.encode({ text: longString });
      const decoded = codec.decode(encoded);

      // String should be truncated to 8 bytes (10 - 2 for length prefix)
      expect(decoded.text.length).toBeLessThanOrEqual(8);
    });

    it("handles big-endian encoding", () => {
      interface EndianData {
        value: number;
      }
      const s = defineSchema("BigEndian", {
        version: 1,
        format: "binary",
        fields: [{ name: "value", type: "number" }],
      });
      const layoutLE: FieldLayout[] = [
        { name: "value", offset: 0, size: 4, type: "uint32", encoding: "le" },
      ];
      const layoutBE: FieldLayout[] = [
        { name: "value", offset: 0, size: 4, type: "uint32", encoding: "be" },
      ];

      const codecLE = createBinaryCodec<EndianData>(s, layoutLE);
      const codecBE = createBinaryCodec<EndianData>(s, layoutBE);

      const value = 0x12345678;
      const encodedLE = codecLE.encode({ value });
      const encodedBE = codecBE.encode({ value });

      // The byte order should be different (after header)
      expect(encodedLE[4]).toBe(0x78); // LE: least significant first
      expect(encodedBE[4]).toBe(0x12); // BE: most significant first
    });
  });

  // ==========================================================================
  // Attack 6: Schema Builder Edge Cases
  // ==========================================================================
  describe("schema builder validation", () => {
    it("throws on build when validation fails", () => {
      expect(() => schema("Invalid", 2).field("badField", "string", { since: 5 }).build()).toThrow(
        "validation failed"
      );
    });

    it("requires binary layout for binary format", () => {
      expect(() => schema("Binary", 1, "binary").field("data", "number").buildCodec()).toThrow(
        "requires a field layout"
      );
    });

    it("allows chaining multiple fields", () => {
      const s = schema("Chained", 1)
        .field("a", "string")
        .field("b", "number")
        .field("c", "boolean")
        .build();

      expect(s.fields.length).toBe(3);
    });
  });

  // ==========================================================================
  // Attack 7: Rename and Remove Interaction
  // ==========================================================================
  describe("field rename and remove interactions", () => {
    it("handles renamed field that is later removed", () => {
      const s = defineSchema("RenameRemove", {
        version: 4,
        fields: [
          { name: "id", type: "number" },
          // 'oldName' existed in v1, renamed to 'newName' in v2, removed in v4
          {
            name: "newName",
            type: "string",
            since: 2,
            renamed: { version: 2, oldName: "oldName" },
            removed: 4,
          },
        ],
      });

      const history = generateMigrations(s);
      expect(history.versions).toEqual([1, 2, 3, 4]);

      // v1 data with oldName
      const v1Record = { id: 1, oldName: "value" };

      // Apply migrations
      let result = v1Record as Record<string, unknown>;
      for (const step of history.migrations) {
        result = step.migrate(result);
      }

      // After all migrations, 'newName' should be removed
      expect(result.id).toBe(1);
      expect("newName" in result).toBe(false);
      expect("oldName" in result).toBe(false);
    });

    it("handles multiple renames in the same version", () => {
      const s = defineSchema("MultiRename", {
        version: 2,
        fields: [
          { name: "firstName", type: "string", renamed: { version: 2, oldName: "fname" } },
          { name: "lastName", type: "string", renamed: { version: 2, oldName: "lname" } },
        ],
      });

      const history = generateMigrations(s);
      const v1Record = { fname: "John", lname: "Doe" };

      let result = v1Record as Record<string, unknown>;
      for (const step of history.migrations) {
        if (step.from >= 1 && step.to <= 2) {
          result = step.migrate(result);
        }
      }

      expect(result.firstName).toBe("John");
      expect(result.lastName).toBe("Doe");
      expect("fname" in result).toBe(false);
      expect("lname" in result).toBe(false);
    });

    it("handles rename to existing field name conflict", () => {
      // This is a problematic schema - renaming 'old' to 'existing' when 'existing' already exists
      const s = defineSchema("RenameConflict", {
        version: 2,
        fields: [
          { name: "existing", type: "string" },
          { name: "renamed", type: "string", since: 2, renamed: { version: 2, oldName: "old" } },
        ],
      });

      const codec = createJsonCodec<{ existing: string; renamed: string }>(s);

      // v1 data has both 'existing' and 'old'
      const v1Data = JSON.stringify({ existing: "keep", old: "rename_me" });
      const result = codec.decodeAny(v1Data);

      expect(result.existing).toBe("keep");
      expect(result.renamed).toBe("rename_me");
    });
  });

  // ==========================================================================
  // Attack 8: fieldsAtVersion Edge Cases
  // ==========================================================================
  describe("fieldsAtVersion boundary conditions", () => {
    it("includes field at exact since version", () => {
      const s = defineSchema("ExactSince", {
        version: 3,
        fields: [
          { name: "v1field", type: "string" },
          { name: "v2field", type: "string", since: 2, defaultValue: "" },
          { name: "v3field", type: "string", since: 3, defaultValue: "" },
        ],
      });

      const v2Fields = fieldsAtVersion(s, 2);
      expect(v2Fields.map((f) => f.name)).toEqual(["v1field", "v2field"]);

      const v3Fields = fieldsAtVersion(s, 3);
      expect(v3Fields.map((f) => f.name)).toEqual(["v1field", "v2field", "v3field"]);
    });

    it("excludes field at exact removed version", () => {
      const s = defineSchema("ExactRemoved", {
        version: 3,
        fields: [
          { name: "permanent", type: "string" },
          { name: "temporary", type: "string", removed: 2 },
        ],
      });

      const v1Fields = fieldsAtVersion(s, 1);
      expect(v1Fields.map((f) => f.name)).toEqual(["permanent", "temporary"]);

      const v2Fields = fieldsAtVersion(s, 2);
      expect(v2Fields.map((f) => f.name)).toEqual(["permanent"]);
    });

    it("handles field with both since and removed", () => {
      const s = defineSchema("Ephemeral", {
        version: 5,
        fields: [{ name: "shortLived", type: "string", since: 2, removed: 4, defaultValue: "" }],
      });

      expect(fieldsAtVersion(s, 1).length).toBe(0);
      expect(fieldsAtVersion(s, 2).length).toBe(1);
      expect(fieldsAtVersion(s, 3).length).toBe(1);
      expect(fieldsAtVersion(s, 4).length).toBe(0);
      expect(fieldsAtVersion(s, 5).length).toBe(0);
    });

    it("handles version 0 (before any fields)", () => {
      const s = defineSchema("BeforeTime", {
        version: 2,
        fields: [{ name: "field", type: "string" }],
      });

      const v0Fields = fieldsAtVersion(s, 0);
      expect(v0Fields.length).toBe(0);
    });
  });
});
