import { DbConnection } from "./connection-io.js";

/**
 * Queryable<Q> — Typeclass for executing native ORM queries (e.g. Kysely, Drizzle)
 * inside a ConnectionIO program.
 *
 * By defining instances of Queryable for different ORMs, you can lift their
 * specific builder objects directly into the Doobie-style ConnectionIO monad.
 */
export interface Queryable<Q> {
  readonly _tag: "Queryable";

  /** Execute the query and return the result */
  readonly execute: (query: Q, conn: DbConnection) => Promise<unknown>;
}

export namespace Queryable {
  export function make<Q>(
    execute: (query: Q, conn: DbConnection) => Promise<unknown>
  ): Queryable<Q> {
    return { _tag: "Queryable", execute };
  }
}
