/**
 * Doobie-like Type-Safe SQL DSL
 *
 * Inspired by Scala's Doobie library, this module provides composable SQL
 * fragments with type-safe parameter binding. SQL statements are built from
 * fragments that can be combined, nested, and composed — parameters are
 * tracked and flattened automatically.
 *
 * Key concepts:
 * - Fragment: an SQL string paired with its bound parameters
 * - Fragments compose via concatenation, AND/OR combinators, IN lists, etc.
 * - The sql`` tagged template is the primary entry point
 * - Parameters are always positional ($1, $2, …) in the final output
 *
 * @example
 * ```typescript
 * const name = "Alice";
 * const age = 30;
 *
 * const base = sql`SELECT * FROM users`;
 * const cond = sql`WHERE name = ${name} AND age > ${age}`;
 * const query = base.append(cond);
 *
 * query.text;   // "SELECT * FROM users WHERE name = $1 AND age > $2"
 * query.params; // ["Alice", 30]
 * ```
 */

// ============================================================================
// Param Types
// ============================================================================

/** Values that can be bound as SQL parameters */
export type SqlParam = string | number | boolean | null | Date | Buffer | SqlParam[];

// ============================================================================
// Fragment — the core composable SQL building block
// ============================================================================

/**
 * An SQL fragment: a piece of SQL text with associated parameters.
 *
 * Fragments are the fundamental unit of composition. They track raw SQL
 * segments and parameter values separately, then render to a final
 * parameterised query string on demand.
 *
 * Immutable — every combinator returns a new Fragment.
 */
export class Fragment {
  /**
   * @param segments - Raw SQL text segments (one more than params)
   * @param params  - Bound parameter values, interleaved between segments
   */
  constructor(
    readonly segments: readonly string[],
    readonly params: readonly SqlParam[]
  ) {}

  // --------------------------------------------------------------------------
  // Rendering
  // --------------------------------------------------------------------------

  /** Render to a parameterised query with positional placeholders ($1, $2, …) */
  get query(): { text: string; params: readonly SqlParam[] } {
    const allParams: SqlParam[] = [];
    const parts: string[] = [];

    for (let i = 0; i < this.segments.length; i++) {
      parts.push(this.segments[i]);
      if (i < this.params.length) {
        const param = this.params[i];
        if (param instanceof Fragment) {
          // Nested fragment — inline its SQL and collect its params
          const nested = param.query;
          // Re-number the nested placeholders
          const offset = allParams.length;
          const renumbered = nested.text.replace(/\$(\d+)/g, (_, n) => `$${parseInt(n) + offset}`);
          parts.push(renumbered);
          allParams.push(...nested.params);
        } else {
          allParams.push(param);
          parts.push(`$${allParams.length}`);
        }
      }
    }

    return { text: parts.join(""), params: allParams };
  }

  /** Shorthand: rendered SQL text */
  get text(): string {
    return this.query.text;
  }

  /** Shorthand: rendered parameter array */
  get values(): readonly SqlParam[] {
    return this.query.params;
  }

  // --------------------------------------------------------------------------
  // Composition
  // --------------------------------------------------------------------------

  /** Concatenate two fragments with a space separator */
  append(other: Fragment): Fragment {
    return Fragment.concat(this, other);
  }

  /** Prepend another fragment */
  prepend(other: Fragment): Fragment {
    return Fragment.concat(other, this);
  }

  /** Wrap with parentheses */
  parens(): Fragment {
    return Fragment.raw("(").appendNoSpace(this).appendNoSpace(Fragment.raw(")"));
  }

  /** Concatenate without adding a space */
  appendNoSpace(other: Fragment): Fragment {
    // Merge the last segment of `this` with the first segment of `other`
    const newSegments = [
      ...this.segments.slice(0, -1),
      this.segments[this.segments.length - 1] + other.segments[0],
      ...other.segments.slice(1),
    ];
    return new Fragment(newSegments, [...this.params, ...other.params]);
  }

  // --------------------------------------------------------------------------
  // SQL Combinators
  // --------------------------------------------------------------------------

  /** Join fragments with AND */
  static and(fragments: Fragment[]): Fragment {
    return Fragment.intercalate(Fragment.raw(" AND "), fragments);
  }

  /** Join fragments with OR (wrapped in parens for safety) */
  static or(fragments: Fragment[]): Fragment {
    return Fragment.intercalate(Fragment.raw(" OR "), fragments).parens();
  }

  /** Join fragments with a separator */
  static intercalate(sep: Fragment, fragments: Fragment[]): Fragment {
    if (fragments.length === 0) return Fragment.empty;
    let result = fragments[0];
    for (let i = 1; i < fragments.length; i++) {
      result = result.appendNoSpace(sep).appendNoSpace(fragments[i]);
    }
    return result;
  }

  /** Comma-separated list */
  static commas(fragments: Fragment[]): Fragment {
    return Fragment.intercalate(Fragment.raw(", "), fragments);
  }

  /** Concatenate two fragments with a space */
  static concat(a: Fragment, b: Fragment): Fragment {
    // Join with a space between the last segment of a and first segment of b
    const newSegments = [
      ...a.segments.slice(0, -1),
      a.segments[a.segments.length - 1] + " " + b.segments[0],
      ...b.segments.slice(1),
    ];
    return new Fragment(newSegments, [...a.params, ...b.params]);
  }

  // --------------------------------------------------------------------------
  // Constructors
  // --------------------------------------------------------------------------

  /** Empty fragment */
  static readonly empty = new Fragment([""], []);

  /** Raw SQL with no parameters */
  static raw(sql: string): Fragment {
    return new Fragment([sql], []);
  }

  /** A single parameter placeholder */
  static param(value: SqlParam): Fragment {
    return new Fragment(["", ""], [value]);
  }

  /**
   * IN-list: `column IN ($1, $2, $3)`
   *
   * Expands an array into a comma-separated parameter list.
   */
  static inList(column: string, values: SqlParam[]): Fragment {
    if (values.length === 0) {
      return Fragment.raw("FALSE"); // empty IN is always false
    }
    const segments = [column + " IN ("];
    const params: SqlParam[] = [];
    for (let i = 0; i < values.length; i++) {
      segments.push(i < values.length - 1 ? ", " : ")");
      params.push(values[i]);
    }
    return new Fragment(segments, params);
  }

  /**
   * VALUES clause for bulk inserts.
   *
   * @param rows - Array of row tuples
   */
  static values(rows: SqlParam[][]): Fragment {
    const rowFragments = rows.map((row) => {
      const inner = Fragment.commas(row.map((v) => Fragment.param(v)));
      return inner.parens();
    });
    return Fragment.raw("VALUES ").appendNoSpace(
      Fragment.intercalate(Fragment.raw(", "), rowFragments)
    );
  }

  /**
   * SET clause for updates: `SET col1 = $1, col2 = $2`
   */
  static set(assignments: Record<string, SqlParam>): Fragment {
    const frags = Object.entries(assignments).map(
      ([col, val]) => new Fragment([`${col} = `, ""], [val])
    );
    return Fragment.raw("SET ").appendNoSpace(Fragment.commas(frags));
  }

  /**
   * Optional fragment — include only if the condition is true.
   * Useful for dynamic WHERE clauses.
   */
  static when(condition: boolean, fragment: () => Fragment): Fragment {
    return condition ? fragment() : Fragment.empty;
  }

  /**
   * Build a WHERE clause from optional conditions.
   * Only non-empty fragments are included, joined with AND.
   */
  static whereAnd(fragments: Fragment[]): Fragment {
    const nonEmpty = fragments.filter((f) => f.segments.join("").trim() !== "");
    if (nonEmpty.length === 0) return Fragment.empty;
    return Fragment.raw("WHERE ").appendNoSpace(Fragment.and(nonEmpty));
  }

  // --------------------------------------------------------------------------
  // Debugging
  // --------------------------------------------------------------------------

  /** String representation for debugging */
  toString(): string {
    const { text, params } = this.query;
    return `Fragment(${text}, [${params.map((p) => JSON.stringify(p)).join(", ")}])`;
  }
}

// ============================================================================
// Query & Update — typed wrappers for read vs write operations
// ============================================================================

/**
 * A SELECT query that returns rows of type R.
 *
 * This is a branded wrapper around Fragment that carries the expected
 * result row type for downstream consumption (e.g. by a database driver).
 */
export class Query<R> {
  readonly _tag = "Query" as const;

  constructor(readonly fragment: Fragment) {}

  get text(): string {
    return this.fragment.text;
  }

  get params(): readonly SqlParam[] {
    return this.fragment.values;
  }

  /** Map over the expected result type (compile-time only) */
  map<B>(_f: (a: R) => B): Query<B> {
    return new Query<B>(this.fragment);
  }

  /** Append a fragment to this query */
  append(other: Fragment): Query<R> {
    return new Query<R>(this.fragment.append(other));
  }

  toString(): string {
    return `Query(${this.fragment.text})`;
  }
}

/**
 * An INSERT/UPDATE/DELETE statement that affects rows.
 */
export class Update {
  readonly _tag = "Update" as const;

  constructor(readonly fragment: Fragment) {}

  get text(): string {
    return this.fragment.text;
  }

  get params(): readonly SqlParam[] {
    return this.fragment.values;
  }

  toString(): string {
    return `Update(${this.fragment.text})`;
  }
}

// ============================================================================
// ConnectionIO — a description of a database operation (pure, composable)
// ============================================================================

/**
 * A description of a database operation, inspired by Doobie's ConnectionIO.
 *
 * ConnectionIO values are pure descriptions — they don't execute anything
 * until interpreted by a Transactor. This allows composition, sequencing,
 * and transactional grouping.
 */
export type ConnectionIO<A> =
  | { _tag: "Pure"; value: A }
  | {
      _tag: "QueryIO";
      query: Query<A>;
      decoder: (row: Record<string, unknown>) => A;
    }
  | { _tag: "UpdateIO"; update: Update }
  | {
      _tag: "FlatMap";
      source: ConnectionIO<unknown>;
      f: (a: unknown) => ConnectionIO<A>;
    }
  | { _tag: "Sequence"; operations: ConnectionIO<unknown>[] };

export const ConnectionIO = {
  /** Lift a pure value */
  pure<A>(value: A): ConnectionIO<A> {
    return { _tag: "Pure", value };
  },

  /** Create a query operation */
  query<A>(q: Query<A>, decoder: (row: Record<string, unknown>) => A): ConnectionIO<A[]> {
    return {
      _tag: "QueryIO",
      query: q as unknown as Query<A[]>,
      decoder: decoder as unknown as (row: Record<string, unknown>) => A[],
    };
  },

  /** Create an update operation */
  update(u: Update): ConnectionIO<number> {
    return { _tag: "UpdateIO", update: u } as unknown as ConnectionIO<number>;
  },

  /** Sequence: run one operation, then use its result to decide the next */
  flatMap<A, B>(source: ConnectionIO<A>, f: (a: A) => ConnectionIO<B>): ConnectionIO<B> {
    return {
      _tag: "FlatMap",
      source: source as ConnectionIO<unknown>,
      f: f as (a: unknown) => ConnectionIO<B>,
    };
  },

  /** Map over the result */
  map<A, B>(source: ConnectionIO<A>, f: (a: A) => B): ConnectionIO<B> {
    return ConnectionIO.flatMap(source, (a) => ConnectionIO.pure(f(a)));
  },
};

// ============================================================================
// Transactor — interprets ConnectionIO against a real database connection
// ============================================================================

/**
 * Minimal database connection interface.
 * Compatible with node-postgres (pg), mysql2, better-sqlite3, etc.
 */
export interface DbConnection {
  query(text: string, params: readonly SqlParam[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * Interprets ConnectionIO programs against a database connection.
 */
export class Transactor {
  constructor(private readonly conn: DbConnection) {}

  async run<A>(program: ConnectionIO<A>): Promise<A> {
    switch (program._tag) {
      case "Pure":
        return program.value;

      case "QueryIO": {
        const { text, params } = program.query;
        const result = await this.conn.query(text, params);
        return result.rows.map(program.decoder) as unknown as A;
      }

      case "UpdateIO": {
        const { text, params } = program.update;
        const result = await this.conn.query(text, params);
        return (result.rows.length ?? 0) as unknown as A;
      }

      case "FlatMap": {
        const a = await this.run(program.source);
        return this.run(program.f(a));
      }

      case "Sequence": {
        let last: unknown;
        for (const op of program.operations) {
          last = await this.run(op);
        }
        return last as A;
      }
    }
  }
}
