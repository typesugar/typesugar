/**
 * Kysely Adapter Example
 *
 * Demonstrates type-safe SQL templates that compile to Kysely's RawBuilder.
 * Get compile-time SQL validation while using Kysely's ecosystem.
 */

import { Kysely, sql } from "kysely";
import {
  ksql,
  ref$,
  table$,
  id$,
  lit$,
  join$,
  raw$,
} from "@ttfx/kysely";

console.log("=== Kysely Adapter Example ===\n");

// --- Database Schema ---

interface Database {
  users: {
    id: number;
    name: string;
    email: string;
    created_at: Date;
  };
  posts: {
    id: number;
    title: string;
    content: string;
    author_id: number;
    published: boolean;
  };
}

// --- ksql — Type-Safe SQL Templates ---

console.log("--- ksql ---");

const userId = 42;
const query = ksql<{ id: number; name: string }>`
  SELECT id, name FROM users WHERE id = ${userId}
`;

console.log("ksql query compiles to Kysely's sql tagged template");
console.log("With compile-time validation for:");
console.log("  - SQL syntax");
console.log("  - Balanced parentheses");
console.log("  - Dangerous patterns");

// --- ref$ — Column References ---

console.log("\n--- ref$ ---");

const nameRef = ref$("users.name");
console.log("ref$('users.name') -> sql.ref('users.name')");

// Use in queries:
// db.selectFrom("users").select([ref$("users.name")])

// --- table$ — Table References ---

console.log("\n--- table$ ---");

const usersTable = table$("users");
console.log("table$('users') -> sql.table('users')");

// --- id$ — SQL Identifiers ---

console.log("\n--- id$ ---");

const columnId = id$("created_at");
console.log("id$('created_at') -> sql.id('created_at')");

// --- lit$ — SQL Literals ---

console.log("\n--- lit$ ---");

const orderDir = lit$("DESC");
console.log("lit$('DESC') -> sql.lit('DESC')");
console.log("  Warning: Dynamic values may be vulnerable to SQL injection");

// --- join$ — Join SQL Fragments ---

console.log("\n--- join$ ---");

// Join multiple columns with a separator
const columns = [ksql`id`, ksql`name`, ksql`email`];
const columnList = join$(columns, ksql`, `);
console.log("join$([ksql`id`, ksql`name`, ksql`email`], ksql`, `)");
console.log("  -> sql.join([...], sql`, `)");

// --- Complex Query Example ---

console.log("\n--- Complex Query Example ---");

const searchTerm = "alice";
const minPosts = 5;

const complexQuery = ksql<{ id: number; name: string; post_count: number }>`
  SELECT 
    u.id,
    u.name,
    COUNT(p.id) as post_count
  FROM users u
  LEFT JOIN posts p ON p.author_id = u.id
  WHERE u.name ILIKE ${"%" + searchTerm + "%"}
  GROUP BY u.id, u.name
  HAVING COUNT(p.id) >= ${minPosts}
  ORDER BY post_count ${lit$("DESC")}
`;

console.log("Complex query with:");
console.log("  - Parameterized search term");
console.log("  - Joins");
console.log("  - Aggregation");
console.log("  - HAVING clause");
console.log("  - Dynamic ORDER BY direction");

// --- Dynamic Query Building ---

console.log("\n--- Dynamic Query Building ---");

interface Filters {
  name?: string;
  published?: boolean;
  limit?: number;
}

function buildPostQuery(filters: Filters) {
  let query = ksql`SELECT * FROM posts WHERE 1=1`;

  if (filters.name) {
    query = ksql`${query} AND title ILIKE ${"%" + filters.name + "%"}`;
  }

  if (filters.published !== undefined) {
    query = ksql`${query} AND published = ${filters.published}`;
  }

  if (filters.limit) {
    query = ksql`${query} LIMIT ${filters.limit}`;
  }

  return query;
}

console.log("Dynamic query building with conditional fragments");
console.log("  buildPostQuery({ name: 'hello', published: true, limit: 10 })");

// --- Integration with Kysely ---

console.log("\n--- Integration with Kysely ---");

console.log(`
// Use with Kysely query builder:

const db = new Kysely<Database>({ dialect: postgresDialect });

// In subqueries
const result = await db
  .selectFrom("users")
  .where(ksql\`active = true AND created_at > NOW() - INTERVAL '30 days'\`)
  .selectAll()
  .execute();

// With raw expressions
const withYear = await db
  .selectFrom("posts")
  .select([
    "id",
    ksql<number>\`EXTRACT(YEAR FROM created_at)\`.as("year"),
  ])
  .execute();
`);

// --- Compile-Time Validation ---

console.log("--- Compile-Time Validation ---");

console.log("The ksql macro validates at compile time:");
console.log("  ✓ SQL syntax");
console.log("  ✓ Balanced parentheses");
console.log("  ✓ Warns about dangerous patterns");
console.log("");
console.log("Example compile-time errors:");
console.log("  ksql`SELECT * FROM users WHERE (id = \${1}`");
console.log("  // Error: Unbalanced parentheses");
