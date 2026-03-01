# SQL DSL

Type-safe SQL tagged templates with compile-time validation. Doobie-like composable queries with ConnectionIO for pure database operations.

## Quick Start

```bash
npm install @typesugar/sql
```

```typescript
import { sql, Query, ConnectionIO, Transactor } from "@typesugar/sql";

const name = "Alice";
const age = 30;

const query = sql`SELECT * FROM users WHERE name = ${name} AND age > ${age}`;

console.log(query.text); // "SELECT * FROM users WHERE name = $1 AND age > $2"
console.log(query.params); // ["Alice", 30]
```

## Features

### Composable Fragments

```typescript
const whereClause = sql`WHERE active = ${true}`;
const orderBy = sql`ORDER BY created_at DESC`;

const query = sql`
  SELECT * FROM users
  ${whereClause}
  ${orderBy}
  LIMIT ${10}
`;
// Fragments inlined, parameters correctly numbered
```

### Typed Queries

```typescript
interface User {
  id: number;
  name: string;
  email: string;
}

const getUserById = (id: number): Query<User> =>
  sql`SELECT id, name, email FROM users WHERE id = ${id}`.toQuery<User>();
```

### ConnectionIO — Pure Database Operations

```typescript
const getUser = (id: number): ConnectionIO<User | null> =>
  ConnectionIO.query(sql`SELECT * FROM users WHERE id = ${id}`.toQuery<User>()).map(
    (rows) => rows[0] ?? null
  );

// Compose operations
const program = ConnectionIO.flatMap(createUser("Alice", "alice@example.com"), (id) => getUser(id));

// Execute with a transactor
const transactor = new Transactor(dbConnection);
const result = await transactor.run(program);
```

### Compile-Time Validation

```typescript
// Compile-time error: unbalanced parentheses
const bad = sql`SELECT * FROM users WHERE (id = ${1}`;
```

## Using with Query Builders

`@typesugar/sql` works well alongside popular query builders like Kysely and Drizzle ORM. The `sql` tagged template produces a `{ text, params }` object that can be used with their raw SQL APIs.

### With Kysely

```typescript
import { sql as kyselySql, Kysely } from "kysely";
import { sql } from "@typesugar/sql";

// Build a fragment with typesugar/sql
const userId = 42;
const fragment = sql`id = ${userId}`;

// Use with Kysely's sql helper
const result = await db
  .selectFrom("users")
  .where(kyselySql.raw(fragment.text, fragment.params))
  .execute();
```

### With Drizzle ORM

```typescript
import { sql as drizzleSql } from "drizzle-orm";
import { sql } from "@typesugar/sql";

// Build a fragment with typesugar/sql
const minAge = 18;
const fragment = sql`age >= ${minAge}`;

// Use with Drizzle's sql helper
const result = await db
  .select()
  .from(users)
  .where(drizzleSql.raw(fragment.text, ...fragment.params));
```

Both integrations use the native raw SQL capabilities of each library, giving you type safety from typesugar/sql's compile-time validation while preserving compatibility with your existing query builder.

## Learn More

- [API Reference](/reference/packages#sql)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/sql)
