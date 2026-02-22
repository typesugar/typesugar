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

## Learn More

- [API Reference](/reference/packages#sql)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/sql)
