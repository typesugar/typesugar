/**
 * Type-Safe SQL Example
 *
 * Demonstrates composable SQL fragments with compile-time validation.
 * Parameters are automatically numbered ($1, $2, ...) and properly escaped.
 */

import {
  sql,
  Fragment,
  Query,
  Update,
  ConnectionIO,
  Transactor,
} from "@ttfx/sql";

console.log("=== Type-Safe SQL Example ===\n");

// --- Basic Queries ---

const name = "Alice";
const age = 30;

const basicQuery = sql`SELECT * FROM users WHERE name = ${name} AND age > ${age}`;
console.log("Query text:", basicQuery.text);
console.log("Query params:", basicQuery.params);

// --- Composable Fragments ---

console.log("\n--- Composable Fragments ---");

const selectUsers = sql`SELECT * FROM users`;
const whereActive = sql`WHERE active = ${true}`;
const orderByCreated = sql`ORDER BY created_at DESC`;
const limitClause = sql`LIMIT ${10}`;

const fullQuery = sql`
  ${selectUsers}
  ${whereActive}
  ${orderByCreated}
  ${limitClause}
`;

console.log("Composed query:", fullQuery.text);
console.log("All params:", fullQuery.params);

// --- Dynamic WHERE Clauses ---

console.log("\n--- Dynamic WHERE ---");

interface Filters {
  name?: string;
  minAge?: number;
  isActive?: boolean;
}

function buildUserQuery(filters: Filters): Fragment {
  let query = sql`SELECT * FROM users WHERE 1=1`;

  if (filters.name) {
    query = sql`${query} AND name ILIKE ${`%${filters.name}%`}`;
  }
  if (filters.minAge !== undefined) {
    query = sql`${query} AND age >= ${filters.minAge}`;
  }
  if (filters.isActive !== undefined) {
    query = sql`${query} AND active = ${filters.isActive}`;
  }

  return query;
}

const filtered = buildUserQuery({ name: "alice", minAge: 18, isActive: true });
console.log("Filtered query:", filtered.text);
console.log("Filter params:", filtered.params);

// --- Typed Queries ---

console.log("\n--- Typed Queries ---");

interface User {
  id: number;
  name: string;
  email: string;
  age: number;
}

const typedQuery: Query<User> = sql`
  SELECT id, name, email, age
  FROM users
  WHERE id = ${42}
`.toQuery<User>();

console.log("Typed query:", typedQuery.text);

// --- Updates ---

console.log("\n--- Updates ---");

const updateUser: Update = sql`
  UPDATE users
  SET name = ${"Bob"}, email = ${"bob@example.com"}
  WHERE id = ${42}
`.toUpdate();

console.log("Update:", updateUser.text);
console.log("Update params:", updateUser.params);

// --- Insert ---

console.log("\n--- Insert ---");

const insertUser = sql`
  INSERT INTO users (name, email, age)
  VALUES (${name}, ${"alice@example.com"}, ${age})
  RETURNING id
`;

console.log("Insert:", insertUser.text);
console.log("Insert params:", insertUser.params);
