# @ttfx/adapter-kysely

> Kysely adapter for ttfx type-safe SQL macros.

## Overview

`@ttfx/adapter-kysely` integrates ttfx SQL macros with Kysely, providing type-safe SQL tagged templates that compile to Kysely's RawBuilder. Get compile-time SQL validation while using Kysely's powerful query builder ecosystem.

## Installation

```bash
npm install @ttfx/adapter-kysely
# or
pnpm add @ttfx/adapter-kysely
```

Requires Kysely as a peer dependency:

```bash
npm install kysely
```

## Usage

### ksql — Type-Safe SQL Templates

```typescript
import { ksql } from "@ttfx/adapter-kysely";
import { Kysely } from "kysely";

interface Database {
  users: {
    id: number;
    name: string;
    email: string;
  };
}

const db = new Kysely<Database>({
  /* config */
});

const userId = 123;
const query = ksql<{ id: number; name: string }>`
  SELECT id, name FROM users WHERE id = ${userId}
`;

// Compiles to Kysely's sql tagged template
const result = await query.execute(db);
```

### ref$ — Column References

```typescript
import { ref$ } from "@ttfx/adapter-kysely";

const column = ref$("users.name");
// Compiles to: sql.ref("users.name")
```

### table$ — Table References

```typescript
import { table$ } from "@ttfx/adapter-kysely";

const tbl = table$("users");
// Compiles to: sql.table("users")
```

### id$ — SQL Identifiers

```typescript
import { id$ } from "@ttfx/adapter-kysely";

const col = id$("column_name");
// Compiles to: sql.id("column_name")
```

### lit$ — SQL Literals

```typescript
import { lit$ } from "@ttfx/adapter-kysely";

const order = lit$("DESC");
// Compiles to: sql.lit("DESC")

// Warning: Dynamic values may be vulnerable to SQL injection
```

### join$ — Join SQL Fragments

```typescript
import { join$, ksql } from "@ttfx/adapter-kysely";

const columns = [ksql`id`, ksql`name`, ksql`email`];
const cols = join$(columns, ksql`, `);
// Compiles to: sql.join(columns, sql`, `)
```

### raw$ — Raw SQL (Use with Caution)

```typescript
import { raw$ } from "@ttfx/adapter-kysely";

const now = raw$("NOW()");
// Compiles to: sql.raw("NOW()")

// Strong warning: Dynamic values are HIGHLY DANGEROUS
```

## Compile-Time Validation

The `ksql` macro provides compile-time SQL validation:

```typescript
// Unbalanced parentheses — compile error
const bad = ksql`SELECT * FROM users WHERE (id = ${1}`;
// Error: SQL has unbalanced parentheses

// Dangerous patterns — compile warning
const suspicious = ksql`SELECT * FROM users; DROP TABLE users`;
// Warning: SQL contains potentially dangerous patterns
```

## With Kysely Query Builder

```typescript
import { ksql } from "@ttfx/adapter-kysely";

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

## API Reference

### Tagged Template Macros

- `ksql` — Type-safe SQL template (compiles to Kysely's `sql`)

### Expression Macros

- `ref$(reference)` — Column/table reference (`sql.ref`)
- `table$(name)` — Table reference (`sql.table`)
- `id$(identifier)` — SQL identifier (`sql.id`)
- `lit$(value)` — SQL literal (`sql.lit`)
- `join$(items, separator?)` — Join fragments (`sql.join`)
- `raw$(sql)` — Raw SQL (`sql.raw`)

### Type Helpers

```typescript
type SqlResult<T> = T extends { execute: (db: unknown) => Promise<infer R> }
  ? R
  : never;
type Column<T> = T;
type Generated<T> = T;
type Nullable<T> = T | null;
```

### Registration

- `register()` — Register macros (called automatically on import)

## Safety Features

| Macro  | Validation                                               |
| ------ | -------------------------------------------------------- |
| `ksql` | Syntax checking, parentheses balancing, pattern warnings |
| `lit$` | Warning for dynamic values                               |
| `raw$` | Strong warning for dynamic values                        |

## License

MIT
