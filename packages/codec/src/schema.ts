import type {
  FieldMeta,
  Migration,
  Schema,
  SchemaValidationError,
  VersionHistory,
} from "./types.js";

/** Define a schema programmatically. */
export function defineSchema(
  name: string,
  options: {
    version: number;
    format?: "json" | "binary";
    fields: FieldMeta[];
  }
): Schema {
  return {
    name,
    version: options.version,
    format: options.format ?? "json",
    fields: options.fields,
  };
}

/** Validate schema evolution rules, returning all detected errors. */
export function validateSchema(schema: Schema): SchemaValidationError[] {
  const errors: SchemaValidationError[] = [];

  for (const field of schema.fields) {
    if (field.since !== undefined && field.since > schema.version) {
      errors.push({
        field: field.name,
        message: `@since(${field.since}) exceeds current schema version ${schema.version}`,
        version: field.since,
      });
    }

    if (field.since !== undefined && field.since < 1) {
      errors.push({
        field: field.name,
        message: `@since version must be >= 1, got ${field.since}`,
        version: field.since,
      });
    }

    if (field.removed !== undefined && field.removed > schema.version) {
      errors.push({
        field: field.name,
        message: `@removed(${field.removed}) exceeds current schema version ${schema.version}`,
        version: field.removed,
      });
    }

    if (field.removed !== undefined && field.since !== undefined && field.removed <= field.since) {
      errors.push({
        field: field.name,
        message: `@removed(${field.removed}) must be greater than @since(${field.since})`,
        version: field.removed,
      });
    }

    if (field.renamed !== undefined && field.renamed.version > schema.version) {
      errors.push({
        field: field.name,
        message: `@renamed version ${field.renamed.version} exceeds current schema version ${schema.version}`,
        version: field.renamed.version,
      });
    }

    const addedVersion = field.since ?? 1;
    if (addedVersion > 1 && !field.optional && field.defaultValue === undefined) {
      errors.push({
        field: field.name,
        message: `Non-optional field added after v1 must have a @defaultValue`,
        version: addedVersion,
      });
    }
  }

  return errors;
}

/** Return the fields that are active at a given schema version. */
export function fieldsAtVersion(schema: Schema, version: number): FieldMeta[] {
  return schema.fields.filter((f) => {
    const addedAt = f.since ?? 1;
    if (version < addedAt) return false;
    if (f.removed !== undefined && version >= f.removed) return false;
    return true;
  });
}

/**
 * Generate the complete migration chain from version 1 to the current version.
 *
 * Each step migrates from version N to N+1 by:
 * - Adding fields introduced in N+1 (with their default values)
 * - Removing fields dropped in N+1
 * - Renaming fields whose rename version is N+1
 */
export function generateMigrations(schema: Schema): VersionHistory {
  const versions: number[] = [];
  for (let v = 1; v <= schema.version; v++) {
    versions.push(v);
  }

  const migrations: VersionHistory["migrations"][number][] = [];

  for (let from = 1; from < schema.version; from++) {
    const to = from + 1;
    const fieldsAdded = schema.fields.filter((f) => f.since === to);
    const fieldsRemoved = schema.fields.filter((f) => f.removed === to);
    const fieldsRenamed = schema.fields.filter((f) => f.renamed?.version === to);

    const migrate: Migration = (value) => {
      const result = { ...value };

      for (const f of fieldsRenamed) {
        if (f.renamed!.oldName in result) {
          result[f.name] = result[f.renamed!.oldName];
          delete result[f.renamed!.oldName];
        }
      }

      for (const f of fieldsAdded) {
        if (!(f.name in result)) {
          result[f.name] = f.defaultValue ?? null;
        }
      }

      for (const f of fieldsRemoved) {
        delete result[f.name];
      }

      return result;
    };

    migrations.push({ from, to, migrate });
  }

  return { versions, migrations };
}
