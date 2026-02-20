/**
 * Drizzle Adapter Example
 *
 * Demonstrates type-safe SQL templates that compile to Drizzle's sql tagged template.
 * Get compile-time SQL validation while using Drizzle's ecosystem.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { ConnectionIO, Transactor, DbConnection, SqlRow } from "@typesugar/sql";
import {
  dsql,
  ref$,
  id$,
  join$,
  raw$,
  DrizzleQueryable,
} from "@typesugar/drizzle";
import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";

console.log("=== Drizzle Adapter Example ===\n");

// --- Database Schema ---

const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// --- dsql — Type-Safe SQL Templates ---

console.log("--- dsql ---");

const userId = 42;
const query = dsql`
  SELECT id, name FROM users WHERE id = ${userId}
`;

console.log("dsql query compiles to Drizzle's sql tagged template");
console.log("With compile-time validation for:");
console.log("  - SQL syntax");
console.log("  - Balanced parentheses");
console.log("  - Dangerous patterns");

// --- ref$ — Column References ---

console.log("\n--- ref$ ---");

const nameRef = ref$("users.name");
console.log("ref$('users.name') -> sql.identifier('users.name')");

// --- id$ — SQL Identifiers ---

console.log("\n--- id$ ---");

const columnId = id$("created_at");
console.log("id$('created_at') -> sql.identifier('created_at')");

// --- join$ — Join SQL Fragments ---

console.log("\n--- join$ ---");

// Join multiple columns with a separator
const columns = [dsql`id`, dsql`name`, dsql`email`];
const columnList = join$(columns, dsql`, `);
console.log("join$([dsql`id`, dsql`name`, dsql`email`], dsql`, `)");
console.log("  -> sql.join([...], sql`, `)");

// --- Doobie-Style ConnectionIO Integration ---

console.log("\n--- Doobie-Style Integration ---");

// We can take a native Drizzle ORM query builder:
const builder = drizzle(postgres("postgres://"))
  .select()
  .from(users)
  .where(eq(users.id, 1));

// And lift it directly into typesugar's ConnectionIO monad!
const program = ConnectionIO.fromQueryable(builder, DrizzleQueryable).map(
  (rows) => {
    const userRows = rows as any[];
    return userRows.length > 0 ? userRows[0] : null;
  },
);

console.log("Program lifted a native Drizzle query builder into ConnectionIO.");

// A mock DbConnection
const mockConnection: DbConnection = {
  query: async (sql: string, params: readonly unknown[]): Promise<SqlRow[]> => {
    console.log("Query executed via Transactor!");
    console.log("  SQL: ", sql);
    console.log("  Params: ", params);
    return [{ id: 1, name: "Alice", email: "alice@example.com" }];
  },
  execute: async (sql: string, params: readonly unknown[]): Promise<number> => {
    return 1;
  },
  begin: async () => {},
  commit: async () => {},
  rollback: async () => {},
};

const transactor = Transactor.fromConnection(mockConnection);

async function run() {
  const result = await transactor.run(program);
  console.log("Result from DrizzleQueryable via ConnectionIO: ", result);
}

run().catch(console.error);

// --- Compile-Time Validation ---

console.log("\n--- Compile-Time Validation ---");

console.log("The dsql macro validates at compile time:");
console.log("  ✓ SQL syntax");
console.log("  ✓ Balanced parentheses");
console.log("  ✓ Warns about dangerous patterns");
console.log("");
console.log("Example compile-time errors:");
console.log("  dsql`SELECT * FROM users WHERE (id = \\${1}`");
console.log("  // Error: Unbalanced parentheses");
