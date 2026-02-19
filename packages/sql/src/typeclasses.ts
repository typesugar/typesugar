/**
 * Doobie-Style SQL Typeclasses
 *
 * This module provides a complete typeclass hierarchy for SQL type mapping,
 * inspired by Scala's Doobie library but integrated with ttfx's typeclass system.
 *
 * ## Typeclass Hierarchy
 *
 * ```
 *                    ┌─────────┐
 *                    │  Meta   │  (bidirectional single-column)
 *                    └────┬────┘
 *                    ┌────┴────┐
 *               ┌────┴───┐ ┌───┴────┐
 *               │  Get   │ │  Put   │  (single-column read/write)
 *               └────────┘ └────────┘
 *
 *                    ┌─────────┐
 *                    │ Codec   │  (bidirectional row-level)
 *                    └────┬────┘
 *                    ┌────┴────┐
 *               ┌────┴───┐ ┌───┴────┐
 *               │  Read  │ │ Write  │  (row-level read/write)
 *               └────────┘ └────────┘
 * ```
 *
 * ## Auto-Derivation
 *
 * ```typescript
 * @deriving(Read, Write)
 * interface User {
 *   id: number;
 *   name: string;
 *   email: string;
 * }
 *
 * // Auto-generates:
 * // - ReadUser: Read<User> from field Get instances
 * // - WriteUser: Write<User> from field Put instances
 *
 * // Use with summon:
 * const reader = summon<Read<User>>();
 * const user = reader.read(row);
 * ```
 *
 * ## Zero-Cost Specialization
 *
 * When used with `specialize`, all typeclass operations are inlined:
 *
 * ```typescript
 * const readUser = specialize(
 *   <A>(read: Read<A>, row: SqlRow) => read.read(row),
 *   summon<Read<User>>(),
 * );
 * // Compiles to direct field access without dictionary lookups
 * ```
 *
 * @module
 */

import {
  registerInstanceMethods,
  registerInstanceMethodsFromAST,
} from "../../../src/macros/specialize.js";

// ============================================================================
// SQL Types
// ============================================================================

/** A row from a SQL result set */
export type SqlRow = Record<string, unknown>;

/** SQL type names for documentation and validation */
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
// Get Typeclass — Read a single column value
// ============================================================================

/**
 * @typeclass
 * Get<A> — Typeclass for reading a value of type A from a SQL column.
 *
 * Instances define how to interpret raw SQL values as TypeScript types.
 * This is the fundamental building block for SQL-to-TypeScript mapping.
 *
 * ## Laws
 *
 * 1. Totality: `get` must handle null values gracefully
 * 2. Consistency: `unsafeGet(x) === get(x)` when `get(x) !== null`
 *
 * ## Derivation
 *
 * Get instances for newtypes can be derived via `contramap`:
 *
 * ```typescript
 * const getUserId: Get<UserId> = Get.string.map(UserId);
 * ```
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

/** Get typeclass companion with constructors and combinators */
export const Get = {
  /**
   * Create a Get instance from a decoder function.
   */
  make<A>(
    decode: (value: unknown) => A | null,
    sqlTypes: readonly SqlTypeName[],
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
  },

  /**
   * Functor map — transform the output type.
   * Used to derive Get instances for newtypes.
   */
  map<A, B>(ga: Get<A>, f: (a: A) => B): Get<B> {
    return Get.make((v) => {
      const a = ga.get(v);
      return a === null ? null : f(a);
    }, ga.sqlTypes);
  },

  /**
   * Make a Get nullable — handle SQL NULL explicitly.
   */
  nullable<A>(ga: Get<A>): Get<A | null> {
    return Get.make(
      (v) => (v === null ? null : ga.get(v)),
      [...ga.sqlTypes, "NULL"],
    );
  },

  /**
   * Make a Get optional — map NULL to undefined.
   */
  optional<A>(ga: Get<A>): Get<A | undefined> {
    return Get.make(
      (v) =>
        v === null || v === undefined ? undefined : (ga.get(v) ?? undefined),
      [...ga.sqlTypes, "NULL"],
    );
  },

  // --------------------------------------------------------------------------
  // Primitive Instances
  // --------------------------------------------------------------------------

  /** Get instance for strings */
  string: Get.make(
    (v) => (typeof v === "string" ? v : v === null ? null : String(v)),
    ["TEXT", "VARCHAR", "CHAR"],
  ),

  /** Get instance for numbers */
  number: Get.make(
    (v) => (typeof v === "number" ? v : v === null ? null : Number(v)),
    [
      "INTEGER",
      "INT",
      "BIGINT",
      "SMALLINT",
      "REAL",
      "DOUBLE PRECISION",
      "NUMERIC",
      "DECIMAL",
    ],
  ),

  /** Get instance for integers */
  int: Get.make(
    (v) => {
      if (v === null) return null;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isInteger(n) ? n : Math.trunc(n);
    },
    ["INTEGER", "INT", "BIGINT", "SMALLINT"],
  ),

  /** Get instance for bigints */
  bigint: Get.make(
    (v) => {
      if (v === null) return null;
      if (typeof v === "bigint") return v;
      if (typeof v === "number") return BigInt(Math.trunc(v));
      if (typeof v === "string") return BigInt(v);
      return null;
    },
    ["BIGINT"],
  ),

  /** Get instance for booleans */
  boolean: Get.make(
    (v) => {
      if (v === null) return null;
      if (typeof v === "boolean") return v;
      if (v === "t" || v === "true" || v === 1) return true;
      if (v === "f" || v === "false" || v === 0) return false;
      return Boolean(v);
    },
    ["BOOLEAN"],
  ),

  /** Get instance for Date */
  date: Get.make(
    (v) => {
      if (v === null) return null;
      if (v instanceof Date) return v;
      if (typeof v === "string" || typeof v === "number") {
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
      }
      return null;
    },
    ["DATE", "TIME", "TIMESTAMP", "TIMESTAMPTZ"],
  ),

  /** Get instance for date-only (no time component) */
  dateOnly: Get.make(
    (v) => {
      if (v === null) return null;
      if (v instanceof Date) return v;
      if (typeof v === "string") {
        const d = new Date(v + "T00:00:00Z");
        return isNaN(d.getTime()) ? null : d;
      }
      return null;
    },
    ["DATE"],
  ),

  /** Get instance for UUIDs */
  uuid: Get.make(
    (v) => {
      if (v === null) return null;
      if (typeof v === "string") {
        const uuidRegex =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        return uuidRegex.test(v) ? v : null;
      }
      return null;
    },
    ["UUID"],
  ),

  /** Get instance for JSON */
  json: Get.make(
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
    ["JSON", "JSONB"],
  ),

  /** Get instance for typed JSON */
  jsonAs<A>(): Get<A> {
    return Get.json as Get<A>;
  },

  /** Get instance for Buffer */
  buffer: Get.make(
    (v) => {
      if (v === null) return null;
      if (Buffer.isBuffer(v)) return v;
      if (typeof v === "string") {
        return Buffer.from(v.replace(/^\\x/, ""), "hex");
      }
      return null;
    },
    ["BYTEA"],
  ),

  /** Get instance for arrays */
  array<A>(element: Get<A>): Get<A[]> {
    return Get.make(
      (v) => {
        if (v === null) return null;
        if (!Array.isArray(v)) return null;
        const result: A[] = [];
        for (const item of v) {
          const decoded = element.get(item);
          if (decoded !== null) {
            result.push(decoded);
          }
        }
        return result;
      },
      ["ARRAY"],
    );
  },
} as const;

// ============================================================================
// Put Typeclass — Write a single column value
// ============================================================================

/**
 * @typeclass
 * Put<A> — Typeclass for writing a value of type A to a SQL parameter.
 *
 * Instances define how to convert TypeScript values to SQL-compatible values.
 *
 * ## Derivation
 *
 * Put instances for newtypes can be derived via `contramap`:
 *
 * ```typescript
 * const putUserId: Put<UserId> = Put.string.contramap((id: UserId) => id.value);
 * ```
 */
export interface Put<A> {
  readonly _tag: "Put";
  /** Convert a value to its SQL representation */
  readonly put: (value: A) => unknown;
  /** The SQL type this Put writes to */
  readonly sqlType: SqlTypeName;
}

/** Put typeclass companion with constructors and combinators */
export const Put = {
  /**
   * Create a Put instance from an encoder function.
   */
  make<A>(encode: (value: A) => unknown, sqlType: SqlTypeName): Put<A> {
    return {
      _tag: "Put",
      put: encode,
      sqlType,
    };
  },

  /**
   * Contravariant contramap — transform the input type.
   * Used to derive Put instances for newtypes.
   */
  contramap<A, B>(pa: Put<A>, f: (b: B) => A): Put<B> {
    return Put.make((b) => pa.put(f(b)), pa.sqlType);
  },

  /**
   * Make a Put nullable.
   */
  nullable<A>(pa: Put<A>): Put<A | null> {
    return Put.make((v) => (v === null ? null : pa.put(v)), pa.sqlType);
  },

  /**
   * Make a Put optional.
   */
  optional<A>(pa: Put<A>): Put<A | undefined> {
    return Put.make((v) => (v === undefined ? null : pa.put(v)), pa.sqlType);
  },

  // --------------------------------------------------------------------------
  // Primitive Instances
  // --------------------------------------------------------------------------

  /** Put instance for strings */
  string: Put.make((v: string) => v, "TEXT"),

  /** Put instance for numbers */
  number: Put.make((v: number) => v, "NUMERIC"),

  /** Put instance for integers */
  int: Put.make((v: number) => Math.trunc(v), "INTEGER"),

  /** Put instance for bigints */
  bigint: Put.make((v: bigint) => v.toString(), "BIGINT"),

  /** Put instance for booleans */
  boolean: Put.make((v: boolean) => v, "BOOLEAN"),

  /** Put instance for Date */
  date: Put.make((v: Date) => v.toISOString(), "TIMESTAMPTZ"),

  /** Put instance for date-only */
  dateOnly: Put.make((v: Date) => v.toISOString().split("T")[0], "DATE"),

  /** Put instance for UUIDs */
  uuid: Put.make((v: string) => v, "UUID"),

  /** Put instance for JSON */
  json: Put.make((v: unknown) => JSON.stringify(v), "JSONB"),

  /** Put instance for typed JSON */
  jsonAs<A>(): Put<A> {
    return Put.json as Put<A>;
  },

  /** Put instance for Buffer */
  buffer: Put.make((v: Buffer) => v, "BYTEA"),

  /** Put instance for arrays */
  array<A>(element: Put<A>): Put<A[]> {
    return Put.make((v) => v.map((item) => element.put(item)), "ARRAY");
  },
} as const;

// ============================================================================
// Meta Typeclass — Bidirectional single-column mapping
// ============================================================================

/**
 * @typeclass
 * Meta<A> — Bidirectional typeclass combining Get and Put.
 *
 * Most types will use Meta for both reading and writing. Use separate
 * Get/Put instances when the read and write representations differ.
 *
 * ## Invariant Functor
 *
 * Meta is an invariant functor — it can be transformed with `imap`:
 *
 * ```typescript
 * const userIdMeta: Meta<UserId> = Meta.string.imap(
 *   UserId,           // string -> UserId
 *   (id) => id.value, // UserId -> string
 * );
 * ```
 */
export interface Meta<A> extends Get<A>, Put<A> {
  readonly _tag: "Meta";
}

/** Meta typeclass companion with constructors and combinators */
export const Meta = {
  /**
   * Create a Meta instance from Get and Put.
   */
  fromGetPut<A>(get: Get<A>, put: Put<A>): Meta<A> {
    return {
      _tag: "Meta",
      get: get.get,
      unsafeGet: get.unsafeGet,
      sqlTypes: get.sqlTypes,
      put: put.put,
      sqlType: put.sqlType,
    };
  },

  /**
   * Create a Meta instance from decoder/encoder functions.
   */
  make<A>(
    decode: (value: unknown) => A | null,
    encode: (value: A) => unknown,
    sqlType: SqlTypeName,
    readTypes?: readonly SqlTypeName[],
  ): Meta<A> {
    const get = Get.make(decode, readTypes ?? [sqlType]);
    const put = Put.make(encode, sqlType);
    return Meta.fromGetPut(get, put);
  },

  /**
   * Invariant functor imap — transform both directions.
   * Used to derive Meta instances for newtypes.
   */
  imap<A, B>(ma: Meta<A>, f: (a: A) => B, g: (b: B) => A): Meta<B> {
    return Meta.fromGetPut(Get.map(ma, f), Put.contramap(ma, g));
  },

  /**
   * Make a Meta nullable.
   */
  nullable<A>(ma: Meta<A>): Meta<A | null> {
    return Meta.fromGetPut(Get.nullable(ma), Put.nullable(ma));
  },

  /**
   * Make a Meta optional.
   */
  optional<A>(ma: Meta<A>): Meta<A | undefined> {
    return Meta.fromGetPut(Get.optional(ma), Put.optional(ma));
  },

  /**
   * Meta for arrays.
   */
  array<A>(element: Meta<A>): Meta<A[]> {
    return Meta.fromGetPut(Get.array(element), Put.array(element));
  },

  // --------------------------------------------------------------------------
  // Primitive Instances
  // --------------------------------------------------------------------------

  string: Meta.fromGetPut(Get.string, Put.string),
  number: Meta.fromGetPut(Get.number, Put.number),
  int: Meta.fromGetPut(Get.int, Put.int),
  bigint: Meta.fromGetPut(Get.bigint, Put.bigint),
  boolean: Meta.fromGetPut(Get.boolean, Put.boolean),
  date: Meta.fromGetPut(Get.date, Put.date),
  dateOnly: Meta.fromGetPut(Get.dateOnly, Put.dateOnly),
  uuid: Meta.fromGetPut(Get.uuid, Put.uuid),
  json: Meta.fromGetPut(Get.json, Put.json),
  buffer: Meta.fromGetPut(Get.buffer, Put.buffer),

  /** Meta for typed JSON */
  jsonAs<A>(): Meta<A> {
    return Meta.json as Meta<A>;
  },
} as const;

// ============================================================================
// Read Typeclass — Read an entire row
// ============================================================================

/**
 * @typeclass
 * Read<A> — Typeclass for reading an entire result row as type A.
 *
 * Unlike Get (which reads a single column), Read decodes an entire result row.
 * Read instances are typically derived from the Get instances of each field.
 *
 * ## Auto-Derivation
 *
 * ```typescript
 * @deriving(Read)
 * interface User {
 *   id: number;      // uses Get.number
 *   name: string;    // uses Get.string
 *   email: string;   // uses Get.string
 * }
 *
 * // Generates ReadUser that reads each field using its Get instance
 * ```
 *
 * ## Composition
 *
 * Read instances can be composed:
 *
 * ```typescript
 * const readPair: Read<[User, Post]> = Read.product(ReadUser, ReadPost);
 * ```
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

/** Column mapping configuration */
export interface ColumnMapping {
  /** TypeScript field name */
  readonly field: string;
  /** SQL column name */
  readonly column: string;
  /** Get instance for this field */
  readonly get: Get<unknown>;
  /** Whether the field is nullable */
  readonly nullable: boolean;
}

/** Read typeclass companion with constructors and combinators */
export const Read = {
  /**
   * Create a Read instance from column mappings.
   */
  make<A>(
    mappings: readonly ColumnMapping[],
    construct: (fields: Record<string, unknown>) => A,
  ): Read<A> {
    const columns = mappings.map((m) => m.column);

    return {
      _tag: "Read",
      columns,
      read: (row: SqlRow): A | null => {
        const fields: Record<string, unknown> = {};
        for (const mapping of mappings) {
          const rawValue = row[mapping.column];
          const value = mapping.get.get(rawValue);
          if (value === null && !mapping.nullable) {
            return null;
          }
          fields[mapping.field] = value;
        }
        return construct(fields);
      },
      unsafeRead: (row: SqlRow): A => {
        const fields: Record<string, unknown> = {};
        for (const mapping of mappings) {
          const rawValue = row[mapping.column];
          fields[mapping.field] = mapping.nullable
            ? mapping.get.get(rawValue)
            : mapping.get.unsafeGet(rawValue);
        }
        return construct(fields);
      },
    };
  },

  /**
   * Create a Read for a single column.
   */
  column<A>(name: string, get: Get<A>): Read<A> {
    return {
      _tag: "Read",
      columns: [name],
      read: (row) => get.get(row[name]),
      unsafeRead: (row) => get.unsafeGet(row[name]),
    };
  },

  /**
   * Functor map — transform the output type.
   */
  map<A, B>(ra: Read<A>, f: (a: A) => B): Read<B> {
    return {
      _tag: "Read",
      columns: ra.columns,
      read: (row) => {
        const a = ra.read(row);
        return a === null ? null : f(a);
      },
      unsafeRead: (row) => f(ra.unsafeRead(row)),
    };
  },

  /**
   * Applicative product — combine two Reads.
   */
  product<A, B>(ra: Read<A>, rb: Read<B>): Read<[A, B]> {
    return {
      _tag: "Read",
      columns: [...ra.columns, ...rb.columns],
      read: (row) => {
        const a = ra.read(row);
        const b = rb.read(row);
        return a === null || b === null ? null : [a, b];
      },
      unsafeRead: (row) => [ra.unsafeRead(row), rb.unsafeRead(row)],
    };
  },

  /**
   * Combine multiple Reads into a tuple.
   */
  tuple<T extends readonly Read<unknown>[]>(
    ...reads: T
  ): Read<{ [K in keyof T]: T[K] extends Read<infer A> ? A : never }> {
    type Result = { [K in keyof T]: T[K] extends Read<infer A> ? A : never };
    return {
      _tag: "Read",
      columns: reads.flatMap((r) => r.columns),
      read: (row) => {
        const results: unknown[] = [];
        for (const r of reads) {
          const value = r.read(row);
          if (value === null) return null;
          results.push(value);
        }
        return results as Result;
      },
      unsafeRead: (row) => reads.map((r) => r.unsafeRead(row)) as Result,
    };
  },

  /**
   * Make a Read optional.
   */
  optional<A>(ra: Read<A>): Read<A | undefined> {
    return {
      _tag: "Read",
      columns: ra.columns,
      read: (row) => ra.read(row) ?? undefined,
      unsafeRead: (row) => ra.read(row) ?? undefined,
    };
  },

  /**
   * Unit Read — always succeeds with undefined.
   */
  unit: {
    _tag: "Read",
    columns: [],
    read: () => undefined,
    unsafeRead: () => undefined,
  } as Read<void>,
} as const;

// ============================================================================
// Write Typeclass — Write a value as multiple parameters
// ============================================================================

/**
 * @typeclass
 * Write<A> — Typeclass for writing a value of type A as SQL parameters.
 *
 * Unlike Put (which writes a single value), Write produces multiple parameters
 * for INSERT/UPDATE statements.
 *
 * ## Auto-Derivation
 *
 * ```typescript
 * @deriving(Write)
 * interface User {
 *   id: number;      // uses Put.number
 *   name: string;    // uses Put.string
 *   email: string;   // uses Put.string
 * }
 *
 * // Generates WriteUser that writes each field using its Put instance
 * ```
 */
export interface Write<A> {
  readonly _tag: "Write";
  /** Convert a value to an array of SQL parameters in column order */
  readonly write: (value: A) => readonly unknown[];
  /** The column names in parameter order */
  readonly columns: readonly string[];
}

/** Write typeclass companion with constructors and combinators */
export const Write = {
  /**
   * Create a Write instance from field extractors.
   */
  make<A>(
    columns: readonly string[],
    extractors: readonly ((value: A) => unknown)[],
  ): Write<A> {
    return {
      _tag: "Write",
      columns,
      write: (value) => extractors.map((extract) => extract(value)),
    };
  },

  /**
   * Create a Write for a single column.
   */
  column<A>(name: string, put: Put<A>): Write<A> {
    return {
      _tag: "Write",
      columns: [name],
      write: (value) => [put.put(value)],
    };
  },

  /**
   * Contravariant contramap — transform the input type.
   */
  contramap<A, B>(wa: Write<A>, f: (b: B) => A): Write<B> {
    return {
      _tag: "Write",
      columns: wa.columns,
      write: (b) => wa.write(f(b)),
    };
  },

  /**
   * Combine two Writes (for tuples).
   */
  product<A, B>(wa: Write<A>, wb: Write<B>): Write<[A, B]> {
    return {
      _tag: "Write",
      columns: [...wa.columns, ...wb.columns],
      write: ([a, b]) => [...wa.write(a), ...wb.write(b)],
    };
  },

  /**
   * Combine multiple Writes.
   */
  tuple<T extends readonly Write<unknown>[]>(
    ...writes: T
  ): Write<{ [K in keyof T]: T[K] extends Write<infer A> ? A : never }> {
    type Input = { [K in keyof T]: T[K] extends Write<infer A> ? A : never };
    return {
      _tag: "Write",
      columns: writes.flatMap((w) => w.columns),
      write: (values: Input) =>
        writes.flatMap((w, i) => w.write((values as unknown[])[i])),
    };
  },

  /**
   * Unit Write — produces no parameters.
   */
  unit: {
    _tag: "Write",
    columns: [],
    write: () => [],
  } as Write<void>,
} as const;

// ============================================================================
// Codec Typeclass — Bidirectional row-level mapping
// ============================================================================

/**
 * @typeclass
 * Codec<A> — Bidirectional typeclass combining Read and Write for row-level operations.
 *
 * This is the row-level equivalent of Meta.
 */
export interface Codec<A> extends Read<A>, Write<A> {
  readonly _tag: "Codec";
}

/** Codec typeclass companion */
export const Codec = {
  /**
   * Create a Codec from Read and Write.
   */
  fromReadWrite<A>(read: Read<A>, write: Write<A>): Codec<A> {
    return {
      _tag: "Codec",
      read: read.read,
      unsafeRead: read.unsafeRead,
      columns: read.columns,
      write: write.write,
    };
  },

  /**
   * Invariant functor imap.
   */
  imap<A, B>(ca: Codec<A>, f: (a: A) => B, g: (b: B) => A): Codec<B> {
    return Codec.fromReadWrite(Read.map(ca, f), Write.contramap(ca, g));
  },
} as const;

// ============================================================================
// Type-Level Utilities
// ============================================================================

/** Extract the TypeScript type from a Get */
export type GetType<G> = G extends Get<infer A> ? A : never;

/** Extract the TypeScript type from a Put */
export type PutType<P> = P extends Put<infer A> ? A : never;

/** Extract the TypeScript type from a Meta */
export type MetaType<M> = M extends Meta<infer A> ? A : never;

/** Extract the TypeScript type from a Read */
export type ReadType<R> = R extends Read<infer A> ? A : never;

/** Extract the TypeScript type from a Write */
export type WriteType<W> = W extends Write<infer A> ? A : never;

/** Extract the TypeScript type from a Codec */
export type CodecType<C> = C extends Codec<infer A> ? A : never;

// ============================================================================
// Derivation Helpers
// ============================================================================

/**
 * Convert camelCase to snake_case for SQL column names.
 */
export function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Column configuration for derivation.
 */
export interface DeriveColumn<A> {
  /** TypeScript field name */
  readonly field: string;
  /** SQL column name (defaults to snake_case of field) */
  readonly column?: string;
  /** Meta instance for this field */
  readonly meta: Meta<A>;
  /** Whether the field is nullable */
  readonly nullable?: boolean;
}

/**
 * Derive a Read instance from column configurations.
 *
 * @example
 * ```typescript
 * const ReadUser = deriveRead<User>({
 *   id: { meta: Meta.number },
 *   name: { meta: Meta.string },
 *   email: { meta: Meta.string },
 *   createdAt: { meta: Meta.date, column: "created_at" },
 * });
 * ```
 */
export function deriveRead<A extends Record<string, unknown>>(config: {
  [K in keyof A]: DeriveColumn<A[K]>;
}): Read<A> {
  const mappings: ColumnMapping[] = Object.entries(config).map(
    ([field, conf]) => {
      const c = conf as DeriveColumn<unknown>;
      return {
        field,
        column: c.column ?? toSnakeCase(field),
        get: c.meta,
        nullable: c.nullable ?? false,
      };
    },
  );

  return Read.make(mappings, (fields) => fields as A);
}

/**
 * Derive a Write instance from column configurations.
 *
 * @example
 * ```typescript
 * const WriteUser = deriveWrite<User>({
 *   id: { meta: Meta.number },
 *   name: { meta: Meta.string },
 *   email: { meta: Meta.string },
 *   createdAt: { meta: Meta.date, column: "created_at" },
 * });
 * ```
 */
export function deriveWrite<A extends Record<string, unknown>>(config: {
  [K in keyof A]: DeriveColumn<A[K]>;
}): Write<A> {
  const entries = Object.entries(config);
  const columns = entries.map(([field, conf]) => {
    const c = conf as DeriveColumn<unknown>;
    return c.column ?? toSnakeCase(field);
  });

  const extractors = entries.map(([field, conf]) => {
    const c = conf as DeriveColumn<unknown>;
    return (value: A) => c.meta.put((value as Record<string, unknown>)[field]);
  });

  return Write.make(columns, extractors);
}

/**
 * Derive a Codec instance from column configurations.
 */
export function deriveCodec<A extends Record<string, unknown>>(config: {
  [K in keyof A]: DeriveColumn<A[K]>;
}): Codec<A> {
  return Codec.fromReadWrite(deriveRead(config), deriveWrite(config));
}

// ============================================================================
// Register instances for specialize integration
// ============================================================================

// These enable zero-cost specialization when used with the specialize macro

registerInstanceMethods("Get.string", "Get", {
  get: {
    source:
      '(v) => (typeof v === "string" ? v : v === null ? null : String(v))',
    params: ["v"],
  },
  unsafeGet: {
    source:
      '(v) => { const r = typeof v === "string" ? v : String(v); if (v === null) throw new Error("NULL"); return r; }',
    params: ["v"],
  },
});

registerInstanceMethods("Get.number", "Get", {
  get: {
    source:
      '(v) => (typeof v === "number" ? v : v === null ? null : Number(v))',
    params: ["v"],
  },
  unsafeGet: {
    source:
      '(v) => { if (v === null) throw new Error("NULL"); return typeof v === "number" ? v : Number(v); }',
    params: ["v"],
  },
});

registerInstanceMethods("Get.boolean", "Get", {
  get: {
    source:
      '(v) => { if (v === null) return null; if (typeof v === "boolean") return v; return v === "t" || v === "true" || v === 1; }',
    params: ["v"],
  },
  unsafeGet: {
    source:
      '(v) => { if (v === null) throw new Error("NULL"); if (typeof v === "boolean") return v; return v === "t" || v === "true" || v === 1; }',
    params: ["v"],
  },
});

registerInstanceMethods("Get.date", "Get", {
  get: {
    source:
      "(v) => { if (v === null) return null; if (v instanceof Date) return v; return new Date(v); }",
    params: ["v"],
  },
  unsafeGet: {
    source:
      '(v) => { if (v === null) throw new Error("NULL"); if (v instanceof Date) return v; return new Date(v); }',
    params: ["v"],
  },
});

registerInstanceMethods("Put.string", "Put", {
  put: { source: "(v) => v", params: ["v"] },
});

registerInstanceMethods("Put.number", "Put", {
  put: { source: "(v) => v", params: ["v"] },
});

registerInstanceMethods("Put.boolean", "Put", {
  put: { source: "(v) => v", params: ["v"] },
});

registerInstanceMethods("Put.date", "Put", {
  put: { source: "(v) => v.toISOString()", params: ["v"] },
});

// ============================================================================
// Implicit Resolution Registry — Doobie-style auto-derivation
// ============================================================================

/**
 * Registry of typeclass instances for implicit resolution.
 * This enables Doobie-style auto-derivation where:
 * - `summon<Read<User>>()` automatically derives if all fields have Get instances
 * - No explicit `@deriving` annotation needed when instances can be inferred
 */

/** Registry of Get instances by type name */
const getRegistry = new Map<string, Get<unknown>>();

/** Registry of Put instances by type name */
const putRegistry = new Map<string, Put<unknown>>();

/** Registry of Meta instances by type name */
const metaRegistry = new Map<string, Meta<unknown>>();

/** Registry of Read instances by type name */
const readRegistry = new Map<string, Read<unknown>>();

/** Registry of Write instances by type name */
const writeRegistry = new Map<string, Write<unknown>>();

/** Registry of Codec instances by type name */
const codecRegistry = new Map<string, Codec<unknown>>();

// Initialize primitive instances in registries
getRegistry.set("string", Get.string);
getRegistry.set("number", Get.number);
getRegistry.set("int", Get.int);
getRegistry.set("bigint", Get.bigint);
getRegistry.set("boolean", Get.boolean);
getRegistry.set("Date", Get.date);
getRegistry.set("Buffer", Get.buffer);
getRegistry.set("json", Get.json);
getRegistry.set("uuid", Get.uuid);

putRegistry.set("string", Put.string);
putRegistry.set("number", Put.number);
putRegistry.set("int", Put.int);
putRegistry.set("bigint", Put.bigint);
putRegistry.set("boolean", Put.boolean);
putRegistry.set("Date", Put.date);
putRegistry.set("Buffer", Put.buffer);
putRegistry.set("json", Put.json);
putRegistry.set("uuid", Put.uuid);

metaRegistry.set("string", Meta.string);
metaRegistry.set("number", Meta.number);
metaRegistry.set("int", Meta.int);
metaRegistry.set("bigint", Meta.bigint);
metaRegistry.set("boolean", Meta.boolean);
metaRegistry.set("Date", Meta.date);
metaRegistry.set("Buffer", Meta.buffer);
metaRegistry.set("json", Meta.json);
metaRegistry.set("uuid", Meta.uuid);

// ============================================================================
// Summon Functions — Implicit Instance Resolution
// ============================================================================

/**
 * Summon a Get instance by type name.
 * Returns the registered instance or undefined.
 */
Get.summon = function <A>(typeName: string): Get<A> | undefined {
  return getRegistry.get(typeName) as Get<A> | undefined;
};

/**
 * Register a Get instance for implicit resolution.
 */
Get.registerInstance = function <A>(typeName: string, instance: Get<A>): void {
  getRegistry.set(typeName, instance as Get<unknown>);
};

/**
 * Summon a Put instance by type name.
 * Returns the registered instance or undefined.
 */
Put.summon = function <A>(typeName: string): Put<A> | undefined {
  return putRegistry.get(typeName) as Put<A> | undefined;
};

/**
 * Register a Put instance for implicit resolution.
 */
Put.registerInstance = function <A>(typeName: string, instance: Put<A>): void {
  putRegistry.set(typeName, instance as Put<unknown>);
};

/**
 * Summon a Meta instance by type name.
 * Returns the registered instance or undefined.
 */
Meta.summon = function <A>(typeName: string): Meta<A> | undefined {
  return metaRegistry.get(typeName) as Meta<A> | undefined;
};

/**
 * Register a Meta instance for implicit resolution.
 */
Meta.registerInstance = function <A>(
  typeName: string,
  instance: Meta<A>,
): void {
  metaRegistry.set(typeName, instance as Meta<unknown>);
};

/**
 * Summon a Read instance by type name.
 * Returns the registered instance or undefined.
 *
 * For auto-derivation at compile time, use the @deriving(Read) macro
 * or the summon<Read<T>>() expression macro which can derive instances
 * when all field Get instances are available.
 */
Read.summon = function <A>(typeName: string): Read<A> | undefined {
  return readRegistry.get(typeName) as Read<A> | undefined;
};

/**
 * Register a Read instance for implicit resolution.
 */
Read.registerInstance = function <A>(
  typeName: string,
  instance: Read<A>,
): void {
  readRegistry.set(typeName, instance as Read<unknown>);
};

/**
 * Summon a Write instance by type name.
 * Returns the registered instance or undefined.
 */
Write.summon = function <A>(typeName: string): Write<A> | undefined {
  return writeRegistry.get(typeName) as Write<A> | undefined;
};

/**
 * Register a Write instance for implicit resolution.
 */
Write.registerInstance = function <A>(
  typeName: string,
  instance: Write<A>,
): void {
  writeRegistry.set(typeName, instance as Write<unknown>);
};

/**
 * Summon a Codec instance by type name.
 * Returns the registered instance or undefined.
 */
Codec.summon = function <A>(typeName: string): Codec<A> | undefined {
  return codecRegistry.get(typeName) as Codec<A> | undefined;
};

/**
 * Register a Codec instance for implicit resolution.
 */
Codec.registerInstance = function <A>(
  typeName: string,
  instance: Codec<A>,
): void {
  codecRegistry.set(typeName, instance as Codec<unknown>);
};

// ============================================================================
// Type augmentation for summon/registerInstance methods
// ============================================================================

declare module "./typeclasses.js" {
  // Get companion augmentation
  interface GetCompanion {
    summon<A>(typeName: string): Get<A> | undefined;
    registerInstance<A>(typeName: string, instance: Get<A>): void;
  }

  // Put companion augmentation
  interface PutCompanion {
    summon<A>(typeName: string): Put<A> | undefined;
    registerInstance<A>(typeName: string, instance: Put<A>): void;
  }

  // Meta companion augmentation
  interface MetaCompanion {
    summon<A>(typeName: string): Meta<A> | undefined;
    registerInstance<A>(typeName: string, instance: Meta<A>): void;
  }

  // Read companion augmentation
  interface ReadCompanion {
    summon<A>(typeName: string): Read<A> | undefined;
    registerInstance<A>(typeName: string, instance: Read<A>): void;
  }

  // Write companion augmentation
  interface WriteCompanion {
    summon<A>(typeName: string): Write<A> | undefined;
    registerInstance<A>(typeName: string, instance: Write<A>): void;
  }

  // Codec companion augmentation
  interface CodecCompanion {
    summon<A>(typeName: string): Codec<A> | undefined;
    registerInstance<A>(typeName: string, instance: Codec<A>): void;
  }
}

// ============================================================================
// Export registries for macro integration
// ============================================================================

export {
  getRegistry,
  putRegistry,
  metaRegistry,
  readRegistry,
  writeRegistry,
  codecRegistry,
};
