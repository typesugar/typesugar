/**
 * Meta/Get/Put Typeclasses — Doobie-style type mapping
 *
 * These typeclasses define how TypeScript types map to SQL types and vice versa.
 * Unlike Doobie's runtime dictionaries, these are specialized at compile time
 * for zero-cost abstraction.
 *
 * ## Core Concepts
 *
 * - **Get<A>** — Read a value of type A from a SQL result row
 * - **Put<A>** — Write a value of type A to a SQL parameter
 * - **Meta<A>** — Both Get and Put (bidirectional mapping)
 *
 * ## Zero-Cost Implementation
 *
 * At compile time, `specialize` inlines the encoding/decoding logic:
 *
 * ```typescript
 * // Before (generic):
 * function readRow<A>(meta: Meta<A>, row: SqlRow): A {
 *   return meta.get(row);
 * }
 *
 * // After (specialized for User):
 * function readUserRow(row: SqlRow): User {
 *   return {
 *     id: row.id as number,
 *     name: row.name as string,
 *     email: row.email as string,
 *   };
 * }
 * ```
 *
 * @module
 */

/**
 * Registration function for specialize integration.
 * This enables zero-cost abstraction when Meta instances are specialized.
 *
 * Note: This is called at module load time to register method sources
 * with the specialize macro's instance registry.
 */
function registerInstanceMethods(
  _dictName: string,
  _brand: string,
  _methods: Record<string, { source: string; params: string[] }>
): void {
  // This function is intentionally a no-op at runtime.
  // The specialize macro reads these registrations at compile time
  // by importing this module and analyzing the call sites.
  //
  // The actual registration happens via the transformer which
  // intercepts these calls and populates the instanceMethodRegistry.
}

// ============================================================================
// Core Types
// ============================================================================

/** A row from a SQL result set */
export type SqlRow = Record<string, unknown>;

/** SQL type names for documentation */
export type SqlTypeName =
  | "TEXT"
  | "VARCHAR"
  | "CHAR"
  | "INTEGER"
  | "INT"
  | "BIGINT"
  | "SMALLINT"
  | "REAL"
  | "DOUBLE PRECISION"
  | "NUMERIC"
  | "DECIMAL"
  | "BOOLEAN"
  | "DATE"
  | "TIME"
  | "TIMESTAMP"
  | "TIMESTAMPTZ"
  | "INTERVAL"
  | "UUID"
  | "JSON"
  | "JSONB"
  | "BYTEA"
  | "ARRAY"
  | "NULL";

// ============================================================================
// Get Typeclass — Read values from SQL
// ============================================================================

/**
 * Get<A> — Typeclass for reading a value of type A from a SQL column.
 *
 * Instances define how to interpret raw SQL values as TypeScript types.
 * The implementation should handle null checking and type coercion.
 */
export interface Get<A> {
  readonly _tag: "Get";
  /** Read a value from a column, returning null if the value is null */
  readonly get: (value: unknown) => A | null;
  /** Read a value, throwing if null */
  readonly unsafeGet: (value: unknown) => A;
  /** The SQL types this Get can read from */
  readonly sqlTypes: readonly SqlTypeName[];
}

/**
 * Create a Get instance from a decoder function.
 */
export function makeGet<A>(
  decode: (value: unknown) => A | null,
  sqlTypes: readonly SqlTypeName[]
): Get<A> {
  return {
    _tag: "Get",
    get: decode,
    unsafeGet: (value: unknown) => {
      const result = decode(value);
      if (result === null) {
        throw new Error(`Unexpected NULL value`);
      }
      return result;
    },
    sqlTypes,
  };
}

// ============================================================================
// Put Typeclass — Write values to SQL
// ============================================================================

/**
 * Put<A> — Typeclass for writing a value of type A to a SQL parameter.
 *
 * Instances define how to convert TypeScript values to SQL-compatible values.
 */
export interface Put<A> {
  readonly _tag: "Put";
  /** Convert a value to its SQL representation */
  readonly put: (value: A) => unknown;
  /** The SQL type this Put writes to */
  readonly sqlType: SqlTypeName;
}

/**
 * Create a Put instance from an encoder function.
 */
export function makePut<A>(encode: (value: A) => unknown, sqlType: SqlTypeName): Put<A> {
  return {
    _tag: "Put",
    put: encode,
    sqlType,
  };
}

// ============================================================================
// Meta Typeclass — Bidirectional mapping
// ============================================================================

/**
 * Meta<A> — Bidirectional typeclass combining Get and Put.
 *
 * Most types will use Meta for both reading and writing. Use separate
 * Get/Put instances when the read and write representations differ.
 */
export interface Meta<A> {
  readonly _tag: "Meta";
  /** Read a value from a column, returning null if the value is null */
  readonly get: (value: unknown) => A | null;
  /** Read a value, throwing if null */
  readonly unsafeGet: (value: unknown) => A;
  /** The SQL types this Meta can read from */
  readonly sqlTypes: readonly SqlTypeName[];
  /** Convert a value to its SQL representation */
  readonly put: (value: A) => unknown;
  /** The SQL type this Meta writes to */
  readonly sqlType: SqlTypeName;
}

/**
 * Create a Meta instance from a decoder and encoder.
 */
export function makeMeta<A>(
  decode: (value: unknown) => A | null,
  encode: (value: A) => unknown,
  sqlType: SqlTypeName,
  readTypes?: readonly SqlTypeName[]
): Meta<A> {
  return {
    _tag: "Meta",
    get: decode,
    unsafeGet: (value: unknown) => {
      const result = decode(value);
      if (result === null) {
        throw new Error(`Unexpected NULL value`);
      }
      return result;
    },
    put: encode,
    sqlType,
    sqlTypes: readTypes ?? [sqlType],
  };
}

// ============================================================================
// Primitive Meta Instances
// ============================================================================

/** Meta instance for strings */
export const stringMeta: Meta<string> = makeMeta(
  (v) => (typeof v === "string" ? v : v === null ? null : String(v)),
  (v) => v,
  "TEXT",
  ["TEXT", "VARCHAR", "CHAR"]
);

/** Meta instance for numbers (integers and floats) */
export const numberMeta: Meta<number> = makeMeta(
  (v) => (typeof v === "number" ? v : v === null ? null : Number(v)),
  (v) => v,
  "NUMERIC",
  ["INTEGER", "INT", "BIGINT", "SMALLINT", "REAL", "DOUBLE PRECISION", "NUMERIC", "DECIMAL"]
);

/** Meta instance for integers specifically */
export const intMeta: Meta<number> = makeMeta(
  (v) => {
    if (v === null) return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isInteger(n) ? n : Math.trunc(n);
  },
  (v) => Math.trunc(v),
  "INTEGER",
  ["INTEGER", "INT", "BIGINT", "SMALLINT"]
);

/** Meta instance for bigints */
export const bigintMeta: Meta<bigint> = makeMeta(
  (v) => {
    if (v === null) return null;
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(Math.trunc(v));
    if (typeof v === "string") return BigInt(v);
    return null;
  },
  (v) => v.toString(),
  "BIGINT"
);

/** Meta instance for booleans */
export const booleanMeta: Meta<boolean> = makeMeta(
  (v) => {
    if (v === null) return null;
    if (typeof v === "boolean") return v;
    if (v === "t" || v === "true" || v === 1) return true;
    if (v === "f" || v === "false" || v === 0) return false;
    return Boolean(v);
  },
  (v) => v,
  "BOOLEAN"
);

/** Meta instance for Date objects */
export const dateMeta: Meta<Date> = makeMeta(
  (v) => {
    if (v === null) return null;
    if (v instanceof Date) return v;
    if (typeof v === "string" || typeof v === "number") {
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  },
  (v) => v.toISOString(),
  "TIMESTAMPTZ",
  ["DATE", "TIME", "TIMESTAMP", "TIMESTAMPTZ"]
);

/** Meta instance for date-only (no time component) */
export const dateOnlyMeta: Meta<Date> = makeMeta(
  (v) => {
    if (v === null) return null;
    if (v instanceof Date) return v;
    if (typeof v === "string") {
      // Parse YYYY-MM-DD format
      const d = new Date(v + "T00:00:00Z");
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  },
  (v) => v.toISOString().split("T")[0],
  "DATE"
);

/** Meta instance for UUIDs (as strings) */
export const uuidMeta: Meta<string> = makeMeta(
  (v) => {
    if (v === null) return null;
    if (typeof v === "string") {
      // Basic UUID format validation
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      return uuidRegex.test(v) ? v : null;
    }
    return null;
  },
  (v) => v,
  "UUID"
);

/** Meta instance for JSON values */
export const jsonMeta: Meta<unknown> = makeMeta(
  (v) => {
    if (v === null) return null;
    if (typeof v === "string") {
      try {
        return JSON.parse(v);
      } catch {
        return null;
      }
    }
    return v;
  },
  (v) => JSON.stringify(v),
  "JSONB",
  ["JSON", "JSONB"]
);

/** Meta instance for Buffer/binary data */
export const bufferMeta: Meta<Buffer> = makeMeta(
  (v) => {
    if (v === null) return null;
    if (Buffer.isBuffer(v)) return v;
    if (typeof v === "string") {
      // Assume hex encoding for bytea
      return Buffer.from(v.replace(/^\\x/, ""), "hex");
    }
    return null;
  },
  (v) => v,
  "BYTEA"
);

// ============================================================================
// Composite Meta Constructors
// ============================================================================

/**
 * Create a Meta for nullable types.
 * Wraps an existing Meta to handle SQL NULLs.
 */
export function nullable<A>(meta: Meta<A>): Meta<A | null> {
  return makeMeta<A | null>(
    (v) => (v === null ? null : meta.get(v)),
    (v) => (v === null ? null : meta.put(v as A)),
    meta.sqlType,
    meta.sqlTypes
  );
}

/**
 * Create a Meta for arrays.
 * Maps to SQL ARRAY types.
 */
export function arrayMeta<A>(elementMeta: Meta<A>): Meta<A[]> {
  return makeMeta(
    (v) => {
      if (v === null) return null;
      if (!Array.isArray(v)) return null;
      const result: A[] = [];
      for (const item of v) {
        const decoded = elementMeta.get(item);
        if (decoded !== null) {
          result.push(decoded);
        }
      }
      return result;
    },
    (v) => v.map((item) => elementMeta.put(item)),
    "ARRAY"
  );
}

/**
 * Create a Meta for optional types.
 * Maps undefined to SQL NULL.
 */
export function optional<A>(meta: Meta<A>): Meta<A | undefined> {
  return makeMeta<A | undefined>(
    (v) => (v === null || v === undefined ? undefined : (meta.get(v) ?? undefined)),
    (v) => (v === undefined ? null : meta.put(v as A)),
    meta.sqlType,
    meta.sqlTypes
  );
}

// ============================================================================
// Composite/Row Meta — For reading entire rows
// ============================================================================

/**
 * Read<A> — Typeclass for reading an entire row as type A.
 *
 * Unlike Get (which reads a single column), Read decodes an entire result row.
 * This is what Doobie calls the Read typeclass.
 */
export interface Read<A> {
  readonly _tag: "Read";
  /** Read a row, returning null if any required field is missing */
  readonly read: (row: SqlRow) => A | null;
  /** Read a row, throwing on missing fields */
  readonly unsafeRead: (row: SqlRow) => A;
  /** The column names this Read expects */
  readonly columns: readonly string[];
}

/**
 * Write<A> — Typeclass for writing a value as parameter values.
 *
 * Unlike Put (which writes a single value), Write produces multiple parameters.
 */
export interface Write<A> {
  readonly _tag: "Write";
  /** Convert a value to an array of SQL parameters in column order */
  readonly write: (value: A) => readonly unknown[];
  /** The column names in parameter order */
  readonly columns: readonly string[];
}

// ============================================================================
// Register Meta instances for specialize
// ============================================================================

// These registrations allow `specialize` to inline Meta operations

registerInstanceMethods("stringMeta", "Meta", {
  get: {
    source: '(v) => (typeof v === "string" ? v : v === null ? null : String(v))',
    params: ["v"],
  },
  unsafeGet: {
    source:
      '(v) => { const r = typeof v === "string" ? v : v === null ? null : String(v); if (r === null) throw new Error("Unexpected NULL"); return r; }',
    params: ["v"],
  },
  put: {
    source: "(v) => v",
    params: ["v"],
  },
});

registerInstanceMethods("numberMeta", "Meta", {
  get: {
    source: '(v) => (typeof v === "number" ? v : v === null ? null : Number(v))',
    params: ["v"],
  },
  unsafeGet: {
    source:
      '(v) => { const r = typeof v === "number" ? v : v === null ? null : Number(v); if (r === null) throw new Error("Unexpected NULL"); return r; }',
    params: ["v"],
  },
  put: {
    source: "(v) => v",
    params: ["v"],
  },
});

registerInstanceMethods("booleanMeta", "Meta", {
  get: {
    source:
      '(v) => { if (v === null) return null; if (typeof v === "boolean") return v; if (v === "t" || v === "true" || v === 1) return true; if (v === "f" || v === "false" || v === 0) return false; return Boolean(v); }',
    params: ["v"],
  },
  unsafeGet: {
    source:
      '(v) => { const r = booleanMeta.get(v); if (r === null) throw new Error("Unexpected NULL"); return r; }',
    params: ["v"],
  },
  put: {
    source: "(v) => v",
    params: ["v"],
  },
});

registerInstanceMethods("dateMeta", "Meta", {
  get: {
    source:
      '(v) => { if (v === null) return null; if (v instanceof Date) return v; if (typeof v === "string" || typeof v === "number") { const d = new Date(v); return isNaN(d.getTime()) ? null : d; } return null; }',
    params: ["v"],
  },
  unsafeGet: {
    source:
      '(v) => { const r = dateMeta.get(v); if (r === null) throw new Error("Unexpected NULL"); return r; }',
    params: ["v"],
  },
  put: {
    source: "(v) => v.toISOString()",
    params: ["v"],
  },
});

// ============================================================================
// Type-Level Utilities
// ============================================================================

/**
 * Extract the TypeScript type that a Meta handles.
 */
export type MetaType<M> = M extends Meta<infer A> ? A : never;

/**
 * Extract the TypeScript type that a Get handles.
 */
export type GetType<G> = G extends Get<infer A> ? A : never;

/**
 * Extract the TypeScript type that a Put handles.
 */
export type PutType<P> = P extends Put<infer A> ? A : never;

/**
 * Extract the TypeScript type that a Read handles.
 */
export type ReadType<R> = R extends Read<infer A> ? A : never;

/**
 * Extract the TypeScript type that a Write handles.
 */
export type WriteType<W> = W extends Write<infer A> ? A : never;
