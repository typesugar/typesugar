/**
 * @typesugar/codec — Versioned codec generation with schema evolution.
 *
 * Define versioned schemas for your types and get automatic migration
 * chains, JSON codecs, and binary codecs with zero external dependencies.
 *
 * @packageDocumentation
 */

export type {
  FieldMeta,
  Schema,
  Codec,
  Migration,
  VersionHistory,
  SchemaValidationError,
} from "./types.js";

export { defineSchema, validateSchema, fieldsAtVersion, generateMigrations } from "./schema.js";

export { createJsonCodec } from "./json-codec.js";

export { createBinaryCodec, type FieldLayout } from "./binary-codec.js";

export { SchemaBuilder, schema } from "./decorators.js";

export { codecMacro, sinceMacro, removedMacro, renamedMacro, defaultValueMacro } from "./macros.js";
