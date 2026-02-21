/** Metadata for a single field within a versioned schema. */
export interface FieldMeta {
  readonly name: string;
  readonly type: string;
  /** Version in which this field was first introduced. */
  readonly since?: number;
  /** Version in which this field was removed. */
  readonly removed?: number;
  /** Rename history — the old name and the version of the rename. */
  readonly renamed?: { version: number; oldName: string };
  /** Default value used when decoding older versions that lack this field. */
  readonly defaultValue?: unknown;
  /** Whether the field is optional (may be null/undefined). */
  readonly optional?: boolean;
}

/** Schema describing a versioned type's serialization layout. */
export interface Schema {
  readonly name: string;
  readonly version: number;
  readonly fields: ReadonlyArray<FieldMeta>;
  readonly format: "json" | "binary";
}

/** Encode/decode pair for a specific type, with version migration support. */
export interface Codec<T> {
  readonly schema: Schema;
  /** Encode a value at the current schema version. */
  encode(value: T): string | Uint8Array;
  /** Decode data that matches the current schema version exactly. */
  decode(data: string | Uint8Array): T;
  /** Decode data from any known version, applying migrations as needed. */
  decodeAny(data: string | Uint8Array): T;
}

/** A function that migrates a record from one version to the next. */
export type Migration = (
  value: Record<string, unknown>,
) => Record<string, unknown>;

/** The full migration chain for a versioned type. */
export interface VersionHistory {
  readonly versions: ReadonlyArray<number>;
  readonly migrations: ReadonlyArray<{
    from: number;
    to: number;
    migrate: Migration;
  }>;
}

/** A single schema validation error. */
export interface SchemaValidationError {
  readonly field: string;
  readonly message: string;
  readonly version?: number;
}
