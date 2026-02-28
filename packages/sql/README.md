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

## TypedFragment — Compile-Time Type Tracking

`TypedFragment<P, R>` extends Fragment with compile-time parameter and result type tracking:

```typescript
import { TypedFragment, TypedQuery, TypedUpdate, sql$ } from "@typesugar/sql";

// TypedFragment tracks parameter types (P) and result types (R)
// P = tuple of parameter types, R = result row type

// Using sql$ macro for type inference
const byId = sql$<[number]>`WHERE id = ${0}`;
// TypedFragment<[number], void>

const selectUsers = sql$<[], User>`SELECT id, name, email FROM users`;
// TypedFragment<[], User>

// Composition preserves types
const query = selectUsers.append(byId);
// TypedFragment<[number], User>
```

### TypedFragment Combinators

```typescript
import {
  emptyTyped,
  intercalateTyped,
  andTyped,
  orTyped,
  commasTyped,
  inListTyped,
  valuesTyped,
  valuesManyTyped,
  setTyped,
  whenTyped,
  whereAndTyped,
} from "@typesugar/sql";

// Join conditions with AND
const conditions = andTyped(
  sql$`name = ${"Alice"}`,
  sql$`age > ${21}`,
);
// SQL: "name = ? AND age > ?"

// Type-safe IN clause
const inClause = inListTyped("id", [1, 2, 3]);
// SQL: "id IN (?, ?, ?)"

// Conditional fragment
const maybeFilter = whenTyped(showInactive, sql$`active = ${false}`);

// Build WHERE clause from optional conditions
const where = whereAndTyped(
  sql$`name = ${"Alice"}`,
  showInactive ? sql$`active = ${false}` : null,
  minAge ? sql$`age >= ${minAge}` : null,
);
// SQL: "WHERE name = ? AND active = ? AND age >= ?"
```

## SQL Typeclasses — Doobie-Style Type Mapping

The package provides typeclasses for mapping between SQL and TypeScript types:

```typescript
import { Get, Put, Meta, Read, Write, Codec } from "@typesugar/sql";
```

### Get/Put — Column-Level Mapping

```typescript
// Get<A>: Read a single SQL column as type A
interface Get<A> {
  readonly get: (value: unknown) => A;
  readonly sqlType: SqlTypeName;
}

// Put<A>: Write a TypeScript value to SQL
interface Put<A> {
  readonly put: (value: A) => unknown;
  readonly sqlType: SqlTypeName;
}

// Meta<A>: Combined Get + Put for a column type
interface Meta<A> {
  readonly get: Get<A>;
  readonly put: Put<A>;
}
```

### Built-in Meta Instances

```typescript
import {
  stringMeta,
  numberMeta,
  intMeta,
  bigintMeta,
  booleanMeta,
  dateMeta,
  dateOnlyMeta,
  uuidMeta,
  jsonMeta,
  bufferMeta,
  nullable,
  optional,
  arrayMeta,
} from "@typesugar/sql";

// Use built-in instances
const userNameMeta = stringMeta;

// Compose with combinators
const optionalEmailMeta = optional(stringMeta);
const tagsArrayMeta = arrayMeta(stringMeta);
const nullableAgeMeta = nullable(intMeta);
```

### Read/Write — Row-Level Mapping

```typescript
// Read<A>: Read a SQL row as type A
interface Read<A> {
  readonly columns: readonly string[];
  readonly read: (row: SqlRow) => A;
}

// Write<A>: Write a TypeScript object to SQL row
interface Write<A> {
  readonly columns: readonly string[];
  readonly write: (value: A) => readonly unknown[];
}

// Codec<A>: Combined Read + Write for a row type
interface Codec<A> {
  readonly read: Read<A>;
  readonly write: Write<A>;
}
```

### Auto-Derivation with @deriving

Generate Read/Write/Codec instances automatically:

```typescript
import { deriveRead, deriveWrite, deriveCodec } from "@typesugar/sql";

interface User {
  id: number;
  name: string;
  email: string;
  createdAt: Date;
}

// Using @deriving decorator (requires transformer)
@deriving(Read, Write, Codec)
interface User { ... }

// Or derive programmatically
const userRead = deriveRead<User>(["id", "name", "email", "createdAt"]);
const userWrite = deriveWrite<User>(["id", "name", "email", "createdAt"]);
const userCodec = deriveCodec<User>(["id", "name", "email", "createdAt"]);
```

### Column Name Transformation

```typescript
import { toSnakeCase } from "@typesugar/sql";

// Automatically convert camelCase fields to snake_case columns
// createdAt → created_at
// userId → user_id
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

### TypedFragment<P, R>

Type-tracked SQL fragment.

```typescript
class TypedFragment<P extends readonly unknown[], R> {
  readonly segments: readonly string[];
  readonly params: readonly SqlParam[];

  append<P2, R2>(other: TypedFragment<P2, R2>): TypedFragment<[...P, ...P2], R>;
  prepend<P2, R2>(other: TypedFragment<P2, R2>): TypedFragment<[...P2, ...P], R2>;
  parens(): TypedFragment<P, R>;
  toQuery(): TypedQuery<P, R>;
  toUpdate(): TypedUpdate<P>;
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

### Tagged Templates

```typescript
// Basic sql template (runtime, untyped)
function sql(strings: TemplateStringsArray, ...values: unknown[]): Fragment;

// sql$ macro (compile-time, typed) — requires transformer
function sql$<P extends readonly unknown[], R = void>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): TypedFragment<P, R>;
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
