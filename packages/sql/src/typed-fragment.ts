/**
 * TypedFragment<P, R> — Type-Safe SQL Fragments
 *
 * Extends the basic Fragment with compile-time type tracking:
 * - P: Tuple of parameter types (what goes in)
 * - R: Result row type (what comes out)
 *
 * ## Type Inference
 *
 * The `sql$` macro analyzes SQL at compile time to infer types:
 *
 * ```typescript
 * // Parameter types inferred from interpolations
 * const byId = sql$`WHERE id = ${0}`;            // TypedFragment<[number], void>
 *
 * // Explicit result type
 * const selectUsers = sql$<User>`
 *   SELECT id, name, email FROM users
 * `;
 *
 * // Composition preserves types
 * const query = selectUsers.append(byId);
 * // TypedFragment<[number], User>
 * ```
 *
 * ## Fragment Algebra
 *
 * Fragments form a monoid under concatenation:
 * - Identity: `empty` fragment
 * - Associative: `(a ++ b) ++ c === a ++ (b ++ c)`
 *
 * Type-level concatenation:
 * - Parameters concatenate: Fragment<[A], R> ++ Fragment<[B], R> = Fragment<[A, B], R>
 * - Results unify (must be compatible): Fragment<P, R1> ++ Fragment<P, R2> where R1 extends R2
 *
 * @module
 */

import { Fragment, SqlParam, type QueryCardinality, type RowDecoder } from "./types.js";
import { ConnectionIO } from "./connection-io.js";
import {
  type DialectLike,
  FRAGMENT_BRAND,
  assertSafeIdentifier,
  renderFragment,
} from "./dialect.js";
import { Read, Write, SqlRow } from "./meta.js";

// ============================================================================
// Type-Level Utilities
// ============================================================================

/** Concatenate two tuples at the type level */
export type Concat<A extends readonly unknown[], B extends readonly unknown[]> = [...A, ...B];

/** Empty tuple type */
export type Empty = readonly [];

/** The unit type for no result */
export type Unit = void;

// ============================================================================
// TypedFragment
// ============================================================================

/**
 * A SQL fragment with compile-time type information.
 *
 * Uses composition to wrap Fragment rather than inheritance,
 * providing a clean type-safe API without inheritance conflicts.
 *
 * @typeParam P - Tuple of parameter types in order
 * @typeParam R - Result row type (void for non-SELECT fragments)
 */
export class TypedFragment<P extends readonly unknown[] = Empty, R = Unit> {
  declare readonly [FRAGMENT_BRAND]: true;
  /** Type brand for parameter types */
  readonly __params!: P;
  /** Type brand for result type */
  readonly __result!: R;

  /** The underlying untyped fragment */
  readonly segments: readonly string[];
  readonly params: readonly SqlParam[];

  /**
   * Create a new typed fragment.
   */
  constructor(segments: readonly string[], params: readonly SqlParam[]) {
    this.segments = segments;
    this.params = params;
  }

  /**
   * Get the underlying Fragment (for interop with untyped APIs).
   */
  toFragment(): Fragment {
    return new Fragment([...this.segments], [...this.params]);
  }

  /**
   * Get the rendered query with Postgres placeholders ($1, $2, …).
   */
  get query(): { text: string; params: readonly SqlParam[] } {
    return this.render();
  }

  /** Render for a dialect (default Postgres `$n`; `"mysql"`/`"sqlite"` → `?`). */
  render(dialect?: DialectLike): { text: string; params: SqlParam[] } {
    return renderFragment(this, dialect) as { text: string; params: SqlParam[] };
  }

  /**
   * Append another fragment, concatenating parameter types.
   */
  append<P2 extends readonly unknown[], R2>(
    other: TypedFragment<P2, R2>
  ): TypedFragment<Concat<P, P2>, R extends Unit ? R2 : R> {
    const result = this.toFragment().append(other.toFragment());
    return new TypedFragment([...result.segments], [...result.params]) as TypedFragment<
      Concat<P, P2>,
      R extends Unit ? R2 : R
    >;
  }

  /**
   * Prepend another fragment.
   */
  prepend<P2 extends readonly unknown[], R2>(
    other: TypedFragment<P2, R2>
  ): TypedFragment<Concat<P2, P>, R2 extends Unit ? R : R2> {
    const result = this.toFragment().prepend(other.toFragment());
    return new TypedFragment([...result.segments], [...result.params]) as TypedFragment<
      Concat<P2, P>,
      R2 extends Unit ? R : R2
    >;
  }

  /**
   * Wrap in parentheses.
   */
  parens(): TypedFragment<P, R> {
    const result = this.toFragment().parens();
    return new TypedFragment([...result.segments], [...result.params]);
  }

  /**
   * Create a typed query from this fragment.
   */
  toQuery(): TypedQuery<P, R> {
    return new TypedQuery(this);
  }

  /**
   * Create a typed update from this fragment.
   */
  toUpdate(): TypedUpdate<P> {
    return new TypedUpdate(this as TypedFragment<P, Unit>);
  }
}

// ============================================================================
// TypedQuery — Queries with known result types
// ============================================================================

/**
 * A SQL query with compile-time parameter and result types.
 *
 * A TypedQuery is a description: it carries the SQL, an optional row decoder
 * (set by `to`/`map`) and a cardinality (set by `unique`/`option`). Running it
 * with `ConnectionIO.query(q)` / `ConnectionIO.queryMany(q)` applies both.
 *
 * @typeParam P - Parameter types
 * @typeParam R - Result row type
 */
export class TypedQuery<P extends readonly unknown[], R> {
  /**
   * Decodes one result row. `undefined` means "no decoder of its own": rows
   * are returned as-is, or decoded by the Read passed to `ConnectionIO.query`.
   */
  readonly decoder: RowDecoder<R> | undefined;
  /** How many rows the query must return; checked when it runs. */
  readonly cardinality: QueryCardinality;

  constructor(
    readonly fragment: TypedFragment<P, R>,
    options: { decoder?: RowDecoder<R>; cardinality?: QueryCardinality } = {}
  ) {
    this.decoder = options.decoder;
    this.cardinality = options.cardinality ?? "many";
  }

  /**
   * Brand for the result type (used by type inference).
   */
  readonly __result!: R;
  readonly __params!: P;

  /**
   * Get the SQL string and parameters, rendered for `dialect` (default
   * Postgres `$n`). Nested fragments are inlined.
   */
  toSql(dialect?: DialectLike): { sql: string; params: readonly SqlParam[] } {
    const { text, params } = renderFragment(this.fragment, dialect);
    return { sql: text, params: params as SqlParam[] };
  }

  /** Decode one row with this query's decoder (the raw row if it has none). */
  decode(row: SqlRow): R | null {
    return this.decoder ? this.decoder(row) : (row as R);
  }

  private derive<R2>(decoder: RowDecoder<R2>, cardinality = this.cardinality): TypedQuery<P, R2> {
    return new TypedQuery(this.fragment as unknown as TypedFragment<P, R2>, {
      decoder,
      cardinality,
    });
  }

  /**
   * Transform each result row with `f`, after this query's decoder (or on the
   * raw row if it has none). A row the decoder rejects (`null`) stays `null`.
   */
  map<R2>(f: (row: R) => R2): TypedQuery<P, R2> {
    return this.derive((row) => {
      const a = this.decode(row);
      return a === null ? null : f(a);
    });
  }

  /** Decode result rows with `read` (replacing any earlier decoder). */
  to<R2>(read: Pick<Read<R2>, "read">): TypedQuery<P, R2> {
    return this.derive((row) => read.read(row));
  }

  /**
   * Expect exactly one row: running the query fails unless one row comes back.
   */
  unique(): TypedQuery<P, R> {
    return this.derive((row) => this.decode(row), "unique");
  }

  /**
   * Expect zero or one row: running the query gives `null` for no row and
   * fails for more than one.
   */
  option(): TypedQuery<P, R | null> {
    return this.derive<R | null>((row) => this.decode(row), "option");
  }
}

// ============================================================================
// TypedUpdate — Updates with parameter types
// ============================================================================

/**
 * A SQL update/insert/delete with compile-time parameter types.
 *
 * @typeParam P - Parameter types
 */
export class TypedUpdate<P extends readonly unknown[]> {
  constructor(readonly fragment: TypedFragment<P, unknown>) {}

  readonly __params!: P;

  /**
   * Get the SQL string and parameters, rendered for `dialect` (default
   * Postgres `$n`). Nested fragments are inlined.
   */
  toSql(dialect?: DialectLike): { sql: string; params: readonly SqlParam[] } {
    const { text, params } = renderFragment(this.fragment, dialect);
    return { sql: text, params: params as SqlParam[] };
  }

  /**
   * A program that executes this statement and returns the affected row
   * count (same as `ConnectionIO.execute(update)`); run it with a Transactor.
   */
  run(): ConnectionIO<number> {
    return ConnectionIO.execute(this);
  }

  /**
   * A query that runs this statement with `RETURNING <columns>` appended
   * (unless it already has a RETURNING clause), so the generated keys come
   * back as rows. Columns are validated as identifiers.
   */
  withGeneratedKeys<K extends string>(...columns: K[]): TypedQuery<P, Record<K, unknown>> {
    if (columns.length === 0) {
      throw new TypeError("withGeneratedKeys: name at least one column");
    }
    const cols = columns.map((c) => assertSafeIdentifier(c, "RETURNING column")).join(", ");
    // Same check ConnectionIO.executeWithKeys makes, on the rendered SQL (so a
    // RETURNING inside a nested fragment counts).
    const hasReturning = /\bRETURNING\b/i.test(renderFragment(this.fragment).text);
    const base = this.fragment.toFragment();
    const frag = hasReturning ? base : base.append(Fragment.raw(`RETURNING ${cols}`));
    return new TypedQuery(
      new TypedFragment<P, Record<K, unknown>>([...frag.segments], [...frag.params])
    );
  }
}

// ============================================================================
// Fragment Combinators (Typed versions)
// ============================================================================

/** Empty typed fragment */
export const emptyTyped: TypedFragment<Empty, Unit> = new TypedFragment([""], []);

/**
 * Join fragments with a separator (AND, OR, comma, etc.).
 */
export function intercalateTyped<P extends readonly unknown[], R>(
  sep: TypedFragment<Empty, Unit>,
  fragments: readonly TypedFragment<P, R>[]
): TypedFragment<P[], R> {
  if (fragments.length === 0) {
    return emptyTyped as unknown as TypedFragment<P[], R>;
  }

  const allSegments: string[] = [];
  const allParams: SqlParam[] = [];

  for (let i = 0; i < fragments.length; i++) {
    const frag = fragments[i];
    if (i > 0) {
      // Add separator
      allSegments[allSegments.length - 1] += sep.segments[0];
      for (let j = 1; j < sep.segments.length; j++) {
        allSegments.push(sep.segments[j]);
      }
      allParams.push(...sep.params);
    }
    // Add fragment
    if (allSegments.length === 0) {
      allSegments.push(...frag.segments);
    } else {
      allSegments[allSegments.length - 1] += frag.segments[0];
      for (let j = 1; j < frag.segments.length; j++) {
        allSegments.push(frag.segments[j]);
      }
    }
    allParams.push(...frag.params);
  }

  return new TypedFragment(allSegments, allParams);
}

/**
 * Join typed fragments with AND.
 */
export function andTyped<P extends readonly unknown[]>(
  ...fragments: TypedFragment<P, Unit>[]
): TypedFragment<P[], Unit> {
  return intercalateTyped(new TypedFragment([" AND "], []), fragments);
}

/**
 * Join typed fragments with OR, wrapped in parentheses (like `Fragment.or`) so
 * `andTyped(orTyped(a, b), c)` keeps the intended precedence.
 */
export function orTyped<P extends readonly unknown[]>(
  ...fragments: TypedFragment<P, Unit>[]
): TypedFragment<P[], Unit> {
  if (fragments.length === 0) return emptyTyped as unknown as TypedFragment<P[], Unit>;
  return intercalateTyped(new TypedFragment([" OR "], []), fragments).parens();
}

/**
 * Join typed fragments with commas.
 */
export function commasTyped<P extends readonly unknown[], R>(
  ...fragments: TypedFragment<P, R>[]
): TypedFragment<P[], R> {
  return intercalateTyped(new TypedFragment([", "], []), fragments);
}

// ============================================================================
// Type-Safe IN Clause
// ============================================================================

/**
 * Create a typed IN clause fragment.
 *
 * @example
 * ```typescript
 * const ids = [1, 2, 3];
 * const inClause = inListTyped<number>("id", ids);
 * // TypedFragment<[number, number, number], Unit>
 * // SQL: "id IN (?, ?, ?)"
 * ```
 */
export function inListTyped<T>(column: string, values: readonly T[]): TypedFragment<T[], Unit> {
  assertSafeIdentifier(column, "column name");
  if (values.length === 0) {
    // Empty IN is always false
    return new TypedFragment(["1 = 0"], []);
  }

  // Real segments, one per param (segments.length === params.length + 1).
  const segments = [`${column} IN (`];
  for (let i = 0; i < values.length; i++) {
    segments.push(i < values.length - 1 ? ", " : ")");
  }
  return new TypedFragment(segments, values as unknown as readonly SqlParam[]);
}

/** `(p1, p2, …)` placeholder-list segments for `n` params. */
function tupleSegments(n: number, prefix = "(", suffix = ")"): string[] {
  if (n === 0) return [prefix + suffix];
  const segs = [prefix];
  for (let i = 0; i < n; i++) segs.push(i < n - 1 ? ", " : suffix);
  return segs;
}

// ============================================================================
// Type-Safe VALUES Clause
// ============================================================================

/**
 * Create a typed VALUES clause for INSERT.
 *
 * @example
 * ```typescript
 * const user = { name: "Alice", email: "alice@example.com" };
 * const values = valuesTyped(UserMeta, user);
 * // TypedFragment<[string, string], Unit>
 * // SQL: "(?, ?)"
 * ```
 */
export function valuesTyped<A>(meta: Write<A>, value: A): TypedFragment<unknown[], Unit> {
  const params = meta.write(value);
  return new TypedFragment(tupleSegments(params.length), params as readonly SqlParam[]);
}

/**
 * Create multiple VALUES rows for batch INSERT.
 */
export function valuesManyTyped<A>(
  meta: Write<A>,
  values: readonly A[]
): TypedFragment<unknown[], Unit> {
  if (values.length === 0) {
    return emptyTyped as unknown as TypedFragment<unknown[], Unit>;
  }

  const rows = values.map((value) => {
    const params = meta.write(value);
    return new TypedFragment(tupleSegments(params.length), params as readonly SqlParam[]);
  });
  return intercalateTyped(
    new TypedFragment([", "], []),
    rows as unknown as TypedFragment<unknown[], Unit>[]
  ) as unknown as TypedFragment<unknown[], Unit>;
}

// ============================================================================
// Type-Safe SET Clause
// ============================================================================

/**
 * Create a typed SET clause for UPDATE from a partial value.
 *
 * Only fields that are present (not `undefined`) in `value` are written, and
 * only their own extractors run — so omitted Date/bigint fields don't crash and
 * omitted optional fields aren't overwritten with NULL. This needs the Write's
 * per-field metadata (`fields` + `extractors`), which `@derive(Write)`,
 * `deriveWrite`, and `Write.make(columns, extractors, fields)` provide.
 *
 * @example
 * ```typescript
 * const updates = { name: "Bob", email: "bob@example.com" };
 * const setClause = setTyped(UserWrite, updates);
 * // SQL: "name = $1, email = $2"
 * ```
 */
export function setTyped<A>(meta: Write<A>, value: Partial<A>): TypedFragment<unknown[], Unit> {
  const { columns, fields, extractors } = meta;
  if (!fields || !extractors || fields.length !== columns.length) {
    throw new Error(
      "setTyped needs a Write with per-field metadata (fields + extractors): use " +
        "@derive(Write), deriveWrite(), or Write.make(columns, extractors, fields)"
    );
  }

  const parts: TypedFragment<unknown[], Unit>[] = [];
  for (let i = 0; i < columns.length; i++) {
    const field = fields[i];
    if ((value as Record<string, unknown>)[field] === undefined) continue;
    const col = assertSafeIdentifier(columns[i], "column name");
    const param = extractors[i](value as A) as SqlParam;
    parts.push(new TypedFragment([`${col} = `, ""], [param]));
  }

  return intercalateTyped(new TypedFragment([", "], []), parts) as unknown as TypedFragment<
    unknown[],
    Unit
  >;
}

// ============================================================================
// Conditional Fragments
// ============================================================================

/**
 * Conditionally include a fragment.
 */
export function whenTyped<P extends readonly unknown[], R>(
  condition: boolean,
  fragment: TypedFragment<P, R>
): TypedFragment<P, R> | TypedFragment<Empty, Unit> {
  return condition ? fragment : emptyTyped;
}

/**
 * Build a WHERE clause from optional conditions.
 */
export function whereAndTyped<P extends readonly unknown[]>(
  ...conditions: (TypedFragment<P, Unit> | null | undefined | false)[]
): TypedFragment<P[], Unit> {
  const validConditions = conditions.filter(
    (c): c is TypedFragment<P, Unit> => c instanceof TypedFragment
  );

  if (validConditions.length === 0) {
    return emptyTyped as unknown as TypedFragment<P[], Unit>;
  }

  const combined = andTyped(...validConditions);
  return new TypedFragment(
    ["WHERE " + combined.segments[0], ...combined.segments.slice(1)],
    [...combined.params]
  ) as TypedFragment<P[], Unit>;
}

// Brand TypedFragment instances so the shared renderer (and __sql_build) inline them.
Object.defineProperty(TypedFragment.prototype, FRAGMENT_BRAND, { value: true });
