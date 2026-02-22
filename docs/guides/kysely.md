# Kysely Adapter

Type-safe SQL templates that compile to Kysely's RawBuilder. Get compile-time SQL validation while using Kysely's query builder ecosystem.

## Quick Start

```bash
npm install @typesugar/kysely-adapter kysely
```

```typescript
import { ksql, ref$, table$ } from "@typesugar/kysely-adapter";
import { Kysely } from "kysely";

interface Database {
  users: { id: number; name: string; email: string };
}

const db = new Kysely<Database>({
  /* config */
});

const userId = 123;
const query = ksql<{ id: number; name: string }>`
  SELECT id, name FROM users WHERE id = ${userId}
`;

const result = await query.execute(db);
```

## Macros

### ksql — Type-Safe SQL Templates

```typescript
const query = ksql<{ id: number; name: string }>`
  SELECT id, name FROM users WHERE id = ${userId}
`;
// Compiles to Kysely's sql tagged template
```

### ref$ — Column References

```typescript
const column = ref$("users.name");
// Compiles to: sql.ref("users.name")
```

### table$ — Table References

```typescript
const tbl = table$("users");
// Compiles to: sql.table("users")
```

### join$ — Join SQL Fragments

```typescript
const columns = [ksql`id`, ksql`name`, ksql`email`];
const cols = join$(columns, ksql`, `);
// Compiles to: sql.join(columns, sql`, `)
```

## With Kysely Query Builder

```typescript
// Use in subqueries
const activeUsers = db
  .selectFrom("users")
  .where(ksql`active = true AND created_at > NOW() - INTERVAL '30 days'`)
  .selectAll();

// Use with raw expressions
const result = await db
  .selectFrom("orders")
  .select(["id", ksql<number>`EXTRACT(YEAR FROM created_at)`.as("year")])
  .execute();
```

## Compile-Time Validation

```typescript
// Unbalanced parentheses — compile error
const bad = ksql`SELECT * FROM users WHERE (id = ${1}`;

// Dangerous patterns — compile warning
const suspicious = ksql`SELECT * FROM users; DROP TABLE users`;
```

## Learn More

- [SQL Guide](/guides/sql)
- [API Reference](/reference/packages#kysely)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/kysely)
