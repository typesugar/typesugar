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
 * const byId = sql$<[number]>`WHERE id = ${0}`;
 *
 * // Result types inferred from SELECT clause
 * const selectUsers = sql$<[], User>`
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
import { Read, Write, SqlRow } from "./meta.js";

// ============================================================================
// Type-Level Utilities
// ============================================================================

/** Concatenate two tuples at the type level */
export type Concat<
  A extends readonly unknown[],
  B extends readonly unknown[],
> = [...A, ...B];

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
   * Get the rendered query with positional placeholders.
   */
  get query(): { text: string; params: readonly SqlParam[] } {
    return this.toFragment().query;
  }

  /**
   * Append another fragment, concatenating parameter types.
   */
  append<P2 extends readonly unknown[], R2>(
    other: TypedFragment<P2, R2>,
  ): TypedFragment<Concat<P, P2>, R extends Unit ? R2 : R> {
    const result = this.toFragment().append(other.toFragment());
    return new TypedFragment(
      [...result.segments],
      [...result.params],
    ) as TypedFragment<Concat<P, P2>, R extends Unit ? R2 : R>;
  }

  /**
   * Prepend another fragment.
   */
  prepend<P2 extends readonly unknown[], R2>(
    other: TypedFragment<P2, R2>,
  ): TypedFragment<Concat<P2, P>, R2 extends Unit ? R : R2> {
    const result = this.toFragment().prepend(other.toFragment());
    return new TypedFragment(
      [...result.segments],
      [...result.params],
    ) as TypedFragment<Concat<P2, P>, R2 extends Unit ? R : R2>;
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
   * Get the SQL string and parameters.
   */
  toSql(): { sql: string; params: readonly SqlParam[] } {
    return {
      sql: this.fragment.segments.join("?"),
      params: this.fragment.params,
    };
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
    return new TypedQuery(
      this.fragment as unknown as TypedFragment<P, R | null>,
    );
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
   * Get the SQL string and parameters.
   */
  toSql(): { sql: string; params: readonly SqlParam[] } {
    return {
      sql: this.fragment.segments.join("?"),
      params: this.fragment.params,
    };
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
  withGeneratedKeys<K extends string>(
    ...columns: K[]
  ): TypedQuery<P, Record<K, unknown>> {
    return new TypedQuery(
      this.fragment as unknown as TypedFragment<P, Record<K, unknown>>,
    );
  }
}

// ============================================================================
// Fragment Combinators (Typed versions)
// ============================================================================

/** Empty typed fragment */
export const emptyTyped: TypedFragment<Empty, Unit> = new TypedFragment(
  [""],
  [],
);

/**
 * Join fragments with a separator (AND, OR, comma, etc.).
 */
export function intercalateTyped<P extends readonly unknown[], R>(
  sep: TypedFragment<Empty, Unit>,
  fragments: readonly TypedFragment<P, R>[],
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
 * Join typed fragments with OR.
 */
export function orTyped<P extends readonly unknown[]>(
  ...fragments: TypedFragment<P, Unit>[]
): TypedFragment<P[], Unit> {
  return intercalateTyped(new TypedFragment([" OR "], []), fragments);
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
export function inListTyped<T>(
  column: string,
  values: readonly T[],
): TypedFragment<T[], Unit> {
  if (values.length === 0) {
    // Empty IN is always false
    return new TypedFragment(["1 = 0"], []);
  }

  const placeholders = values.map(() => "?").join(", ");
  return new TypedFragment(
    [`${column} IN (${placeholders})`],
    values as unknown as readonly SqlParam[],
  );
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
export function valuesTyped<A>(
  meta: Write<A>,
  value: A,
): TypedFragment<unknown[], Unit> {
  const params = meta.write(value);
  const placeholders = params.map(() => "?").join(", ");
  return new TypedFragment(
    [`(${placeholders})`],
    params as readonly SqlParam[],
  );
}

/**
 * Create multiple VALUES rows for batch INSERT.
 */
export function valuesManyTyped<A>(
  meta: Write<A>,
  values: readonly A[],
): TypedFragment<unknown[], Unit> {
  if (values.length === 0) {
    return emptyTyped as unknown as TypedFragment<unknown[], Unit>;
  }

  const allParams: SqlParam[] = [];
  const rows: string[] = [];

  for (const value of values) {
    const params = meta.write(value);
    const placeholders = params.map(() => "?").join(", ");
    rows.push(`(${placeholders})`);
    allParams.push(...(params as SqlParam[]));
  }

  return new TypedFragment([rows.join(", ")], allParams);
}

// ============================================================================
// Type-Safe SET Clause
// ============================================================================

/**
 * Create a typed SET clause for UPDATE.
 *
 * @example
 * ```typescript
 * const updates = { name: "Bob", email: "bob@example.com" };
 * const setClause = setTyped(UserMeta, updates);
 * // SQL: "name = ?, email = ?"
 * ```
 */
export function setTyped<A>(
  meta: Write<A>,
  value: Partial<A>,
): TypedFragment<unknown[], Unit> {
  const columns = meta.columns;
  const allValues = meta.write(value as A);

  const setClauses: string[] = [];
  const params: SqlParam[] = [];

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    const val = allValues[i];
    // Only include non-undefined values
    if (val !== undefined) {
      setClauses.push(`${col} = ?`);
      params.push(val as SqlParam);
    }
  }

  return new TypedFragment([setClauses.join(", ")], params);
}

// ============================================================================
// Conditional Fragments
// ============================================================================

/**
 * Conditionally include a fragment.
 */
export function whenTyped<P extends readonly unknown[], R>(
  condition: boolean,
  fragment: TypedFragment<P, R>,
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
    (c): c is TypedFragment<P, Unit> => c instanceof TypedFragment,
  );

  if (validConditions.length === 0) {
    return emptyTyped as unknown as TypedFragment<P[], Unit>;
  }

  const combined = andTyped(...validConditions);
  return new TypedFragment(
    ["WHERE " + combined.segments[0], ...combined.segments.slice(1)],
    [...combined.params],
  ) as TypedFragment<P[], Unit>;
}
