import type { Codec, FieldMeta, Schema } from "./types.js";
import { cloneDefault, fieldsAtVersion, generateMigrations } from "./schema.js";

/** Version field embedded in JSON payloads. */
const VERSION_KEY = "__v";

/**
 * Create a JSON codec from a schema definition.
 *
 * Encoding is type-directed by each field's `type`:
 * - `"date"`: `Date` <-> ISO-8601 string
 * - `"bigint"`: `bigint` <-> decimal string
 * - everything else: as `JSON.stringify` / `JSON.parse` produce it
 *
 * Absent optional fields stay absent (they are not turned into `null`), and
 * `defaultValue`s are copied per use, so a mutable default is never shared.
 */
export function createJsonCodec<T>(schema: Schema): Codec<T> {
  if (schema.fields.some((f) => f.name === VERSION_KEY)) {
    throw new Error(
      `Schema "${schema.name}": field name "${VERSION_KEY}" is reserved for the JSON codec's version tag`
    );
  }
  const history = generateMigrations(schema);
  const currentFields = fieldsAtVersion(schema, schema.version);

  return {
    schema,

    encode(value: T): string {
      return encodeJson(value as Record<string, unknown>, schema);
    },

    decode(data: string | Uint8Array): T {
      const json = typeof data === "string" ? data : new TextDecoder().decode(data);
      const parsed = JSON.parse(json) as Record<string, unknown>;
      const version = typeof parsed[VERSION_KEY] === "number" ? parsed[VERSION_KEY] : 1;
      if (version !== schema.version) {
        throw new Error(
          `Version mismatch: data is v${version}, codec expects v${schema.version}. Use decodeAny() for migration.`
        );
      }
      return reviveFields(stripVersionField(parsed), currentFields) as T;
    },

    decodeAny(data: string | Uint8Array): T {
      const json = typeof data === "string" ? data : new TextDecoder().decode(data);
      const parsed = JSON.parse(json) as Record<string, unknown>;
      const version = typeof parsed[VERSION_KEY] === "number" ? parsed[VERSION_KEY] : 1;
      let record = stripVersionField(parsed);

      if (version > schema.version) {
        throw new Error(
          `Cannot decode v${version} data with a v${schema.version} codec. ` +
            `Upgrade the codec schema to v${version} or later.`
        );
      }

      if (version < schema.version) {
        for (const step of history.migrations) {
          if (step.from >= version && step.to <= schema.version) {
            record = step.migrate(record);
          }
        }
      }

      return reviveFields(record, currentFields) as T;
    },
  };
}

function encodeField(field: FieldMeta, v: unknown): unknown {
  if (field.type === "bigint" && typeof v === "bigint") return v.toString();
  if (field.type === "date" && v instanceof Date) return v.toISOString();
  return v;
}

function encodeJson(value: Record<string, unknown>, schema: Schema): string {
  const activeFields = fieldsAtVersion(schema, schema.version);
  const output: Record<string, unknown> = { [VERSION_KEY]: schema.version };

  for (const field of activeFields) {
    const v = value[field.name];
    if (v !== undefined) {
      output[field.name] = encodeField(field, v);
    } else if (field.defaultValue !== undefined) {
      output[field.name] = encodeField(field, cloneDefault(field.defaultValue));
    }
    // An absent field (optional or not) stays absent.
  }

  return JSON.stringify(output);
}

function reviveFields(
  record: Record<string, unknown>,
  fields: readonly FieldMeta[]
): Record<string, unknown> {
  for (const field of fields) {
    const v = record[field.name];
    if (typeof v !== "string") continue;
    if (field.type === "date") {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        throw new Error(`Field "${field.name}": invalid date string ${JSON.stringify(v)}`);
      }
      record[field.name] = d;
    } else if (field.type === "bigint") {
      record[field.name] = BigInt(v);
    }
  }
  return record;
}

function stripVersionField(record: Record<string, unknown>): Record<string, unknown> {
  const { [VERSION_KEY]: _, ...rest } = record;
  return rest;
}
