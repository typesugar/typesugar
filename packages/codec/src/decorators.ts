import type { Codec, FieldMeta, Schema } from "./types.js";
import { defineSchema, validateSchema } from "./schema.js";
import { createJsonCodec } from "./json-codec.js";
import { createBinaryCodec, type FieldLayout } from "./binary-codec.js";

/**
 * Fluent builder for constructing versioned schemas.
 *
 * ```ts
 * const codec = schema<User>("User", 3)
 *   .field("name", "string")
 *   .field("email", "string", { since: 2, defaultValue: "" })
 *   .buildCodec();
 * ```
 */
export class SchemaBuilder<T> {
  private readonly _name: string;
  private readonly _version: number;
  private readonly _format: "json" | "binary";
  private readonly _fields: FieldMeta[] = [];
  private _layout?: FieldLayout[];

  constructor(name: string, version: number, format?: "json" | "binary") {
    this._name = name;
    this._version = version;
    this._format = format ?? "json";
  }

  /** Add a field to the schema with optional versioning metadata. */
  field(
    name: string,
    type: string,
    options?: {
      since?: number;
      removed?: number;
      renamed?: { version: number; oldName: string };
      defaultValue?: unknown;
      optional?: boolean;
    },
  ): this {
    this._fields.push({ name, type, ...options });
    return this;
  }

  /** Set the binary field layout (only used when format is "binary"). */
  binaryLayout(layout: FieldLayout[]): this {
    this._layout = layout;
    return this;
  }

  /** Build the schema, throwing on validation errors. */
  build(): Schema {
    const s = defineSchema(this._name, {
      version: this._version,
      format: this._format,
      fields: this._fields,
    });

    const errors = validateSchema(s);
    if (errors.length > 0) {
      const messages = errors.map(
        (e) => `  ${e.field}: ${e.message}`,
      );
      throw new Error(
        `Schema "${this._name}" validation failed:\n${messages.join("\n")}`,
      );
    }

    return s;
  }

  /** Build the schema and create a codec from it. */
  buildCodec(): Codec<T> {
    const s = this.build();
    if (s.format === "binary") {
      if (!this._layout) {
        throw new Error(
          `Binary schema "${this._name}" requires a field layout. Call .binaryLayout() before .buildCodec().`,
        );
      }
      return createBinaryCodec<T>(s, this._layout);
    }
    return createJsonCodec<T>(s);
  }
}

/** Create a new schema builder. */
export function schema<T>(
  name: string,
  version: number,
  format?: "json" | "binary",
): SchemaBuilder<T> {
  return new SchemaBuilder<T>(name, version, format);
}
