# Drizzle Adapter

Type-safe SQL templates that compile to Drizzle ORM's `sql` template. Get compile-time SQL validation while using Drizzle's query builder ecosystem.

## Quick Start

```bash
npm install @typesugar/drizzle-adapter drizzle-orm
```

```typescript
import { dsql, ref$, join$ } from "@typesugar/drizzle-adapter";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const client = postgres("postgres://...");
const db = drizzle(client);

const userId = 123;
const query = dsql`SELECT id, name FROM users WHERE id = ${userId}`;

const result = await db.execute(query);
```

## Macros

### dsql — Type-Safe SQL Templates

```typescript
const query = dsql`SELECT id, name FROM users WHERE id = ${userId}`;
// Compiles to Drizzle's sql tagged template
```

### ref$ — Column/Table References

```typescript
const column = ref$("users.name");
// Compiles to: sql.identifier("users.name")
```

### join$ — Join SQL Fragments

```typescript
const columns = [dsql`id`, dsql`name`, dsql`email`];
const cols = join$(columns, dsql`, `);
// Compiles to: sql.join(columns, sql`, `)
```

### raw$ — Raw SQL (Use with Caution)

```typescript
const now = raw$("NOW()");
// Compiles to: sql.raw("NOW()")
// Warning: Dynamic values are dangerous!
```

## ConnectionIO Integration

Use Drizzle queries with Doobie-inspired `ConnectionIO`:

```typescript
import { ConnectionIO } from "@typesugar/sql";
import { DrizzleQueryable } from "@typesugar/drizzle-adapter";

const query = db.select().from(users).where(eq(users.id, 1));
const program = ConnectionIO.fromQueryable(query, DrizzleQueryable);
```

## Compile-Time Validation

```typescript
// Unbalanced parentheses — compile error
const bad = dsql`SELECT * FROM users WHERE (id = ${1}`;

// Dangerous patterns — compile warning
const suspicious = dsql`SELECT * FROM users; DROP TABLE users`;
```

## Learn More

- [SQL Guide](/guides/sql)
- [API Reference](/reference/packages#drizzle)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/drizzle)
