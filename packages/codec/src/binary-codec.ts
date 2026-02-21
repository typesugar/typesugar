import type { Codec, Schema } from "./types.js";
import { generateMigrations } from "./schema.js";

/** Binary format magic bytes: 'T' 'S' (0x54 0x53). */
const MAGIC_BYTE_0 = 0x54;
const MAGIC_BYTE_1 = 0x53;
const HEADER_SIZE = 4;

/** Layout specification for a single binary field. */
export interface FieldLayout {
  readonly name: string;
  readonly offset: number;
  readonly size: number;
  readonly type:
    | "uint8"
    | "uint16"
    | "uint32"
    | "int8"
    | "int16"
    | "int32"
    | "float32"
    | "float64"
    | "string"
    | "bytes";
  /** Little-endian or big-endian. Defaults to LE. */
  readonly encoding?: "le" | "be";
}

/** Create a binary codec with an explicit field layout. */
export function createBinaryCodec<T>(
  schema: Schema,
  layout: FieldLayout[],
): Codec<T> {
  const history = generateMigrations(schema);

  const totalSize =
    HEADER_SIZE +
    layout.reduce((max, f) => Math.max(max, f.offset + f.size), 0);

  return {
    schema,

    encode(value: T): Uint8Array {
      const record = value as Record<string, unknown>;
      const buf = new ArrayBuffer(totalSize);
      const view = new DataView(buf);

      view.setUint8(0, MAGIC_BYTE_0);
      view.setUint8(1, MAGIC_BYTE_1);
      view.setUint16(2, schema.version, true);

      encodeBinary(record, layout, view);
      return new Uint8Array(buf);
    },

    decode(data: string | Uint8Array): T {
      const bytes = ensureBytes(data);
      validateHeader(bytes, schema.version);
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );
      return decodeBinary(layout, view) as T;
    },

    decodeAny(data: string | Uint8Array): T {
      const bytes = ensureBytes(data);
      validateMagic(bytes);
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );
      const version = view.getUint16(2, true);

      let record = decodeBinary(layout, view);

      if (version < schema.version) {
        for (const step of history.migrations) {
          if (step.from >= version && step.to <= schema.version) {
            record = step.migrate(record);
          }
        }
      }

      return record as T;
    },
  };
}

function ensureBytes(data: string | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) return data;
  throw new Error("Binary codec requires Uint8Array input");
}

function validateMagic(bytes: Uint8Array): void {
  if (
    bytes.length < HEADER_SIZE ||
    bytes[0] !== MAGIC_BYTE_0 ||
    bytes[1] !== MAGIC_BYTE_1
  ) {
    throw new Error("Invalid binary codec header: bad magic bytes");
  }
}

function validateHeader(bytes: Uint8Array, expectedVersion: number): void {
  validateMagic(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(2, true);
  if (version !== expectedVersion) {
    throw new Error(
      `Version mismatch: data is v${version}, codec expects v${expectedVersion}. Use decodeAny() for migration.`,
    );
  }
}

function encodeBinary(
  value: Record<string, unknown>,
  layout: FieldLayout[],
  view: DataView,
): void {
  for (const field of layout) {
    const v = value[field.name];
    const abs = HEADER_SIZE + field.offset;
    const le = field.encoding !== "be";

    switch (field.type) {
      case "uint8":
        view.setUint8(abs, Number(v ?? 0));
        break;
      case "uint16":
        view.setUint16(abs, Number(v ?? 0), le);
        break;
      case "uint32":
        view.setUint32(abs, Number(v ?? 0), le);
        break;
      case "int8":
        view.setInt8(abs, Number(v ?? 0));
        break;
      case "int16":
        view.setInt16(abs, Number(v ?? 0), le);
        break;
      case "int32":
        view.setInt32(abs, Number(v ?? 0), le);
        break;
      case "float32":
        view.setFloat32(abs, Number(v ?? 0), le);
        break;
      case "float64":
        view.setFloat64(abs, Number(v ?? 0), le);
        break;
      case "string": {
        const str = String(v ?? "");
        const encoded = new TextEncoder().encode(str);
        const len = Math.min(encoded.length, field.size - 2);
        view.setUint16(abs, len, le);
        const target = new Uint8Array(view.buffer, view.byteOffset + abs + 2, len);
        target.set(encoded.subarray(0, len));
        break;
      }
      case "bytes": {
        const src =
          v instanceof Uint8Array ? v : new Uint8Array(field.size);
        const copyLen = Math.min(src.length, field.size);
        const target = new Uint8Array(view.buffer, view.byteOffset + abs, copyLen);
        target.set(src.subarray(0, copyLen));
        break;
      }
    }
  }
}

function decodeBinary(
  layout: FieldLayout[],
  view: DataView,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const field of layout) {
    const abs = HEADER_SIZE + field.offset;
    const le = field.encoding !== "be";

    switch (field.type) {
      case "uint8":
        result[field.name] = view.getUint8(abs);
        break;
      case "uint16":
        result[field.name] = view.getUint16(abs, le);
        break;
      case "uint32":
        result[field.name] = view.getUint32(abs, le);
        break;
      case "int8":
        result[field.name] = view.getInt8(abs);
        break;
      case "int16":
        result[field.name] = view.getInt16(abs, le);
        break;
      case "int32":
        result[field.name] = view.getInt32(abs, le);
        break;
      case "float32":
        result[field.name] = view.getFloat32(abs, le);
        break;
      case "float64":
        result[field.name] = view.getFloat64(abs, le);
        break;
      case "string": {
        const len = view.getUint16(abs, le);
        const bytes = new Uint8Array(view.buffer, view.byteOffset + abs + 2, len);
        result[field.name] = new TextDecoder().decode(bytes);
        break;
      }
      case "bytes": {
        result[field.name] = new Uint8Array(
          view.buffer.slice(
            view.byteOffset + abs,
            view.byteOffset + abs + field.size,
          ),
        );
        break;
      }
    }
  }

  return result;
}
