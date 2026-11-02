/**
 * @typesugar/sql — Doobie-like Type-Safe SQL DSL
 *
 * A comprehensive SQL library for TypeScript with:
 *
 * ## Fragment System
 * - Composable SQL fragments with typed parameters
 * - Zero-cost abstractions via compile-time specialization
 * - AND/OR combinators, IN lists, VALUES clauses, conditional fragments
 *
 * ## Type Inference
 * - `sql$` macro for compile-time type derivation from SQL
 * - `@derive(Meta)` for automatic encoder/decoder generation
 * - Schema-based result type inference
 *
 * ## Pure Database Operations
 * - `ConnectionIO` free monad for composable, pure database code
 * - Transaction support with automatic rollback
 * - Error handling combinators
 *
 * ## Meta/Get/Put Typeclasses
 * - Type-safe SQL ↔ TypeScript mapping
 * - Primitive instances (string, number, boolean, Date, etc.)
 * - Composite constructors (nullable, optional, array)
 *
 * @example
 * ```typescript
 * import { sql$, ConnectionIO, Transactor } from "@typesugar/sql";
 *
 * // Type-safe query with inferred parameter types and an explicit row type
 * const findUser = sql$<User>`
 *   SELECT id, name, email FROM users WHERE id = ${userId}
 * `;
 *
 * // Pure database program
 * const program = ConnectionIO.query(findUser.toQuery(), ReadUser)
 *   .flatMap(user => user
 *     ? ConnectionIO.pure(user)
 *     : ConnectionIO.execute(insertDefaultUser).map(() => null));
 *
 * // Execute with transaction
 * const result = await transactor.transact(program);
 * ```
 *
 * @module
 */

// ============================================================================
// Core Types (Basic Fragment System)
// ============================================================================

export type { SqlParam } from "./types.js";
export { Fragment, Query, Update } from "./types.js";

// Dialects: placeholder style + identifier quoting (see dialect.ts for the decision)
export type { SqlDialect, DialectLike, FragmentLike } from "./dialect.js";
export {
  dialects,
  postgres,
  mysql,
  sqlite,
  defaultDialect,
  quoteIdent,
  isSafeIdentifier,
  assertSafeIdentifier,
  renderFragment,
} from "./dialect.js";

// Legacy ConnectionIO/Transactor (simple, lightweight)
export { ConnectionIO as SimpleConnectionIO, Transactor as SimpleTransactor } from "./types.js";
export type { DbConnection as SimpleDbConnection } from "./types.js";

// ============================================================================
// SQL Typeclasses — Doobie-style type mapping with auto-derivation
// ============================================================================

// Typeclass interfaces, companions, instances and combinators
// Note: Get, Put, Meta, Read, Write, Codec are both interfaces and companion objects
export {
  Get,
  Put,
  Meta,
  Read,
  Write,
  Codec,
  toSnakeCase,
  deriveRead,
  deriveWrite,
  deriveCodec,
  // Instance registries for implicit resolution
  getRegistry,
  putRegistry,
  metaRegistry,
  readRegistry,
  writeRegistry,
  codecRegistry,
} from "./typeclasses.js";

// Additional type-only exports
export type {
  SqlRow,
  SqlTypeName,
  GetType,
  PutType,
  MetaType,
  ReadType,
  WriteType,
  CodecType,
  ColumnMapping,
  DeriveColumn,
} from "./typeclasses.js";

// Use @derive(Read), @derive(Write), @derive(Codec), @derive(Meta) to generate
// instances. The macro *definitions* import `typescript` and live in the
// `./macros` entry (PEP-050), not in this runtime `.` entry.

// Legacy Meta exports (deprecated - use typeclasses.ts)
export type {
  Get as LegacyGet,
  Put as LegacyPut,
  Meta as LegacyMeta,
  Read as LegacyRead,
  Write as LegacyWrite,
  SqlRow as LegacySqlRow,
  SqlTypeName as LegacySqlTypeName,
} from "./meta.js";

export {
  makeGet,
  makePut,
  makeMeta,
  stringMeta,
  numberMeta,
  intMeta,
  bigintMeta,
  booleanMeta,
  dateMeta,
  dateOnlyMeta,
  uuidMeta,
  jsonMeta,
  bufferMeta,
  nullable,
  optional,
  arrayMeta,
} from "./meta.js";

// ============================================================================
// Typed Fragments — Type-tracked SQL composition
// ============================================================================

export type { Concat, Empty, Unit } from "./typed-fragment.js";

export {
  TypedFragment,
  TypedQuery,
  TypedUpdate,
  emptyTyped,
  intercalateTyped,
  andTyped,
  orTyped,
  commasTyped,
  inListTyped,
  valuesTyped,
  valuesManyTyped,
  setTyped,
  whenTyped,
  whereAndTyped,
} from "./typed-fragment.js";

// ============================================================================
// ConnectionIO — Enhanced Pure Database Operations (Free Monad)
// ============================================================================

export type {
  ConnectionOp,
  Either,
  DbConnection,
  TransactorOptions,
  AnyQuery,
  AnyUpdate,
  RowReader,
} from "./connection-io.js";

export {
  ConnectionIO,
  Transactor,
  Left,
  Right,
  sequence,
  traverse,
  parZip,
  parSequence,
  when,
  whenA,
  unfold,
} from "./connection-io.js";

// ============================================================================
// Query Builder DSL (runtime)
// ============================================================================
// The compile-time SQL macros (`sql`, `sql$`/`@schema`, `@deriving(Meta|Read|
// Write|Codec)`), `validateSqlSyntax`, and `registerSchema` import `typescript`
// and live in the `./macros` entry (PEP-050) — NOT in this runtime `.` entry.

export { select, SelectBuilder } from "./query-builder.js";

// ============================================================================
// Typeclasses for ORM Integration
// ============================================================================

export type { Queryable } from "./queryable.js";
export { Queryable as QueryableCompanion } from "./queryable.js";

// ============================================================================
// Runtime Helper (used by the sql macro)
// ============================================================================

import { Fragment, SqlParam } from "./types.js";
import { isFragmentLike, type FragmentLike } from "./dialect.js";
import { TypedFragment } from "./typed-fragment.js";
import type { SqlRow as _SqlRow } from "./meta.js";

/** Splice segments + interpolations, inlining Fragment/TypedFragment interpolations. */
function buildSegments(
  segments: readonly string[],
  interpolations: readonly unknown[]
): { segments: string[]; params: SqlParam[] } {
  const resultSegments: string[] = [segments[0] ?? ""];
  const resultParams: SqlParam[] = [];

  for (let i = 1; i < segments.length; i++) {
    const interp = interpolations[i - 1];

    if (isFragmentLike(interp)) {
      // Inline the fragment (Fragment or TypedFragment)
      const f = interp as FragmentLike;
      resultSegments[resultSegments.length - 1] += f.segments[0];
      for (let j = 1; j < f.segments.length; j++) {
        resultSegments.push(f.segments[j]);
      }
      resultParams.push(...(f.params as SqlParam[]));
      // Append the next segment to the last one
      resultSegments[resultSegments.length - 1] += segments[i];
    } else {
      // It's a plain parameter
      resultParams.push(interp as SqlParam);
      resultSegments.push(segments[i]);
    }
  }

  return { segments: resultSegments, params: resultParams };
}

/**
 * Runtime helper for sql`` macro.
 *
 * Handles both Fragment/TypedFragment interpolations (which get inlined) and
 * plain values (which become bound parameters).
 */
export function __sql_build(segments: string[], interpolations: unknown[]): Fragment {
  const r = buildSegments(segments, interpolations);
  return new Fragment(r.segments, r.params);
}

/**
 * Runtime helper for the sql$`` macro: like {@link __sql_build}, but returns a
 * TypedFragment. The macro supplies the inferred `<P, R>` type arguments.
 * Interpolated values are bound as plain parameters (no wrapper objects);
 * fragment interpolations are inlined.
 */
export function __typed_sql_build<P extends readonly unknown[] = unknown[], R = _SqlRow>(
  segments: readonly string[],
  interpolations: readonly unknown[]
): TypedFragment<P, R> {
  const r = buildSegments(segments, interpolations);
  return new TypedFragment<P, R>(r.segments, r.params);
}

// ============================================================================
// Prototype Extensions for Fragment
// ============================================================================

declare module "./types.js" {
  interface Fragment {
    /** Convert this fragment to a typed Query */
    toQuery<R>(): Query<R>;
    /** Convert this fragment to an Update */
    toUpdate(): Update;
  }
}

import { Query, Update } from "./types.js";

Fragment.prototype.toQuery = function <R>(): Query<R> {
  return new Query<R>(this);
};

Fragment.prototype.toUpdate = function (): Update {
  return new Update(this);
};

// ============================================================================
// Fallback sql function for non-macro usage
// ============================================================================

/**
 * Tagged template function for SQL - fallback when macro transform isn't applied.
 *
 * This allows the same code to work even without the macro transformer,
 * though you lose compile-time validation.
 */
export function sql(strings: TemplateStringsArray, ...values: unknown[]): Fragment {
  return __sql_build([...strings], values);
}

/**
 * Typed SQL tagged template — fallback when the macro transform isn't applied.
 *
 * With the transformer, `sql$` is expanded at compile time and the parameter
 * tuple type is inferred from the interpolations; without it, this runtime
 * version builds the same TypedFragment (with `unknown[]` params).
 *
 * ```typescript
 * const q = sql$<User>`SELECT id, name FROM users WHERE id = ${id}`;
 * ```
 */
export function sql$<R = _SqlRow>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): TypedFragment<unknown[], R> {
  return __typed_sql_build<unknown[], R>([...strings], values);
}
