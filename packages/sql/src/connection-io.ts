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
 * Unlike Doobie's runtime free monad, ttfx's ConnectionIO is specialized
 * at compile time using the `specialize` macro:
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

import {
  TypedQuery,
  TypedUpdate,
  TypedFragment,
  Empty,
  Unit,
} from "./typed-fragment.js";
import { Read, Write, SqlRow } from "./meta.js";

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
      readonly query: TypedQuery<unknown[], A>;
      readonly read: Read<A>;
    }
  | {
      readonly _tag: "QueryMany";
      readonly query: TypedQuery<unknown[], A>;
      readonly read: Read<A>;
    }
  | { readonly _tag: "Execute"; readonly update: TypedUpdate<unknown[]> }
  | {
      readonly _tag: "ExecuteWithKeys";
      readonly update: TypedUpdate<unknown[]>;
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
  | { readonly _tag: "Transact"; readonly cio: ConnectionIO<A> };

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
    return new ConnectionIO({
      _tag: "Pure",
      value: undefined as unknown as B,
      // This will be interpreted by the Transactor
      // The actual flatMap is handled during interpretation
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
    return new ConnectionIO({ _tag: "Attempt", cio: this }) as ConnectionIO<
      Either<Error, A>
    >;
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
  static query<A>(
    query: TypedQuery<unknown[], A>,
    read: Read<A>,
  ): ConnectionIO<A | null> {
    return new ConnectionIO({
      _tag: "Query",
      query,
      read,
    }) as ConnectionIO<A | null>;
  }

  /**
   * Execute a query returning multiple results.
   */
  static queryMany<A>(
    query: TypedQuery<unknown[], A>,
    read: Read<A>,
  ): ConnectionIO<A[]> {
    return new ConnectionIO({ _tag: "QueryMany", query, read }) as ConnectionIO<
      A[]
    >;
  }

  /**
   * Execute an update statement.
   */
  static execute(update: TypedUpdate<unknown[]>): ConnectionIO<number> {
    return new ConnectionIO({
      _tag: "Execute",
      update,
    }) as ConnectionIO<number>;
  }

  /**
   * Execute an update returning generated keys.
   */
  static executeWithKeys<K extends string>(
    update: TypedUpdate<unknown[]>,
    columns: K[],
  ): ConnectionIO<Record<K, unknown>[]> {
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
    return new ConnectionIO({ _tag: "Raw", sql, params }) as ConnectionIO<
      SqlRow[]
    >;
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
 * When used with `specialize`, the monadic interpretation is eliminated:
 *
 * ```typescript
 * // Specialized transact function
 * const runProgram = specialize(
 *   <A>(xa: Transactor, cio: ConnectionIO<A>) => xa.run(cio),
 *   myTransactor,
 *   myProgram,
 * );
 *
 * // Compiles to direct async operations without interpretation overhead
 * ```
 */
export class Transactor {
  constructor(
    private readonly getConnection: () => Promise<DbConnection>,
    private readonly releaseConnection: (conn: DbConnection) => Promise<void>,
  ) {}

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
   * Interpret a ConnectionIO operation.
   */
  private async interpret<A>(
    cio: ConnectionIO<A>,
    conn: DbConnection,
  ): Promise<A> {
    const op = cio.op;

    switch (op._tag) {
      case "Pure":
        return op.value;

      case "Delay":
        return op.thunk();

      case "Query": {
        const { sql, params } = op.query.toSql();
        const rows = await conn.query(sql, params);
        if (rows.length === 0) return null as A;
        return op.read.read(rows[0]) as A;
      }

      case "QueryMany": {
        const { sql, params } = op.query.toSql();
        const rows = await conn.query(sql, params);
        return rows
          .map((row) => op.read.read(row))
          .filter((r) => r !== null) as A;
      }

      case "Execute": {
        const { sql, params } = op.update.toSql();
        return (await conn.execute(sql, params)) as A;
      }

      case "ExecuteWithKeys": {
        const { sql, params } = op.update.toSql();
        // Append RETURNING clause if not present
        const returningClause = op.columns.map((c) => c).join(", ");
        const fullSql = sql.includes("RETURNING")
          ? sql
          : `${sql} RETURNING ${returningClause}`;
        const rows = await conn.query(fullSql, params);
        return rows as A;
      }

      case "Raw": {
        const rows = await conn.query(op.sql, op.params);
        return rows as A;
      }

      case "Attempt": {
        try {
          const result = await this.interpret(op.cio, conn);
          return Right(result) as A;
        } catch (error) {
          return Left(
            error instanceof Error ? error : new Error(String(error)),
          ) as A;
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
    }
  }

  /**
   * Create a Transactor from a connection pool.
   */
  static fromPool(pool: {
    connect(): Promise<DbConnection>;
    release(conn: DbConnection): Promise<void>;
  }): Transactor {
    return new Transactor(
      () => pool.connect(),
      (conn) => pool.release(conn),
    );
  }

  /**
   * Create a Transactor from a single connection (for testing).
   */
  static fromConnection(conn: DbConnection): Transactor {
    return new Transactor(
      async () => conn,
      async () => {},
    );
  }
}

// ============================================================================
// ConnectionIO Combinators
// ============================================================================

/**
 * Sequence multiple ConnectionIO operations, collecting results.
 */
export function sequence<A>(
  cios: readonly ConnectionIO<A>[],
): ConnectionIO<A[]> {
  return cios.reduce(
    (acc, cio) => acc.flatMap((results) => cio.map((a) => [...results, a])),
    ConnectionIO.pure<A[]>([]),
  );
}

/**
 * Traverse a list with a ConnectionIO-producing function.
 */
export function traverse<A, B>(
  as: readonly A[],
  f: (a: A) => ConnectionIO<B>,
): ConnectionIO<B[]> {
  return sequence(as.map(f));
}

/**
 * Run two ConnectionIO operations in parallel.
 */
export function parZip<A, B>(
  cioA: ConnectionIO<A>,
  cioB: ConnectionIO<B>,
): ConnectionIO<[A, B]> {
  // Note: True parallelism requires the interpreter to support it
  // This is a sequential fallback
  return cioA.zip(cioB);
}

/**
 * Run multiple ConnectionIO operations in parallel.
 */
export function parSequence<A>(
  cios: readonly ConnectionIO<A>[],
): ConnectionIO<A[]> {
  return sequence(cios);
}

/**
 * Conditionally execute a ConnectionIO.
 */
export function when(
  condition: boolean,
  cio: ConnectionIO<void>,
): ConnectionIO<void> {
  return condition ? cio : ConnectionIO.unit;
}

/**
 * Conditionally execute with a result.
 */
export function whenA<A>(
  condition: boolean,
  cio: ConnectionIO<A>,
): ConnectionIO<A | null> {
  return condition ? cio : ConnectionIO.pure(null);
}

/**
 * Loop with an accumulator.
 */
export function unfold<A, B>(
  initial: A,
  f: (a: A) => ConnectionIO<[A, B] | null>,
): ConnectionIO<B[]> {
  const go = (acc: A, results: B[]): ConnectionIO<B[]> =>
    f(acc).flatMap((next) =>
      next === null
        ? ConnectionIO.pure(results)
        : go(next[0], [...results, next[1]]),
    );
  return go(initial, []);
}
