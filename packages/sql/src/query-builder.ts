/**
 * @typesugar/sql — Query Builder DSL (runtime).
 *
 * Pure runtime helpers (no `typescript` import). Exported from the package's `.`
 * entry. The compile-time `sql$`/`@schema` macros live in `./macros` (PEP-050).
 */

/**
 * Start building a SELECT query with type inference.
 *
 * ```typescript
 * const query = select<User>("id", "name")
 *   .from("users")
 *   .where(sql$`active = ${true}`);
 * ```
 */
export function select<R>(...columns: (keyof R)[]): SelectBuilder<R> {
  return new SelectBuilder<R>(columns as string[]);
}

export class SelectBuilder<R> {
  private _columns: string[];
  private _from: string = "";
  private _where: string[] = [];
  private _params: unknown[] = [];
  private _joins: string[] = [];
  private _orderBy: string[] = [];
  private _limit: number | null = null;
  private _offset: number | null = null;

  constructor(columns: string[]) {
    this._columns = columns;
  }

  from(table: string): this {
    this._from = table;
    return this;
  }

  where(fragment: { segments: string[]; params: { value: unknown }[] }): this {
    this._where.push(fragment.segments.join("?"));
    this._params.push(...fragment.params.map((p) => p.value));
    return this;
  }

  andWhere(fragment: { segments: string[]; params: { value: unknown }[] }): this {
    return this.where(fragment);
  }

  join(table: string, on: string): this {
    this._joins.push(`JOIN ${table} ON ${on}`);
    return this;
  }

  leftJoin(table: string, on: string): this {
    this._joins.push(`LEFT JOIN ${table} ON ${on}`);
    return this;
  }

  orderBy(...columns: string[]): this {
    this._orderBy.push(...columns);
    return this;
  }

  limit(n: number): this {
    this._limit = n;
    return this;
  }

  offset(n: number): this {
    this._offset = n;
    return this;
  }

  build(): { sql: string; params: unknown[] } {
    let sql = `SELECT ${this._columns.join(", ")} FROM ${this._from}`;

    if (this._joins.length > 0) {
      sql += " " + this._joins.join(" ");
    }

    if (this._where.length > 0) {
      sql += " WHERE " + this._where.join(" AND ");
    }

    if (this._orderBy.length > 0) {
      sql += " ORDER BY " + this._orderBy.join(", ");
    }

    if (this._limit !== null) {
      sql += ` LIMIT ${this._limit}`;
    }

    if (this._offset !== null) {
      sql += ` OFFSET ${this._offset}`;
    }

    return { sql, params: this._params };
  }
}
