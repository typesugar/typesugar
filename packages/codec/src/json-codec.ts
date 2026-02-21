import type { Codec, Schema } from "./types.js";
import { fieldsAtVersion, generateMigrations } from "./schema.js";

/** Version field embedded in JSON payloads. */
const VERSION_KEY = "__v";

/** Create a JSON codec from a schema definition. */
export function createJsonCodec<T>(schema: Schema): Codec<T> {
  const history = generateMigrations(schema);

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
      return stripVersionField(parsed) as T;
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

      return record as T;
    },
  };
}

function encodeJson(value: Record<string, unknown>, schema: Schema): string {
  const activeFields = fieldsAtVersion(schema, schema.version);
  const output: Record<string, unknown> = { [VERSION_KEY]: schema.version };

  for (const field of activeFields) {
    const v = value[field.name];
    if (v !== undefined) {
      output[field.name] = v;
    } else if (field.defaultValue !== undefined) {
      output[field.name] = field.defaultValue;
    } else if (field.optional) {
      output[field.name] = null;
    }
  }

  return JSON.stringify(output);
}

function stripVersionField(record: Record<string, unknown>): Record<string, unknown> {
  const { [VERSION_KEY]: _, ...rest } = record;
  return rest;
}
