/**
 * @typesugar/drizzle-adapter Showcase
 *
 * Self-documenting examples of the Drizzle ORM adapter for typesugar:
 * dsql tagged template macro, ref$, id$, join$, raw$ helper macros,
 * DrizzleQueryable for ConnectionIO integration, and registration.
 *
 * This showcase tests runtime behavior (macro definitions, error messages,
 * registration). Type-level assertions are not used because the Drizzle
 * adapter primarily provides string-based SQL templates rather than
 * type-transforming operations.
 *
 * Run:   typesugar run examples/showcase.ts
 * Build: npx tspc && node dist/examples/showcase.js
 */

import { assert } from "@typesugar/testing";
// Note: typeAssert, Equal, Extends, Not are available from @typesugar/testing
// for type-level assertions but not needed in this showcase since the Drizzle
// adapter primarily deals with runtime macro behavior and string-based SQL.

import {
  // Macros (compile-time transforms, runtime placeholders)
  dsqlMacro,
  refMacro,
  idMacro,
  joinMacro,
  rawMacro,

  // Runtime placeholders (throw without transformer)
  dsql,
  ref$,
  id$,
  join$,
  raw$,

  // Registration
  register,

  // ConnectionIO integration
  DrizzleQueryable,
} from "../src/index.js";

// ============================================================================
// 1. MACRO DEFINITIONS — Compile-Time SQL Transforms
// ============================================================================

// The Drizzle adapter provides macros that transform SQL templates at compile time.
// dsql`` compiles to drizzle-orm's sql`` tagged template.

assert(dsqlMacro.name === "dsql", "dsql macro should be named 'dsql'");
assert(typeof dsqlMacro.expand === "function", "dsql macro should have expand function");
assert(typeof dsqlMacro.validate === "function", "dsql macro should have validate function");

assert(refMacro.name === "ref$", "ref$ macro should be named 'ref$'");
assert(typeof refMacro.expand === "function");

assert(idMacro.name === "id$", "id$ macro should be named 'id$'");
assert(typeof idMacro.expand === "function");

assert(joinMacro.name === "join$", "join$ macro should be named 'join$'");
assert(typeof joinMacro.expand === "function");

assert(rawMacro.name === "raw$", "raw$ macro should be named 'raw$'");
assert(typeof rawMacro.expand === "function");

// ============================================================================
// 2. RUNTIME PLACEHOLDERS — Error Without Transformer
// ============================================================================

// Runtime placeholders throw descriptive errors when the macro transformer
// hasn't been applied. Users get clear guidance on what to do.

let dsqlError = "";
try {
  dsql`SELECT 1`;
} catch (e) {
  dsqlError = (e as Error).message;
}
assert(dsqlError.includes("not transformed at compile time"), "dsql should throw without transformer");
assert(dsqlError.includes("@typesugar/drizzle-adapter"), "Error should mention the adapter");

let refError = "";
try {
  ref$("users.name");
} catch (e) {
  refError = (e as Error).message;
}
assert(refError.includes("ref$"), "ref$ error should mention the macro name");

let idError = "";
try {
  id$("column_name");
} catch (e) {
  idError = (e as Error).message;
}
assert(idError.includes("id$"), "id$ error should mention the macro name");

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

// register() registers all Drizzle macros with the global registry.
// Called automatically on import, but safe to call again (idempotent).

assert(typeof register === "function", "register function should be exported");
register();

// ============================================================================
// 4. DRIZZLE QUERYABLE — ConnectionIO Integration
// ============================================================================

// DrizzleQueryable bridges Drizzle queries into @typesugar/sql's ConnectionIO.
// It works with any object that has a `.toSQL()` method returning { sql, params }.

assert(DrizzleQueryable !== undefined, "DrizzleQueryable should be exported");
assert(typeof DrizzleQueryable.execute === "function", "DrizzleQueryable should have execute");

// Usage pattern:
// const query = db.select().from(users).where(eq(users.id, 123));
// const program = ConnectionIO.fromQueryable(query, DrizzleQueryable);
// const result = await transactor.run(program);

// ============================================================================
// 5. COMPILE-TIME BEHAVIOR — What the Macros Do
// ============================================================================

// At compile time with the transformer enabled:
//
// dsql`SELECT * FROM users WHERE id = ${userId}`
// → drizzle_orm.sql`SELECT * FROM users WHERE id = ${userId}`
//   (imports sql from "drizzle-orm")
//
// ref$("users.name")
// → drizzle_orm.sql.identifier("users.name")
//
// id$("column_name")
// → drizzle_orm.sql.identifier("column_name")
//
// join$(columns, dsql`, `)
// → drizzle_orm.sql.join(columns, drizzle_orm.sql`, `)
//
// raw$("NOW()")
// → drizzle_orm.sql.raw("NOW()")
//   (warns strongly if value is dynamic — SQL injection risk)

// ============================================================================
// 6. DRIZZLE vs KYSELY — Adapter Comparison
// ============================================================================

// Both adapters follow the same macro naming convention:
//
// | Macro  | Kysely                   | Drizzle                        |
// |--------|--------------------------|--------------------------------|
// | sql    | ksql`` → sql``           | dsql`` → drizzle_orm.sql``     |
// | ref$   | → sql.ref(...)           | → sql.identifier(...)          |
// | id$    | → sql.id(...)            | → sql.identifier(...)          |
// | join$  | → sql.join(...)          | → sql.join(...)                |
// | raw$   | → sql.raw(...)           | → sql.raw(...)                 |
// | table$ | → sql.table(...)         | (not available)                |
// | lit$   | → sql.lit(...)           | (not available)                |
//
// Drizzle uses `sql.identifier()` for both ref$ and id$ since Drizzle's
// API doesn't distinguish between column references and identifiers.

// ============================================================================
// 7. REAL-WORLD PATTERN — Drizzle + typesugar Integration
// ============================================================================

// In a real application with Drizzle and the macro transformer:
//
// import { drizzle } from "drizzle-orm/postgres-js";
// import { pgTable, serial, varchar, integer, timestamp } from "drizzle-orm/pg-core";
// import { dsql, ref$, DrizzleQueryable } from "@typesugar/drizzle-adapter";
// import { ConnectionIO, Transactor } from "@typesugar/sql";
//
// // Define schema with Drizzle
// const users = pgTable("users", {
//   id: serial("id").primaryKey(),
//   name: varchar("name", { length: 255 }),
//   email: varchar("email", { length: 255 }),
//   age: integer("age"),
//   createdAt: timestamp("created_at").defaultNow(),
// });
//
// const db = drizzle(client);
//
// // Type-safe SQL with compile-time validation
// const findOlderThan = (minAge: number) =>
//   dsql`
//     SELECT ${ref$("users.id")}, ${ref$("users.name")}
//     FROM users
//     WHERE ${ref$("users.age")} > ${minAge}
//     ORDER BY ${ref$("users.age")} DESC
//   `;
//
// // Or use Drizzle's query builder and lift to ConnectionIO
// const findUserQuery = db.select().from(users).where(eq(users.age, 30));
// const program = ConnectionIO.fromQueryable(findUserQuery, DrizzleQueryable);
// const result = await transactor.run(program);

console.log("@typesugar/drizzle-adapter showcase: all assertions passed!");
