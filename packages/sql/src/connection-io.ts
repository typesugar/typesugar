/**
 * ConnectionIO<A> — Pure Database Operations (Doobie-Style)
 *
 * ConnectionIO is a free monad describing database operations. It separates
 * the description of what to do from the execution, enabling:
 *
 * - Pure functional database code (referentially transparent)
 * - Composable transactions
 * - Testability (mock interpreters)
 * - Resource safety (connection handling)
 *
 * ## Zero-Cost Implementation
 *
 * Unlike Doobie's runtime free monad, typesugar's ConnectionIO is specialized
 * at compile time (always-on specialization, no explicit call needed):
 *
 * ```typescript
 * // Before (generic monadic composition):
 * const program: ConnectionIO<User> = for$ {
 *   user <- findUser(userId);
 *   _ <- auditLog("Fetched user", userId);
 *   return user;
 * }
 *
 * // After (specialized - direct async code):
 * const program = async (conn: DbConnection) => {
 *   const user = await conn.query("SELECT ...", [userId]);
 *   await conn.execute("INSERT INTO audit_log ...", ["Fetched user", userId]);
 *   return user;
 * };
 * ```
 *
 * ## Operations
 *
 * The algebra of database operations:
 * - `pure(a)` — Lift a value into ConnectionIO
 * - `query(q)` — Execute a query returning rows
 * - `execute(u)` — Execute an update returning affected count
 * - `executeWithKeys(u, cols)` — Execute returning generated keys
 * - `raw(sql, params)` — Raw SQL execution
 * - `transact(cio)` — Run in a transaction
 *
 * ## Monad Operations
 *
 * - `map(f)` — Transform the result
 * - `flatMap(f)` — Chain operations
 * - `ap(fab)` — Applicative apply
 * - `zip(other)` — Combine two operations
 *
 * @module
 */

import { TypedQuery, TypedUpdate } from "./typed-fragment.js";
import { Read, SqlRow } from "./meta.js";
import { Queryable } from "./queryable.js";
import { Query, Update, type SqlParam } from "./types.js";
import { type DialectLike, assertSafeIdentifier, renderFragment } from "./dialect.js";

/**
 * A query accepted by `ConnectionIO.query`/`queryMany`: a typed query
 * (`sql$`...`.toQuery()`) or an untyped one (`sql`...`.toQuery()`).
 */
export type AnyQuery<A> = TypedQuery<readonly unknown[], A> | Query<A>;

/**
 * Anything that can decode a row: a `Read<A>`, a `Codec<A>`, or a
 * `@derive(Meta)`-generated instance.
 */
export type RowReader<A> = Pick<Read<A>, "read">;

/** An update accepted by `ConnectionIO.execute`/`executeWithKeys`. */
export type AnyUpdate = TypedUpdate<readonly unknown[]> | Update;

/** Render a query/update for a dialect through the single shared renderer. */
function renderStatement(
  q: AnyQuery<unknown> | AnyUpdate,
  dialect: DialectLike | undefined
): { sql: string; params: readonly SqlParam[] } {
  const { text, params } = renderFragment(q.fragment, dialect);
  return { sql: text, params: params as SqlParam[] };
}

// ============================================================================
// ConnectionIO Algebra (Operations)
// ============================================================================

/**
 * The algebra of database operations.
 * Each operation is a node in the free monad's AST.
 */
export type ConnectionOp<A> =
  | { readonly _tag: "Pure"; readonly value: A }
  | {
      readonly _tag: "Query";
      readonly query: AnyQuery<A>;
      readonly read: RowReader<A>;
    }
  | {
      readonly _tag: "QueryMany";
      readonly query: AnyQuery<A>;
      readonly read: RowReader<A>;
    }
  | { readonly _tag: "Execute"; readonly update: AnyUpdate }
  | {
      readonly _tag: "ExecuteWithKeys";
      readonly update: AnyUpdate;
      readonly columns: string[];
    }
  | { readonly _tag: "Raw"; readonly sql: string; readonly params: unknown[] }
  | { readonly _tag: "Delay"; readonly thunk: () => A }
  | { readonly _tag: "Attempt"; readonly cio: ConnectionIO<A> }
  | {
      readonly _tag: "HandleError";
      readonly cio: ConnectionIO<A>;
      readonly handler: (e: Error) => ConnectionIO<A>;
    }
  | {
      readonly _tag: "ExecuteQueryable";
      readonly query: unknown;
      readonly queryable: Queryable<unknown>;
    }
  | { readonly _tag: "Transact"; readonly cio: ConnectionIO<A> }
  | {
      readonly _tag: "FlatMap";
      readonly source: ConnectionIO<unknown>;
      readonly f: (a: unknown) => ConnectionIO<A>;
    };

// ============================================================================
// ConnectionIO Class
// ============================================================================

/**
 * ConnectionIO<A> — A pure description of a database operation returning A.
 *
 * This is a free monad over ConnectionOp, allowing composition of database
 * operations without executing them.
 *
 * @typeParam A - The type of value this operation produces
 */
export class ConnectionIO<A> {
  constructor(readonly op: ConnectionOp<A>) {}

  // --------------------------------------------------------------------------
  // Functor
  // --------------------------------------------------------------------------

  /**
   * Transform the result with a pure function.
   */
  map<B>(f: (a: A) => B): ConnectionIO<B> {
    return this.flatMap((a) => ConnectionIO.pure(f(a)));
  }

  // --------------------------------------------------------------------------
  // Applicative
  // --------------------------------------------------------------------------

  /**
   * Apply a wrapped function to this value.
   */
  ap<B>(fab: ConnectionIO<(a: A) => B>): ConnectionIO<B> {
    return fab.flatMap((f) => this.map(f));
  }

  /**
   * Combine with another ConnectionIO, keeping both results.
   */
  zip<B>(other: ConnectionIO<B>): ConnectionIO<[A, B]> {
    return this.flatMap((a) => other.map((b) => [a, b] as [A, B]));
  }

  /**
   * Combine with another ConnectionIO, keeping left result.
   */
  zipLeft<B>(other: ConnectionIO<B>): ConnectionIO<A> {
    return this.flatMap((a) => other.map(() => a));
  }

  /**
   * Combine with another ConnectionIO, keeping right result.
   */
  zipRight<B>(other: ConnectionIO<B>): ConnectionIO<B> {
    return this.flatMap(() => other);
  }

  // --------------------------------------------------------------------------
  // Monad
  // --------------------------------------------------------------------------

  /**
   * Chain this operation with another that depends on the result.
   */
  flatMap<B>(f: (a: A) => ConnectionIO<B>): ConnectionIO<B> {
    return new ConnectionIO<B>({
      _tag: "FlatMap",
      source: this as ConnectionIO<unknown>,
      f: f as (a: unknown) => ConnectionIO<B>,
    });
  }

  /**
   * Alias for flatMap.
   */
  chain<B>(f: (a: A) => ConnectionIO<B>): ConnectionIO<B> {
    return this.flatMap(f);
  }

  /**
   * Sequence two operations, ignoring the first result.
   */
  andThen<B>(next: ConnectionIO<B>): ConnectionIO<B> {
    return this.flatMap(() => next);
  }

  // --------------------------------------------------------------------------
  // Error Handling
  // --------------------------------------------------------------------------

  /**
   * Attempt this operation, catching errors as Left.
   */
  attempt(): ConnectionIO<Either<Error, A>> {
    return new ConnectionIO({ _tag: "Attempt", cio: this }) as ConnectionIO<Either<Error, A>>;
  }

  /**
   * Handle errors with a recovery function.
   */
  handleError(handler: (e: Error) => ConnectionIO<A>): ConnectionIO<A> {
    return new ConnectionIO({ _tag: "HandleError", cio: this, handler });
  }

  /**
   * Provide a fallback value on error.
   */
  orElse(fallback: ConnectionIO<A>): ConnectionIO<A> {
    return this.handleError(() => fallback);
  }

  // --------------------------------------------------------------------------
  // Transaction Control
  // --------------------------------------------------------------------------

  /**
   * Run this operation in a transaction.
   * If any operation fails, the entire transaction is rolled back.
   */
  transact(): ConnectionIO<A> {
    return new ConnectionIO({ _tag: "Transact", cio: this });
  }

  // --------------------------------------------------------------------------
  // Static Constructors
  // --------------------------------------------------------------------------

  /**
   * Lift an ORM-specific query (like Kysely or Drizzle query builder)
   * into a ConnectionIO operation.
   */
  static fromQueryable<Q, A = unknown>(query: Q, queryable: Queryable<Q>): ConnectionIO<A> {
    return new ConnectionIO({
      _tag: "ExecuteQueryable",
      query,
      queryable: queryable as Queryable<unknown>,
    }) as ConnectionIO<A>;
  }

  /**
   * Lift a pure value into ConnectionIO.
   */
  static pure<A>(value: A): ConnectionIO<A> {
    return new ConnectionIO({ _tag: "Pure", value });
  }

  /**
   * Unit value.
   */
  static unit: ConnectionIO<void> = ConnectionIO.pure(undefined);

  /**
   * Delay a computation.
   */
  static delay<A>(thunk: () => A): ConnectionIO<A> {
    return new ConnectionIO({ _tag: "Delay", thunk });
  }

  /**
   * Lift a promise-returning function.
   */
  static async<A>(f: () => Promise<A>): ConnectionIO<A> {
    return new ConnectionIO({ _tag: "Delay", thunk: f as unknown as () => A });
  }

  /**
   * Execute a query returning a single result.
   */
  static query<A>(query: AnyQuery<A>, read: RowReader<A>): ConnectionIO<A | null> {
    return new ConnectionIO({
      _tag: "Query",
      query,
      read,
    }) as ConnectionIO<A | null>;
  }

  /**
   * Execute a query returning multiple results.
   */
  static queryMany<A>(query: AnyQuery<A>, read: RowReader<A>): ConnectionIO<A[]> {
    return new ConnectionIO({ _tag: "QueryMany", query, read }) as ConnectionIO<A[]>;
  }

  /**
   * Execute an update statement.
   */
  static execute(update: AnyUpdate): ConnectionIO<number> {
    return new ConnectionIO({
      _tag: "Execute",
      update,
    }) as ConnectionIO<number>;
  }

  /**
   * Execute an update returning generated keys.
   */
  static executeWithKeys<K extends string>(
    update: AnyUpdate,
    columns: K[]
  ): ConnectionIO<Record<K, unknown>[]> {
    for (const c of columns) assertSafeIdentifier(c, "RETURNING column");
    return new ConnectionIO({
      _tag: "ExecuteWithKeys",
      update,
      columns,
    }) as ConnectionIO<Record<K, unknown>[]>;
  }

  /**
   * Execute raw SQL.
   */
  static raw(sql: string, params: unknown[] = []): ConnectionIO<SqlRow[]> {
    return new ConnectionIO({ _tag: "Raw", sql, params }) as ConnectionIO<SqlRow[]>;
  }
}

// ============================================================================
// Either Type (for error handling)
// ============================================================================

export type Either<E, A> =
  | { readonly _tag: "Left"; readonly left: E }
  | { readonly _tag: "Right"; readonly right: A };

export const Left = <E, A>(left: E): Either<E, A> => ({ _tag: "Left", left });
export const Right = <E, A>(right: A): Either<E, A> => ({
  _tag: "Right",
  right,
});

// ============================================================================
// Transactor — Interprets ConnectionIO
// ============================================================================

/**
 * Database connection interface.
 * Implemented by various database drivers (pg, mysql2, better-sqlite3, etc.)
 */
export interface DbConnection {
  query(sql: string, params: readonly unknown[]): Promise<SqlRow[]>;
  execute(sql: string, params: readonly unknown[]): Promise<number>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/** Options for a {@link Transactor}. */
export interface TransactorOptions {
  /** Placeholder dialect for rendering queries (default Postgres `$n`). */
  readonly dialect?: DialectLike;
}

/**
 * Transactor — Interprets ConnectionIO programs against a database.
 *
 * The Transactor is responsible for:
 * - Managing connection lifecycle
 * - Interpreting the ConnectionIO algebra
 * - Handling transactions
 *
 * ## Zero-Cost Specialization
 *
 * Specialization is always on (PEP-053 removed the explicit `specialize(...)`
 * API). When the transformer can see the instance's method bodies, calls such
 * as `xa.run(cio)` are inlined automatically; there is nothing to call or
 * import. Opt out of a call site with a `@no-specialize` comment.
 */
export class Transactor {
  private readonly dialect: DialectLike | undefined;

  /**
   * @param getConnection - acquire a connection
   * @param releaseConnection - release it after the program finishes
   * @param options.dialect - placeholder style used to render queries
   *   (default Postgres `$n`; `"mysql"` / `"sqlite"` render `?`). See dialect.ts.
   */
  constructor(
    private readonly getConnection: () => Promise<DbConnection>,
    private readonly releaseConnection: (conn: DbConnection) => Promise<void>,
    options: TransactorOptions = {}
  ) {
    if (typeof getConnection !== "function" || typeof releaseConnection !== "function") {
      throw new TypeError(
        "new Transactor(getConnection, releaseConnection) takes two functions; " +
          "use Transactor.fromConnection(conn) or Transactor.fromPool(pool)"
      );
    }
    this.dialect = options.dialect;
  }

  /**
   * Run a ConnectionIO program.
   */
  async run<A>(cio: ConnectionIO<A>): Promise<A> {
    const conn = await this.getConnection();
    try {
      return await this.interpret(cio, conn);
    } finally {
      await this.releaseConnection(conn);
    }
  }

  /**
   * Run a ConnectionIO program in a transaction.
   */
  async transact<A>(cio: ConnectionIO<A>): Promise<A> {
    const conn = await this.getConnection();
    try {
      await conn.begin();
      const result = await this.interpret(cio, conn);
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      await this.releaseConnection(conn);
    }
  }

  /**
   * Interpret a ConnectionIO program.
   *
   * Stack-safe: `FlatMap` nodes are handled by an explicit continuation stack
   * in a loop rather than by recursion, so arbitrarily long chains built by
   * `sequence`/`traverse`/`unfold` (left- or right-nested) run in constant JS
   * stack. Only the scoped operations (`Attempt`, `HandleError`, `Transact`)
   * recurse, once per nesting level of those scopes.
   */
  private async interpret<A>(program: ConnectionIO<A>, conn: DbConnection): Promise<A> {
    const conts: Array<(a: unknown) => ConnectionIO<unknown>> = [];
    let current: ConnectionIO<unknown> = program as ConnectionIO<unknown>;

    for (;;) {
      const op = current.op;
      if (op._tag === "FlatMap") {
        conts.push(op.f);
        current = op.source;
        continue;
      }
      const value = await this.step(op, conn);
      const k = conts.pop();
      if (!k) return value as A;
      current = k(value);
    }
  }

  /** Execute one non-FlatMap operation. */
  private async step(op: ConnectionOp<unknown>, conn: DbConnection): Promise<unknown> {
    switch (op._tag) {
      case "Pure":
        return op.value;

      case "Delay":
        return op.thunk();

      case "Query": {
        const { sql, params } = renderStatement(op.query, this.dialect);
        const rows = await conn.query(sql, params);
        if (rows.length === 0) return null;
        return op.read.read(rows[0]);
      }

      case "QueryMany": {
        const { sql, params } = renderStatement(op.query, this.dialect);
        const rows = await conn.query(sql, params);
        return rows.map((row) => op.read.read(row)).filter((r) => r !== null);
      }

      case "Execute": {
        const { sql, params } = renderStatement(op.update, this.dialect);
        return await conn.execute(sql, params);
      }

      case "ExecuteWithKeys": {
        const { sql, params } = renderStatement(op.update, this.dialect);
        // Append RETURNING clause if not present (case-insensitive check).
        const returningClause = op.columns
          .map((c) => assertSafeIdentifier(c, "RETURNING column"))
          .join(", ");
        const fullSql = /\bRETURNING\b/i.test(sql) ? sql : `${sql} RETURNING ${returningClause}`;
        return await conn.query(fullSql, params);
      }

      case "Raw":
        return await conn.query(op.sql, op.params);

      case "Attempt": {
        try {
          const result = await this.interpret(op.cio, conn);
          return Right(result);
        } catch (error) {
          return Left(error instanceof Error ? error : new Error(String(error)));
        }
      }

      case "HandleError": {
        try {
          return await this.interpret(op.cio, conn);
        } catch (error) {
          const e = error instanceof Error ? error : new Error(String(error));
          return await this.interpret(op.handler(e), conn);
        }
      }

      case "ExecuteQueryable":
        return await op.queryable.execute(op.query, conn);

      case "Transact": {
        await conn.begin();
        try {
          const result = await this.interpret(op.cio, conn);
          await conn.commit();
          return result;
        } catch (error) {
          await conn.rollback();
          throw error;
        }
      }

      case "FlatMap":
        // Handled by interpret()'s loop; unreachable here.
        return this.interpret(op as unknown as ConnectionIO<unknown>, conn);
    }
  }

  /**
   * Create a Transactor from a connection pool.
   */
  static fromPool(
    pool: {
      connect(): Promise<DbConnection>;
      release(conn: DbConnection): Promise<void>;
    },
    options: TransactorOptions = {}
  ): Transactor {
    return new Transactor(
      () => pool.connect(),
      (conn) => pool.release(conn),
      options
    );
  }

  /**
   * Create a Transactor from a single connection (for testing).
   */
  static fromConnection(conn: DbConnection, options: TransactorOptions = {}): Transactor {
    return new Transactor(
      async () => conn,
      async () => {},
      options
    );
  }
}

// ============================================================================
// ConnectionIO Combinators
// ============================================================================

/**
 * Sequence multiple ConnectionIO operations, collecting results.
 */
export function sequence<A>(cios: readonly ConnectionIO<A>[]): ConnectionIO<A[]> {
  // Right-nested chain that pushes into one accumulator: O(n), and stack-safe
  // because the Transactor interprets FlatMap with an explicit loop.
  // The accumulator is created per run (inside the outer flatMap), so running
  // the same program twice — or concurrently — never shares state.
  const go = (i: number, acc: A[]): ConnectionIO<A[]> =>
    i >= cios.length
      ? ConnectionIO.pure(acc)
      : cios[i].flatMap((a) => {
          acc.push(a);
          return go(i + 1, acc);
        });
  return ConnectionIO.unit.flatMap(() => go(0, []));
}

/**
 * Traverse a list with a ConnectionIO-producing function.
 */
export function traverse<A, B>(as: readonly A[], f: (a: A) => ConnectionIO<B>): ConnectionIO<B[]> {
  return sequence(as.map(f));
}

/**
 * Run two ConnectionIO operations in parallel.
 */
export function parZip<A, B>(cioA: ConnectionIO<A>, cioB: ConnectionIO<B>): ConnectionIO<[A, B]> {
  // Note: True parallelism requires the interpreter to support it
  // This is a sequential fallback
  return cioA.zip(cioB);
}

/**
 * Run multiple ConnectionIO operations in parallel.
 */
export function parSequence<A>(cios: readonly ConnectionIO<A>[]): ConnectionIO<A[]> {
  return sequence(cios);
}

/**
 * Conditionally execute a ConnectionIO.
 */
export function when(condition: boolean, cio: ConnectionIO<void>): ConnectionIO<void> {
  return condition ? cio : ConnectionIO.unit;
}

/**
 * Conditionally execute with a result.
 */
export function whenA<A>(condition: boolean, cio: ConnectionIO<A>): ConnectionIO<A | null> {
  return condition ? cio : ConnectionIO.pure(null);
}

/**
 * Loop with an accumulator.
 */
export function unfold<A, B>(
  initial: A,
  f: (a: A) => ConnectionIO<[A, B] | null>
): ConnectionIO<B[]> {
  const go = (acc: A, results: B[]): ConnectionIO<B[]> =>
    f(acc).flatMap((next) => {
      if (next === null) return ConnectionIO.pure(results);
      results.push(next[1]);
      return go(next[0], results);
    });
  return ConnectionIO.unit.flatMap(() => go(initial, []));
}
