# @typesugar/drizzle

> Drizzle ORM adapter for typesugar type-safe SQL macros.

## Overview

`@typesugar/drizzle` integrates typesugar SQL macros with Drizzle ORM, providing type-safe SQL tagged templates that compile to Drizzle's `sql` template. Get compile-time SQL validation while using Drizzle's powerful query builder ecosystem.

## Installation

```bash
npm install @typesugar/drizzle
# or
pnpm add @typesugar/drizzle
```

Requires Drizzle ORM as a peer dependency:

```bash
npm install drizzle-orm
```

## Usage

### dsql — Type-Safe SQL Templates

```typescript
import { dsql } from "@typesugar/drizzle";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const client = postgres("postgres://...");
const db = drizzle(client);

const userId = 123;
const query = dsql`
  SELECT id, name FROM users WHERE id = ${userId}
`;

// Compiles to Drizzle's sql tagged template
const result = await db.execute(query);
```

### ref$ — Column/Table References

```typescript
import { ref$ } from "@typesugar/drizzle";

const column = ref$("users.name");
// Compiles to: sql.identifier("users.name")
```

### id$ — SQL Identifiers

```typescript
import { id$ } from "@typesugar/drizzle";

const col = id$("column_name");
// Compiles to: sql.identifier("column_name")
```

### raw$ — Raw SQL (Use with Caution)

```typescript
import { raw$ } from "@typesugar/drizzle";

const now = raw$("NOW()");
// Compiles to: sql.raw("NOW()")

// Strong warning: Dynamic values are HIGHLY DANGEROUS
```

### join$ — Join SQL Fragments

```typescript
import { join$, dsql } from "@typesugar/drizzle";

const columns = [dsql`id`, dsql`name`, dsql`email`];
const cols = join$(columns, dsql`, `);
// Compiles to: sql.join(columns, sql`, `)
```

## ConnectionIO and Queryable

To execute Drizzle queries purely and transactionally using the Doobie-inspired `ConnectionIO` from `@typesugar/sql`, use the `DrizzleQueryable` instance:

```typescript
import { ConnectionIO } from "@typesugar/sql";
import { DrizzleQueryable } from "@typesugar/drizzle";

// A drizzle query builder object
const query = db.select().from(users).where(eq(users.id, 1));

// Lifted into ConnectionIO
const program = ConnectionIO.fromQueryable(query, DrizzleQueryable);
```

## Compile-Time Validation

The `dsql` macro provides compile-time SQL validation:

```typescript
// Unbalanced parentheses — compile error
const bad = dsql`SELECT * FROM users WHERE (id = ${1}`;
// Error: SQL has unbalanced parentheses

// Dangerous patterns — compile warning
const suspicious = dsql`SELECT * FROM users; DROP TABLE users`;
// Warning: SQL contains potentially dangerous patterns
```

## API Reference

### Tagged Template Macros

- `dsql` — Type-safe SQL template (compiles to Drizzle's `sql`)

### Expression Macros

- `ref$(reference)` — Column/table reference (`sql.identifier`)
- `id$(identifier)` — SQL identifier (`sql.identifier`)
- `join$(items, separator?)` — Join fragments (`sql.join`)
- `raw$(sql)` — Raw SQL (`sql.raw`)

### Registration

- `register()` — Register macros (called automatically on import)

## License

MIT
