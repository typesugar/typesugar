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

import { Fragment, SqlParam } from "./types.js";
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
 * @typeParam P - Parameter types
 * @typeParam R - Result row type
 */
export class TypedQuery<P extends readonly unknown[], R> {
  constructor(readonly fragment: TypedFragment<P, R>) {}

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

  /**
   * Map over the result type.
   */
  map<R2>(f: (row: R) => R2): TypedQuery<P, R2> {
    return new TypedQuery(this.fragment as unknown as TypedFragment<P, R2>);
  }

  /**
   * Convert to a list-returning query.
   */
  to<R2>(meta: Read<R2>): TypedQuery<P, R2> {
    return new TypedQuery(this.fragment as unknown as TypedFragment<P, R2>);
  }

  /**
   * Unique result (expects exactly one row).
   */
  unique(): TypedQuery<P, R> {
    return this;
  }

  /**
   * Optional result (expects zero or one row).
   */
  option(): TypedQuery<P, R | null> {
    return new TypedQuery(this.fragment as unknown as TypedFragment<P, R | null>);
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
   * Execute and return affected row count.
   */
  run(): TypedUpdate<P> {
    return this;
  }

  /**
   * Execute with generated keys returned.
   */
  withGeneratedKeys<K extends string>(...columns: K[]): TypedQuery<P, Record<K, unknown>> {
    return new TypedQuery(this.fragment as unknown as TypedFragment<P, Record<K, unknown>>);
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
