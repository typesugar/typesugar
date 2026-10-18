/**
 * @typesugar/sql — Query Builder DSL (runtime).
 *
 * Pure runtime helpers (no `typescript` import). Exported from the package's `.`
 * entry. The compile-time `sql$`/`@schema` macros live in `./macros` (PEP-050).
 *
 * Column/table names passed as strings are validated with
 * `assertSafeIdentifier` (they are spliced into SQL text — identifiers can't be
 * parameterised); use `Fragment.ident()` + `sql` for unusual names. Conditions
 * are fragments (`sql`/`sql$`), so their values stay bound parameters. The
 * `on` condition of `join`/`leftJoin` may be a fragment or a raw SQL string —
 * a raw string is NOT validated, never build it from user input.
 */

import { Fragment } from "./types.js";
import {
  type DialectLike,
  type FragmentLike,
  assertSafeIdentifier,
  renderFragment,
} from "./dialect.js";

/**
 * Start building a SELECT query with type inference.
 *
 * ```typescript
 * const query = select<User>("id", "name")
 *   .from("users")
 *   .where(sql$`active = ${true}`);
 * ```
 */
export function select<R>(...columns: (keyof R & string)[] | ["*"]): SelectBuilder<R> {
  return new SelectBuilder<R>(columns as string[]);
}

const ORDER_TERM = /^(.+?)(\s+(ASC|DESC))?(\s+NULLS\s+(FIRST|LAST))?$/i;

function asFragment(f: FragmentLike): Fragment {
  return new Fragment([...f.segments], [...(f.params as Fragment["params"])]);
}

export class SelectBuilder<R> {
  private _columns: string[];
  private _from: string = "";
  private _where: Fragment[] = [];
  private _joins: Fragment[] = [];
  private _orderBy: string[] = [];
  private _limit: number | null = null;
  private _offset: number | null = null;

  constructor(columns: string[]) {
    this._columns = columns.map((c) => (c === "*" ? c : assertSafeIdentifier(c, "column name")));
  }

  from(table: string): this {
    this._from = assertSafeIdentifier(table, "table name");
    return this;
  }

  /** Add a WHERE condition (a `sql`/`sql$` fragment). Multiple calls are ANDed. */
  where(fragment: FragmentLike): this {
    this._where.push(asFragment(fragment));
    return this;
  }

  andWhere(fragment: FragmentLike): this {
    return this.where(fragment);
  }

  join(table: string, on: string | FragmentLike): this {
    return this.addJoin("JOIN", table, on);
  }

  leftJoin(table: string, on: string | FragmentLike): this {
    return this.addJoin("LEFT JOIN", table, on);
  }

  private addJoin(kind: string, table: string, on: string | FragmentLike): this {
    const t = assertSafeIdentifier(table, "table name");
    const onFrag = typeof on === "string" ? Fragment.raw(on) : asFragment(on);
    this._joins.push(Fragment.raw(`${kind} ${t} ON `).appendNoSpace(onFrag));
    return this;
  }

  /** ORDER BY terms: `"col"`, `"col DESC"`, `"t.col ASC NULLS LAST"`. */
  orderBy(...columns: string[]): this {
    for (const term of columns) {
      const m = ORDER_TERM.exec(term.trim());
      if (!m) throw new Error(`Invalid ORDER BY term: ${JSON.stringify(term)}`);
      assertSafeIdentifier(m[1], "ORDER BY column");
      this._orderBy.push(term.trim());
    }
    return this;
  }

  limit(n: number): this {
    this._limit = assertNonNegativeInt(n, "LIMIT");
    return this;
  }

  offset(n: number): this {
    this._offset = assertNonNegativeInt(n, "OFFSET");
    return this;
  }

  /** The query as a Fragment (composable with `sql`). */
  toFragment(): Fragment {
    let frag = Fragment.raw(`SELECT ${this._columns.join(", ")} FROM ${this._from}`);
    for (const j of this._joins) frag = frag.append(j);
    if (this._where.length > 0) {
      // Parenthesise each condition when ANDing several, so an `a OR b`
      // condition can't change precedence.
      const conds = this._where.length > 1 ? this._where.map((w) => w.parens()) : this._where;
      frag = frag.append(Fragment.raw("WHERE ").appendNoSpace(Fragment.and(conds)));
    }
    if (this._orderBy.length > 0)
      frag = frag.append(Fragment.raw(`ORDER BY ${this._orderBy.join(", ")}`));
    if (this._limit !== null) frag = frag.append(Fragment.raw(`LIMIT ${this._limit}`));
    if (this._offset !== null) frag = frag.append(Fragment.raw(`OFFSET ${this._offset}`));
    return frag;
  }

  /** Render for a dialect (default Postgres `$n`; `"mysql"`/`"sqlite"` → `?`). */
  build(dialect?: DialectLike): { sql: string; params: unknown[] } {
    if (!this._from) throw new Error("select(...).from(table) is required before build()");
    const { text, params } = renderFragment(this.toFragment(), dialect);
    return { sql: text, params };
  }
}

function assertNonNegativeInt(n: number, what: string): number {
  if (!Number.isInteger(n) || n < 0) throw new Error(`${what} must be a non-negative integer`);
  return n;
}
