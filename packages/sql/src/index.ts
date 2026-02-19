/**
 * @ttfx/sql — Doobie-like Type-Safe SQL DSL
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
 * import { sql$, ConnectionIO, Transactor } from "@ttfx/sql";
 *
 * // Type-safe query with inferred types
 * const findUser = sql$<User>`
 *   SELECT id, name, email FROM users WHERE id = ${userId}
 * `;
 *
 * // Pure database program
 * const program = ConnectionIO.query(findUser.query(), UserMeta)
 *   .flatMap(user => user
 *     ? ConnectionIO.pure(user)
 *     : ConnectionIO.execute(insertDefaultUser));
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

// Legacy ConnectionIO/Transactor (simple, lightweight)
export {
  ConnectionIO as SimpleConnectionIO,
  Transactor as SimpleTransactor,
} from "./types.js";
export type { DbConnection as SimpleDbConnection } from "./types.js";

// ============================================================================
// SQL Typeclasses — Doobie-style type mapping with auto-derivation
// ============================================================================

// Core typeclass interfaces
export type {
  Get,
  Put,
  Meta,
  Read,
  Write,
  Codec,
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

// Typeclass companions with instances and combinators
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

// Shapeless-style auto-derivation strategies (registers with core infrastructure)
export {
  readDerivation,
  writeDerivation,
  codecDerivation,
} from "./auto-derive-strategies.js";

// Derive macros for @deriving(Read), @deriving(Write), @deriving(Codec)
export {
  deriveReadMacro,
  deriveWriteMacro,
  deriveCodecMacro,
} from "./derive-typeclasses.js";

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

export type { ConnectionOp, Either, DbConnection } from "./connection-io.js";

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
// Macros — Compile-time SQL transformation
// ============================================================================

export { sqlMacro, register } from "./macro.js";
export {
  sql$Macro,
  schemaMacro,
  select,
  registerSchema,
} from "./infer-macro.js";
export { deriveMetaMacro } from "./derive-meta.js";

// ============================================================================
// Runtime Helper (used by the sql macro)
// ============================================================================

import { Fragment, SqlParam } from "./types.js";

/**
 * Runtime helper for sql`` macro.
 *
 * Handles both Fragment interpolations (which get inlined) and
 * plain values (which become bound parameters).
 */
export function __sql_build(
  segments: string[],
  interpolations: unknown[],
): Fragment {
  const resultSegments: string[] = [];
  const resultParams: SqlParam[] = [];

  for (let i = 0; i < segments.length; i++) {
    if (i === 0) {
      resultSegments.push(segments[i]);
    } else {
      const interp = interpolations[i - 1];

      if (interp instanceof Fragment) {
        // Inline the fragment
        const lastIdx = resultSegments.length - 1;
        resultSegments[lastIdx] += interp.segments[0];
        for (let j = 1; j < interp.segments.length; j++) {
          resultSegments.push(interp.segments[j]);
        }
        resultParams.push(...interp.params);
        // Append the next segment to the last one
        resultSegments[resultSegments.length - 1] += segments[i];
      } else {
        // It's a plain parameter
        resultParams.push(interp as SqlParam);
        resultSegments.push(segments[i]);
      }
    }
  }

  return new Fragment(resultSegments, resultParams);
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
export function sql(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Fragment {
  return __sql_build([...strings], values);
}
