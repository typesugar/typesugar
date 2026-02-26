/**
 * @typesugar/kysely-adapter Showcase
 *
 * Self-documenting examples of the Kysely adapter for typesugar:
 * ksql tagged template macro, ref$, table$, id$, lit$, join$, raw$
 * helper macros, KyselyQueryable for ConnectionIO integration,
 * and type helpers.
 *
 * Type assertions used:
 *   typeAssert<Equal<A, B>>()       - A and B are the same type
 *   typeAssert<Not<Equal<A, B>>>()  - A and B are DIFFERENT
 *
 * Run:   typesugar run examples/showcase.ts
 * Build: npx tspc && node dist/examples/showcase.js
 */

import { assert, typeAssert, type Equal, type Not } from "@typesugar/testing";

import {
  // Macros (compile-time transforms, runtime placeholders)
  ksqlMacro,
  refMacro,
  tableMacro,
  idMacro,
  litMacro,
  joinMacro,
  rawMacro,

  // Runtime placeholders (throw without transformer)
  ksql,
  ref$,
  table$,
  id$,
  lit$,
  join$,
  raw$,

  // Registration
  register,

  // ConnectionIO integration
  KyselyQueryable,

  // Type helpers
  type SqlResult,
  type Column,
  type Generated,
  type Nullable,
} from "../src/index.js";

// ============================================================================
// 1. MACRO DEFINITIONS — Compile-Time SQL Transforms
// ============================================================================

// The Kysely adapter provides macros that transform at compile time.
// Each macro has a name and expand function registered with the global registry.

assert(ksqlMacro.name === "ksql", "ksql macro should be named 'ksql'");
assert(typeof ksqlMacro.expand === "function", "ksql macro should have expand function");
assert(typeof ksqlMacro.validate === "function", "ksql macro should have validate function");

assert(refMacro.name === "ref$", "ref$ macro should be named 'ref$'");
assert(typeof refMacro.expand === "function");

assert(tableMacro.name === "table$", "table$ macro should be named 'table$'");
assert(typeof tableMacro.expand === "function");

assert(idMacro.name === "id$", "id$ macro should be named 'id$'");
assert(typeof idMacro.expand === "function");

assert(litMacro.name === "lit$", "lit$ macro should be named 'lit$'");
assert(typeof litMacro.expand === "function");

assert(joinMacro.name === "join$", "join$ macro should be named 'join$'");
assert(typeof joinMacro.expand === "function");

assert(rawMacro.name === "raw$", "raw$ macro should be named 'raw$'");
assert(typeof rawMacro.expand === "function");

// ============================================================================
// 2. RUNTIME PLACEHOLDERS — Error Without Transformer
// ============================================================================

// The runtime placeholder functions throw helpful errors when the macro
// transformer hasn't been applied. This ensures users get actionable messages.

let ksqlError = "";
try {
  ksql`SELECT 1`;
} catch (e) {
  ksqlError = (e as Error).message;
}
assert(ksqlError.includes("not transformed at compile time"), "ksql should throw without transformer");
assert(ksqlError.includes("@typesugar/kysely-adapter"), "Error should mention the adapter");

let refError = "";
try {
  ref$("users.name");
} catch (e) {
  refError = (e as Error).message;
}
assert(refError.includes("ref$"), "ref$ error should mention the macro name");

let tableError = "";
try {
  table$("users");
} catch (e) {
  tableError = (e as Error).message;
}
assert(tableError.includes("table$"), "table$ error should mention the macro name");

let idError = "";
try {
  id$("column_name");
} catch (e) {
  idError = (e as Error).message;
}
assert(idError.includes("id$"), "id$ error should mention the macro name");

let litError = "";
try {
  lit$("DESC");
} catch (e) {
  litError = (e as Error).message;
}
assert(litError.includes("lit$"), "lit$ error should mention the macro name");

let joinError = "";
try {
  join$(["a", "b"]);
} catch (e) {
  joinError = (e as Error).message;
}
assert(joinError.includes("join$"), "join$ error should mention the macro name");

let rawError = "";
try {
  raw$("NOW()");
} catch (e) {
  rawError = (e as Error).message;
}
assert(rawError.includes("raw$"), "raw$ error should mention the macro name");

// ============================================================================
// 3. REGISTRATION — Auto-Register All Macros
// ============================================================================

// register() registers all macros with the global registry.
// It's called automatically on import, but is idempotent.

assert(typeof register === "function", "register function should be exported");
register();

// ============================================================================
// 4. KYSELY QUERYABLE — ConnectionIO Integration
// ============================================================================

// KyselyQueryable bridges Kysely queries into @typesugar/sql's ConnectionIO.
// It implements the Queryable typeclass for any Kysely Compilable.

assert(KyselyQueryable !== undefined, "KyselyQueryable should be exported");
assert(typeof KyselyQueryable.execute === "function", "KyselyQueryable should have execute");

// Usage pattern:
// const query = db.selectFrom("users").selectAll();
// const program = ConnectionIO.fromQueryable(query, KyselyQueryable);
// const result = await transactor.run(program);

// ============================================================================
// 5. TYPE HELPERS — Database Schema Types
// ============================================================================

// Column<T> is a pass-through type marker for documentation
typeAssert<Equal<Column<string>, string>>();
typeAssert<Equal<Column<number>, number>>();

// Generated<T> marks auto-generated columns (auto-increment, etc.)
typeAssert<Equal<Generated<number>, number>>();

// Nullable<T> adds null to the type
typeAssert<Equal<Nullable<string>, string | null>>();
typeAssert<Not<Equal<Nullable<string>, string>>>();

// SqlResult<T> extracts the result type from a query
type MockQuery = { execute: (db: unknown) => Promise<{ rows: User[] }> };
interface User {
  id: number;
  name: string;
}
typeAssert<Equal<SqlResult<MockQuery>, { rows: User[] }>>();

// ============================================================================
// 6. COMPILE-TIME BEHAVIOR — What the Macros Do
// ============================================================================

// At compile time with the transformer enabled:
//
// ksql`SELECT * FROM users WHERE id = ${userId}`
// → sql`SELECT * FROM users WHERE id = ${userId}`
//   (imports sql from "kysely")
//
// ref$("users.name")
// → sql.ref("users.name")
//
// table$("users")
// → sql.table("users")
//
// id$("column_name")
// → sql.id("column_name")
//
// lit$("DESC")
// → sql.lit("DESC")
//   (warns if value is dynamic — SQL injection risk)
//
// join$(columns, sql`, `)
// → sql.join(columns, sql`, `)
//
// raw$("NOW()")
// → sql.raw("NOW()")
//   (warns strongly if value is dynamic — high injection risk)

// ============================================================================
// 7. REAL-WORLD PATTERN — Kysely + typesugar Integration
// ============================================================================

// In a real application with Kysely and the macro transformer:
//
// import { Kysely, Generated } from "kysely";
// import { ksql, ref$, KyselyQueryable } from "@typesugar/kysely-adapter";
// import { ConnectionIO, Transactor } from "@typesugar/sql";
//
// interface Database {
//   users: {
//     id: Generated<number>;
//     name: string;
//     email: string;
//     created_at: Generated<Date>;
//   };
//   posts: {
//     id: Generated<number>;
//     user_id: number;
//     title: string;
//     body: string;
//   };
// }
//
// const db = new Kysely<Database>({ ... });
//
// // Type-safe SQL with compile-time validation
// const findUser = (id: number) =>
//   ksql<{ id: number; name: string; email: string }>`
//     SELECT ${ref$("users.id")}, ${ref$("users.name")}, ${ref$("users.email")}
//     FROM ${table$("users")}
//     WHERE ${ref$("users.id")} = ${id}
//   `;
//
// // Or use Kysely's query builder and lift to ConnectionIO
// const findUserQuery = db
//   .selectFrom("users")
//   .select(["id", "name", "email"])
//   .where("id", "=", 123);
//
// const program = ConnectionIO.fromQueryable(findUserQuery, KyselyQueryable);
// const result = await transactor.run(program);

console.log("@typesugar/kysely-adapter showcase: all assertions passed!");
