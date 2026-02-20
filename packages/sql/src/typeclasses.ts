import {
  createGenericRegistry,
  type GenericRegistry,
} from "@typesugar/core";

/**
 * Doobie-Style SQL Typeclasses
 *
 * This module provides a complete typeclass hierarchy for SQL type mapping,
 * inspired by Scala's Doobie library but integrated with typesugar's typeclass system.
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

// Note: specialize integration (registerInstanceMethods) is handled by the
// derive macros at compile time. The primitive instances are registered
// via the @instance decorator pattern in the macro system.

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

// Helper function to create Get instances (defined before companion to avoid circular reference)
function makeGet<A>(
  decode: (value: unknown) => A | null,
  sqlTypes: readonly SqlTypeName[],
): Get<A> {
  return {
    _tag: "Get",
    get: decode,
    unsafeGet: (value: unknown): A => {
      const result = decode(value);
      if (result === null) {
        throw new Error(`Unexpected NULL value`);
      }
      return result;
    },
    sqlTypes,
  };
}

// Pre-create primitive instances to avoid circular reference in companion object
const _getString: Get<string> = makeGet(
  (v: unknown) => (typeof v === "string" ? v : v === null ? null : String(v)),
  ["TEXT", "VARCHAR", "CHAR"],
);

const _getNumber: Get<number> = makeGet(
  (v: unknown) => (typeof v === "number" ? v : v === null ? null : Number(v)),
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
);

const _getInt: Get<number> = makeGet((v: unknown) => {
  if (v === null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) ? n : Math.trunc(n);
}, ["INTEGER", "INT", "BIGINT", "SMALLINT"]);

const _getBigint: Get<bigint> = makeGet((v: unknown) => {
  if (v === null) return null;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  if (typeof v === "string") return BigInt(v);
  return null;
}, ["BIGINT"]);

const _getBoolean: Get<boolean> = makeGet((v: unknown) => {
  if (v === null) return null;
  if (typeof v === "boolean") return v;
  if (v === "t" || v === "true" || v === 1) return true;
  if (v === "f" || v === "false" || v === 0) return false;
  return Boolean(v);
}, ["BOOLEAN"]);

const _getDate: Get<Date> = makeGet((v: unknown) => {
  if (v === null) return null;
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}, ["DATE", "TIME", "TIMESTAMP", "TIMESTAMPTZ"]);

const _getDateOnly: Get<Date> = makeGet((v: unknown) => {
  if (v === null) return null;
  if (v instanceof Date) return v;
  if (typeof v === "string") {
    const d = new Date(v + "T00:00:00Z");
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}, ["DATE"]);

const _getUuid: Get<string> = makeGet((v: unknown) => {
  if (v === null) return null;
  if (typeof v === "string") {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(v) ? v : null;
  }
  return null;
}, ["UUID"]);

const _getJson: Get<unknown> = makeGet((v: unknown) => {
  if (v === null) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v;
}, ["JSON", "JSONB"]);

const _getBuffer: Get<Buffer> = makeGet((v: unknown) => {
  if (v === null) return null;
  if (Buffer.isBuffer(v)) return v;
  if (typeof v === "string") {
    return Buffer.from(v.replace(/^\\x/, ""), "hex");
  }
  return null;
}, ["BYTEA"]);

/** Get typeclass companion with constructors and combinators */
export const Get = {
  /** Create a Get instance from a decoder function. */
  make: makeGet,

  /** Functor map — transform the output type. */
  map<A, B>(ga: Get<A>, f: (a: A) => B): Get<B> {
    return makeGet((v: unknown) => {
      const a = ga.get(v);
      return a === null ? null : f(a);
    }, ga.sqlTypes);
  },

  /** Make a Get nullable — handle SQL NULL explicitly. */
  nullable<A>(ga: Get<A>): Get<A | null> {
    return makeGet(
      (v: unknown) => (v === null ? null : ga.get(v)),
      [...ga.sqlTypes, "NULL"],
    );
  },

  /** Make a Get optional — map NULL to undefined. */
  optional<A>(ga: Get<A>): Get<A | undefined> {
    return makeGet(
      (v: unknown) =>
        v === null || v === undefined ? undefined : (ga.get(v) ?? undefined),
      [...ga.sqlTypes, "NULL"],
    );
  },

  // Primitive Instances
  string: _getString,
  number: _getNumber,
  int: _getInt,
  bigint: _getBigint,
  boolean: _getBoolean,
  date: _getDate,
  dateOnly: _getDateOnly,
  uuid: _getUuid,
  json: _getJson,
  buffer: _getBuffer,

  /** Get instance for typed JSON */
  jsonAs<A>(): Get<A> {
    return _getJson as Get<A>;
  },

  /** Get instance for arrays */
  array<A>(element: Get<A>): Get<A[]> {
    return makeGet(
      (v: unknown) => {
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

// Helper function to create Put instances (defined before companion to avoid circular reference)
function makePut<A>(encode: (value: A) => unknown, sqlType: SqlTypeName): Put<A> {
  return {
    _tag: "Put",
    put: encode,
    sqlType,
  };
}

// Pre-create primitive Put instances
const _putString: Put<string> = makePut((v: string) => v, "TEXT");
const _putNumber: Put<number> = makePut((v: number) => v, "NUMERIC");
const _putInt: Put<number> = makePut((v: number) => Math.trunc(v), "INTEGER");
const _putBigint: Put<bigint> = makePut((v: bigint) => v.toString(), "BIGINT");
const _putBoolean: Put<boolean> = makePut((v: boolean) => v, "BOOLEAN");
const _putDate: Put<Date> = makePut((v: Date) => v.toISOString(), "TIMESTAMPTZ");
const _putDateOnly: Put<Date> = makePut((v: Date) => v.toISOString().split("T")[0], "DATE");
const _putUuid: Put<string> = makePut((v: string) => v, "UUID");
const _putJson: Put<unknown> = makePut((v: unknown) => JSON.stringify(v), "JSONB");
const _putBuffer: Put<Buffer> = makePut((v: Buffer) => v, "BYTEA");

/** Put typeclass companion with constructors and combinators */
export const Put = {
  /** Create a Put instance from an encoder function. */
  make: makePut,

  /** Contravariant contramap — transform the input type. */
  contramap<A, B>(pa: Put<A>, f: (b: B) => A): Put<B> {
    return makePut((b: B) => pa.put(f(b)), pa.sqlType);
  },

  /** Make a Put nullable. */
  nullable<A>(pa: Put<A>): Put<A | null> {
    return makePut((v: A | null) => (v === null ? null : pa.put(v)), pa.sqlType);
  },

  /** Make a Put optional. */
  optional<A>(pa: Put<A>): Put<A | undefined> {
    return makePut((v: A | undefined) => (v === undefined ? null : pa.put(v)), pa.sqlType);
  },

  // Primitive Instances
  string: _putString,
  number: _putNumber,
  int: _putInt,
  bigint: _putBigint,
  boolean: _putBoolean,
  date: _putDate,
  dateOnly: _putDateOnly,
  uuid: _putUuid,
  json: _putJson,
  buffer: _putBuffer,

  /** Put instance for typed JSON */
  jsonAs<A>(): Put<A> {
    return _putJson as Put<A>;
  },

  /** Put instance for arrays */
  array<A>(element: Put<A>): Put<A[]> {
    return makePut((v: A[]) => v.map((item: A) => element.put(item)), "ARRAY");
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
export interface Meta<A> extends Omit<Get<A>, '_tag'>, Omit<Put<A>, '_tag'> {
  readonly _tag: "Meta";
}

// Helper function to create Meta instances (defined before companion to avoid circular reference)
function metaFromGetPut<A>(get: Get<A>, put: Put<A>): Meta<A> {
  return {
    _tag: "Meta",
    get: get.get,
    unsafeGet: get.unsafeGet,
    sqlTypes: get.sqlTypes,
    put: put.put,
    sqlType: put.sqlType,
  };
}

// Pre-create primitive Meta instances
const _metaString: Meta<string> = metaFromGetPut(_getString, _putString);
const _metaNumber: Meta<number> = metaFromGetPut(_getNumber, _putNumber);
const _metaInt: Meta<number> = metaFromGetPut(_getInt, _putInt);
const _metaBigint: Meta<bigint> = metaFromGetPut(_getBigint, _putBigint);
const _metaBoolean: Meta<boolean> = metaFromGetPut(_getBoolean, _putBoolean);
const _metaDate: Meta<Date> = metaFromGetPut(_getDate, _putDate);
const _metaDateOnly: Meta<Date> = metaFromGetPut(_getDateOnly, _putDateOnly);
const _metaUuid: Meta<string> = metaFromGetPut(_getUuid, _putUuid);
const _metaJson: Meta<unknown> = metaFromGetPut(_getJson, _putJson);
const _metaBuffer: Meta<Buffer> = metaFromGetPut(_getBuffer, _putBuffer);

/** Meta typeclass companion with constructors and combinators */
export const Meta = {
  /** Create a Meta instance from Get and Put. */
  fromGetPut: metaFromGetPut,

  /** Create a Meta instance from decoder/encoder functions. */
  make<A>(
    decode: (value: unknown) => A | null,
    encode: (value: A) => unknown,
    sqlType: SqlTypeName,
    readTypes?: readonly SqlTypeName[],
  ): Meta<A> {
    const get = makeGet(decode, readTypes ?? [sqlType]);
    const put = makePut(encode, sqlType);
    return metaFromGetPut(get, put);
  },

  /** Invariant functor imap — transform both directions. */
  imap<A, B>(ma: Meta<A>, f: (a: A) => B, g: (b: B) => A): Meta<B> {
    return metaFromGetPut(Get.map(ma as unknown as Get<A>, f), Put.contramap(ma as unknown as Put<A>, g));
  },

  /** Make a Meta nullable. */
  nullable<A>(ma: Meta<A>): Meta<A | null> {
    return metaFromGetPut(Get.nullable(ma as unknown as Get<A>), Put.nullable(ma as unknown as Put<A>));
  },

  /** Make a Meta optional. */
  optional<A>(ma: Meta<A>): Meta<A | undefined> {
    return metaFromGetPut(Get.optional(ma as unknown as Get<A>), Put.optional(ma as unknown as Put<A>));
  },

  /** Meta for arrays. */
  array<A>(element: Meta<A>): Meta<A[]> {
    return metaFromGetPut(Get.array(element as unknown as Get<A>), Put.array(element as unknown as Put<A>));
  },

  // Primitive Instances
  string: _metaString,
  number: _metaNumber,
  int: _metaInt,
  bigint: _metaBigint,
  boolean: _metaBoolean,
  date: _metaDate,
  dateOnly: _metaDateOnly,
  uuid: _metaUuid,
  json: _metaJson,
  buffer: _metaBuffer,

  /** Meta for typed JSON */
  jsonAs<A>(): Meta<A> {
    return _metaJson as Meta<A>;
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
export interface Codec<A> extends Omit<Read<A>, '_tag'>, Omit<Write<A>, '_tag'> {
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
    return Codec.fromReadWrite(Read.map(ca as unknown as Read<A>, f), Write.contramap(ca as unknown as Write<A>, g));
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
        // Cast Meta to Get since they share the decode/sqlTypes structure
        get: c.meta as unknown as Get<unknown>,
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
// Implicit Resolution Registry — Doobie-style auto-derivation
// ============================================================================

/**
 * Registry of typeclass instances for implicit resolution.
 * This enables Doobie-style auto-derivation where:
 * - `summon<Read<User>>()` automatically derives if all fields have Get instances
 * - No explicit `@deriving` annotation needed when instances can be inferred
 */

/** Registry of Get instances by type name */
const getRegistry: GenericRegistry<string, Get<unknown>> = createGenericRegistry({
  name: "GetRegistry",
  duplicateStrategy: "replace",
});

/** Registry of Put instances by type name */
const putRegistry: GenericRegistry<string, Put<unknown>> = createGenericRegistry({
  name: "PutRegistry",
  duplicateStrategy: "replace",
});

/** Registry of Meta instances by type name */
const metaRegistry: GenericRegistry<string, Meta<unknown>> = createGenericRegistry({
  name: "MetaRegistry",
  duplicateStrategy: "replace",
});

/** Registry of Read instances by type name */
const readRegistry: GenericRegistry<string, Read<unknown>> = createGenericRegistry({
  name: "ReadRegistry",
  duplicateStrategy: "replace",
});

/** Registry of Write instances by type name */
const writeRegistry: GenericRegistry<string, Write<unknown>> = createGenericRegistry({
  name: "WriteRegistry",
  duplicateStrategy: "replace",
});

/** Registry of Codec instances by type name */
const codecRegistry: GenericRegistry<string, Codec<unknown>> = createGenericRegistry({
  name: "CodecRegistry",
  duplicateStrategy: "replace",
});

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

putRegistry.set("string", Put.string as Put<unknown>);
putRegistry.set("number", Put.number as Put<unknown>);
putRegistry.set("int", Put.int as Put<unknown>);
putRegistry.set("bigint", Put.bigint as Put<unknown>);
putRegistry.set("boolean", Put.boolean as Put<unknown>);
putRegistry.set("Date", Put.date as Put<unknown>);
putRegistry.set("Buffer", Put.buffer as Put<unknown>);
putRegistry.set("json", Put.json as Put<unknown>);
putRegistry.set("uuid", Put.uuid as Put<unknown>);

metaRegistry.set("string", Meta.string as Meta<unknown>);
metaRegistry.set("number", Meta.number as Meta<unknown>);
metaRegistry.set("int", Meta.int as Meta<unknown>);
metaRegistry.set("bigint", Meta.bigint as Meta<unknown>);
metaRegistry.set("boolean", Meta.boolean as Meta<unknown>);
metaRegistry.set("Date", Meta.date as Meta<unknown>);
metaRegistry.set("Buffer", Meta.buffer as Meta<unknown>);
metaRegistry.set("json", Meta.json as Meta<unknown>);
metaRegistry.set("uuid", Meta.uuid as Meta<unknown>);

// ============================================================================
// Instance Registries — exported for macro integration
// ============================================================================
// Note: Summon and registerInstance functionality should use the registries directly.
// Example: const instance = getRegistry.get("MyType") as Get<MyType>;
// Example: putRegistry.set("MyType", myPutInstance as Put<unknown>);
// The @deriving(Read), @deriving(Write), @deriving(Codec) macros will
// generate code that uses these registries.

export {
  getRegistry,
  putRegistry,
  metaRegistry,
  readRegistry,
  writeRegistry,
  codecRegistry,
};
