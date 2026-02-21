# @typesugar/sql

> Type-safe SQL tagged templates with compile-time validation.

## Overview

`@typesugar/sql` provides a Doobie-like type-safe SQL DSL for TypeScript. Build composable SQL queries with the `sql` tagged template, get compile-time SQL validation, and execute with ConnectionIO for pure database operation descriptions.

## Installation

```bash
npm install @typesugar/sql
# or
pnpm add @typesugar/sql
```

## Usage

### Basic SQL Queries

```typescript
import { sql, Fragment, Query, Update } from "@typesugar/sql";

const name = "Alice";
const age = 30;

const query = sql`SELECT * FROM users WHERE name = ${name} AND age > ${age}`;

console.log(query.text); // "SELECT * FROM users WHERE name = $1 AND age > $2"
console.log(query.params); // ["Alice", 30]
```

### Composable Fragments

```typescript
import { sql } from "@typesugar/sql";

const whereClause = sql`WHERE active = ${true}`;
const orderBy = sql`ORDER BY created_at DESC`;

const query = sql`
  SELECT * FROM users
  ${whereClause}
  ${orderBy}
  LIMIT ${10}
`;
// Fragments are inlined, parameters are correctly numbered
```

### Typed Queries

```typescript
import { sql, Query } from "@typesugar/sql";

interface User {
  id: number;
  name: string;
  email: string;
}

const getUserById = (id: number): Query<User> =>
  sql`SELECT id, name, email FROM users WHERE id = ${id}`.toQuery<User>();

const updateUser = (id: number, name: string): Update =>
  sql`UPDATE users SET name = ${name} WHERE id = ${id}`.toUpdate();
```

### ConnectionIO — Pure Database Operations

```typescript
import { ConnectionIO, Transactor } from "@typesugar/sql";

// Describe database operations purely
const getUser = (id: number): ConnectionIO<User | null> =>
  ConnectionIO.query(sql`SELECT * FROM users WHERE id = ${id}`.toQuery<User>()).map(
    (rows) => rows[0] ?? null
  );

const createUser = (name: string, email: string): ConnectionIO<number> =>
  ConnectionIO.update(
    sql`INSERT INTO users (name, email) VALUES (${name}, ${email}) RETURNING id`.toUpdate()
  );

// Compose operations
const program = ConnectionIO.flatMap(createUser("Alice", "alice@example.com"), (id) => getUser(id));

// Execute with a transactor
const transactor = new Transactor(dbConnection);
const result = await transactor.run(program);
```

### Fragment Building

```typescript
import { sql, Fragment } from "@typesugar/sql";

// Conditional fragments
const buildQuery = (filters: { name?: string; age?: number }) => {
  let query = sql`SELECT * FROM users WHERE 1=1`;

  if (filters.name) {
    query = sql`${query} AND name = ${filters.name}`;
  }

  if (filters.age) {
    query = sql`${query} AND age >= ${filters.age}`;
  }

  return query;
};

const query = buildQuery({ name: "Alice", age: 25 });
// SELECT * FROM users WHERE 1=1 AND name = $1 AND age >= $2
```

## API Reference

### Fragment

The core SQL building block.

```typescript
class Fragment {
  // Properties
  readonly segments: string[];
  readonly params: SqlParam[];

  // Computed
  get text(): string; // SQL with $1, $2, ... placeholders
  get isEmpty(): boolean;

  // Conversion
  toQuery<R>(): Query<R>;
  toUpdate(): Update;

  // Combination
  concat(other: Fragment): Fragment;
}
```

### Query<R>

Type-branded query fragment.

```typescript
class Query<R> {
  readonly fragment: Fragment;
  get text(): string;
  get params(): SqlParam[];
}
```

### Update

Query fragment for mutations.

```typescript
class Update {
  readonly fragment: Fragment;
  get text(): string;
  get params(): SqlParam[];
}
```

### ConnectionIO<A>

Pure description of database operations.

```typescript
class ConnectionIO<A> {
  // Constructors
  static pure<A>(value: A): ConnectionIO<A>;
  static query<R>(query: Query<R>): ConnectionIO<R[]>;
  static update(update: Update): ConnectionIO<number>;

  // Combinators
  map<B>(f: (a: A) => B): ConnectionIO<B>;
  flatMap<B>(f: (a: A) => ConnectionIO<B>): ConnectionIO<B>;

  // Error handling
  handleError(f: (e: Error) => ConnectionIO<A>): ConnectionIO<A>;
}
```

### Transactor

Executes ConnectionIO programs.

```typescript
class Transactor {
  constructor(connection: DbConnection);
  run<A>(program: ConnectionIO<A>): Promise<A>;
  runInTransaction<A>(program: ConnectionIO<A>): Promise<A>;
}
```

### Tagged Template

```typescript
function sql(strings: TemplateStringsArray, ...values: unknown[]): Fragment;
```

## Macro Features

When used with the typesugar transformer, `sql` provides compile-time validation:

- SQL syntax checking
- Unbalanced parentheses detection
- Warning for potentially dangerous patterns

```typescript
// Compile-time error: unbalanced parentheses
const bad = sql`SELECT * FROM users WHERE (id = ${1}`;
```

## License

MIT
