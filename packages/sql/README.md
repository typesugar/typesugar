# @typesugar/sql

> Doobie-inspired type-safe SQL for TypeScript with compile-time validation and zero-cost abstractions.

## Overview

`@typesugar/sql` provides a comprehensive SQL DSL inspired by Scala's [Doobie](https://tpolecat.github.io/doobie/) library. Build composable SQL queries with the `sql` tagged template, get compile-time SQL validation, and execute with `ConnectionIO` — a free monad for pure, composable database operations.

**Key Features:**

- **Composable SQL fragments** — Build queries from reusable, type-safe pieces
- **Compile-time type inference** — `sql$` macro infers parameter and result types
- **Pure database operations** — `ConnectionIO` separates description from execution
- **Doobie-style typeclasses** — `Get/Put/Meta` for columns, `Read/Write/Codec` for rows
- **Zero-cost abstractions** — All typeclass overhead compiles away via specialization
- **ORM integration** — `Queryable` interface for Kysely/Drizzle adapters

## Installation

```bash
npm install @typesugar/sql
# or
pnpm add @typesugar/sql
```

## Quick Start

```typescript
import { sql, sql$, ConnectionIO, Transactor, Read, Meta } from "@typesugar/sql";

// Define your type
interface User {
  id: number;
  name: string;
  email: string;
}

// Type-safe query with sql$ macro
const findUser = sql$<User>`
  SELECT id, name, email FROM users WHERE id = ${userId}
`;

// Build a pure database program
const program = ConnectionIO.query(findUser.toQuery(), UserRead).flatMap((user) =>
  user ? ConnectionIO.pure(user) : ConnectionIO.raw("INSERT INTO users DEFAULT VALUES RETURNING *")
);

// Execute with a transactor
const transactor = Transactor.fromPool(pool);
const result = await transactor.transact(program);
```

---

## SQL Fragments

### Basic SQL Queries

The `sql` tagged template creates composable SQL fragments with automatic parameter numbering:

```typescript
import { sql, Fragment, Query, Update } from "@typesugar/sql";

const name = "Alice";
const age = 30;

const query = sql`SELECT * FROM users WHERE name = ${name} AND age > ${age}`;

console.log(query.text); // "SELECT * FROM users WHERE name = $1 AND age > $2"
console.log(query.params); // ["Alice", 30]
```

### Composable Fragments

Fragments can be nested and composed — inner fragments are inlined with correct parameter renumbering:

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
// SELECT * FROM users WHERE active = $1 ORDER BY created_at DESC LIMIT $2
// params: [true, 10]
```

### Conditional Fragment Building

Build dynamic queries by conditionally including fragments:

```typescript
import { sql, Fragment } from "@typesugar/sql";

const buildQuery = (filters: { name?: string; age?: number; active?: boolean }) => {
  let query = sql`SELECT * FROM users WHERE 1=1`;

  if (filters.name) {
    query = sql`${query} AND name = ${filters.name}`;
  }
  if (filters.age) {
    query = sql`${query} AND age >= ${filters.age}`;
  }
  if (filters.active !== undefined) {
    query = sql`${query} AND active = ${filters.active}`;
  }

  return query;
};

const query = buildQuery({ name: "Alice", age: 25 });
// SELECT * FROM users WHERE 1=1 AND name = $1 AND age >= $2
```

### Typed Queries and Updates

Convert fragments to typed queries or updates:

```typescript
import { sql, Query, Update } from "@typesugar/sql";

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

---

## TypedFragment — Compile-Time Type Tracking

`TypedFragment<P, R>` extends Fragment with compile-time parameter and result type tracking:

- **P**: Tuple of parameter types (what goes in)
- **R**: Result row type (what comes out)

### Basic Usage

```typescript
import { TypedFragment, TypedQuery, TypedUpdate, sql$ } from "@typesugar/sql";

// Parameter types inferred from interpolations
const byId = sql$<[number]>`WHERE id = ${0}`;
// TypedFragment<[number], void>

// Explicit result type
const selectUsers = sql$<[], User>`SELECT id, name, email FROM users`;
// TypedFragment<[], User>

// Composition preserves and concatenates types
const query = selectUsers.append(byId);
// TypedFragment<[number], User>
```

### TypedFragment Methods

```typescript
class TypedFragment<P extends readonly unknown[], R> {
  // Composition
  append<P2, R2>(other: TypedFragment<P2, R2>): TypedFragment<[...P, ...P2], R>;
  prepend<P2, R2>(other: TypedFragment<P2, R2>): TypedFragment<[...P2, ...P], R2>;
  parens(): TypedFragment<P, R>;

  // Conversion
  toQuery(): TypedQuery<P, R>;
  toUpdate(): TypedUpdate<P>;
  toFragment(): Fragment;
}
```

### TypedQuery Methods

`TypedQuery<P, R>` wraps a typed fragment for SELECT operations:

```typescript
class TypedQuery<P extends readonly unknown[], R> {
  // Transform result type
  map<R2>(f: (row: R) => R2): TypedQuery<P, R2>;

  // Apply a Read instance
  to<R2>(read: Read<R2>): TypedQuery<P, R2>;

  // Cardinality modifiers
  unique(): TypedQuery<P, R>; // Expect exactly one row
  option(): TypedQuery<P, R | null>; // Expect zero or one row

  // Get SQL
  toSql(): { sql: string; params: readonly SqlParam[] };
}
```

### TypedUpdate Methods

`TypedUpdate<P>` wraps a typed fragment for INSERT/UPDATE/DELETE operations:

```typescript
class TypedUpdate<P extends readonly unknown[]> {
  // Execute and return affected count
  run(): TypedUpdate<P>;

  // Execute with RETURNING clause for generated keys
  withGeneratedKeys<K extends string>(...columns: K[]): TypedQuery<P, Record<K, unknown>>;

  // Get SQL
  toSql(): { sql: string; params: readonly SqlParam[] };
}

// Example: Insert with returning generated ID
const insert = sql$<[string, string]>`
  INSERT INTO users (name, email) VALUES (${name}, ${email})
`.toUpdate();

const withId = insert.withGeneratedKeys("id");
// TypedQuery<[string, string], { id: unknown }>
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
const conditions = andTyped(sql$`name = ${"Alice"}`, sql$`age > ${21}`);
// SQL: "name = ? AND age > ?"

// Join conditions with OR
const alternatives = orTyped(sql$`status = ${"active"}`, sql$`role = ${"admin"}`);
// SQL: "status = ? OR role = ?"

// Type-safe IN clause
const inClause = inListTyped("id", [1, 2, 3]);
// SQL: "id IN (?, ?, ?)"
// TypedFragment<number[], void>

// Type-safe VALUES clause for INSERT
const values = valuesTyped(UserWrite, { name: "Alice", email: "alice@example.com" });
// SQL: "(?, ?)"

// Batch INSERT with multiple rows
const batchValues = valuesManyTyped(UserWrite, [
  { name: "Alice", email: "alice@example.com" },
  { name: "Bob", email: "bob@example.com" },
]);
// SQL: "(?, ?), (?, ?)"

// Type-safe SET clause for UPDATE
const setClause = setTyped(UserWrite, { name: "Bob", email: "bob@example.com" });
// SQL: "name = ?, email = ?"

// Conditional fragment
const maybeFilter = whenTyped(showInactive, sql$`active = ${false}`);

// Build WHERE clause from optional conditions
const where = whereAndTyped(
  sql$`name = ${"Alice"}`,
  showInactive ? sql$`active = ${false}` : null,
  minAge ? sql$`age >= ${minAge}` : null
);
// SQL: "WHERE name = ? AND active = ? AND age >= ?"
// Only includes non-null conditions
```

---

## sql$ Macro — Compile-Time Type Inference

The `sql$` macro parses SQL at compile time to infer parameter and result types.

### Basic Parameter Inference

```typescript
// Types inferred from interpolated expressions
const findUser = sql$`SELECT * FROM users WHERE id = ${userId}`;
// userId: number => TypedFragment<[number], SqlRow>
```

### Explicit Result Type

```typescript
const findUser = sql$<User>`SELECT id, name FROM users WHERE id = ${userId}`;
// TypedFragment<[number], User>
```

### Schema-Based Inference with @schema

Register table schemas for automatic result type inference:

```typescript
import { registerSchema, sql$ } from "@typesugar/sql";

// Register schema at compile time
@schema("users")
interface UsersTable {
  id: number;
  name: string;
  email: string;
  created_at: Date;
}

// Or register programmatically
registerSchema("users", "UsersTable");

// SELECT * infers full table type
const selectAll = sql$`SELECT * FROM users`;
// TypedFragment<[], UsersTable>

// SELECT specific columns infers Pick type
const selectSome = sql$`SELECT id, name FROM users`;
// TypedFragment<[], Pick<UsersTable, 'id' | 'name'>>
```

### Query Builder DSL

For complex queries, use the fluent query builder:

```typescript
import { select, sql$ } from "@typesugar/sql";

const query = select<User>("id", "name", "email")
  .from("users")
  .where(sql$`active = ${true}`)
  .andWhere(sql$`age > ${21}`)
  .join("profiles", "profiles.user_id = users.id")
  .leftJoin("preferences", "preferences.user_id = users.id")
  .orderBy("created_at DESC", "name ASC")
  .limit(10)
  .offset(20)
  .build();

// { sql: "SELECT id, name, email FROM users JOIN profiles ON ... WHERE ... ORDER BY ... LIMIT 10 OFFSET 20",
//   params: [true, 21] }
```

---

## SQL Typeclasses — Doobie-Style Type Mapping

The package provides a complete typeclass hierarchy for SQL ↔ TypeScript mapping:

```
                   ┌─────────┐
                   │  Meta   │  (bidirectional single-column)
                   └────┬────┘
                   ┌────┴────┐
              ┌────┴───┐ ┌───┴────┐
              │  Get   │ │  Put   │  (single-column read/write)
              └────────┘ └────────┘

                   ┌─────────┐
                   │  Codec  │  (bidirectional row-level)
                   └────┬────┘
                   ┌────┴────┐
              ┌────┴───┐ ┌───┴────┐
              │  Read  │ │ Write  │  (row-level read/write)
              └────────┘ └────────┘
```

### Get/Put — Column-Level Mapping

```typescript
import { Get, Put } from "@typesugar/sql";

// Get<A>: Read a single SQL column as type A
interface Get<A> {
  readonly get: (value: unknown) => A | null;
  readonly unsafeGet: (value: unknown) => A;
  readonly sqlTypes: readonly SqlTypeName[];
}

// Put<A>: Write a TypeScript value to SQL parameter
interface Put<A> {
  readonly put: (value: A) => unknown;
  readonly sqlType: SqlTypeName;
}
```

### Meta — Bidirectional Column Mapping

```typescript
import { Meta } from "@typesugar/sql";

// Meta<A> combines Get<A> and Put<A> for bidirectional mapping
interface Meta<A> {
  readonly get: (value: unknown) => A | null;
  readonly unsafeGet: (value: unknown) => A;
  readonly put: (value: A) => unknown;
  readonly sqlTypes: readonly SqlTypeName[];
  readonly sqlType: SqlTypeName;
}
```

### Built-in Primitive Instances

```typescript
import {
  // Meta instances (Get + Put)
  Meta,

  // Individual Get/Put for finer control
  Get,
  Put,
} from "@typesugar/sql";

// Primitive Meta instances
Meta.string; // TEXT, VARCHAR, CHAR
Meta.number; // NUMERIC, REAL, DOUBLE PRECISION
Meta.int; // INTEGER, INT (truncates to integer)
Meta.bigint; // BIGINT
Meta.boolean; // BOOLEAN
Meta.date; // TIMESTAMP, TIMESTAMPTZ
Meta.dateOnly; // DATE (without time)
Meta.uuid; // UUID
Meta.json; // JSON, JSONB
Meta.buffer; // BYTEA

// Combinators
Meta.nullable(Meta.string); // string | null
Meta.optional(Meta.string); // string | undefined
Meta.array(Meta.int); // number[]
Meta.jsonAs<MyType>(); // Typed JSON
Meta.imap(Meta.string, parse, serialize); // Transform both directions
```

### Get/Put Combinators

```typescript
// Get combinators (covariant functor)
Get.map(Get.string, (s) => s.toUpperCase()); // Transform output
Get.nullable(Get.int); // Handle NULL
Get.optional(Get.int); // NULL → undefined
Get.array(Get.string); // Array of elements

// Put combinators (contravariant functor)
Put.contramap(Put.string, (id: UserId) => id.value); // Transform input
Put.nullable(Put.int); // Allow null
Put.optional(Put.int); // Allow undefined
Put.array(Put.string); // Array of elements
```

### Read/Write — Row-Level Mapping

```typescript
import { Read, Write, Codec } from "@typesugar/sql";

// Read<A>: Read an entire result row as type A
interface Read<A> {
  readonly read: (row: SqlRow) => A | null;
  readonly unsafeRead: (row: SqlRow) => A;
  readonly columns: readonly string[];
}

// Write<A>: Write a TypeScript object to SQL parameters
interface Write<A> {
  readonly write: (value: A) => readonly unknown[];
  readonly columns: readonly string[];
}

// Codec<A>: Combined Read + Write
interface Codec<A> extends Read<A>, Write<A> {}
```

### Read/Write Combinators

```typescript
// Read combinators
Read.map(ReadUser, (user) => ({ ...user, displayName: user.name }));
Read.product(ReadUser, ReadProfile); // Read<[User, Profile]>
Read.tuple(ReadUser, ReadProfile, ReadSettings); // Read<[User, Profile, Settings]>
Read.optional(ReadUser); // Read<User | undefined>
Read.column("name", Get.string); // Read single column

// Write combinators
Write.contramap(WriteUser, (dto: UserDTO) => toUser(dto));
Write.product(WriteUser, WriteProfile); // Write<[User, Profile]>
Write.tuple(WriteUser, WriteProfile); // Write<[User, Profile]>

// Codec combinators
Codec.fromReadWrite(ReadUser, WriteUser);
Codec.imap(UserCodec, toDTO, fromDTO);
```

### Auto-Derivation with @deriving

Generate Read/Write/Codec/Meta instances automatically:

```typescript
import { deriveRead, deriveWrite, deriveCodec, Meta } from "@typesugar/sql";

interface User {
  id: number;
  name: string;
  email: string;
  createdAt: Date;
}

// Using @deriving decorator (requires transformer)
@deriving(Read, Write, Codec)
interface User { ... }

// Or derive programmatically with field configuration
const UserRead = deriveRead<User>({
  id: { meta: Meta.int },
  name: { meta: Meta.string },
  email: { meta: Meta.string },
  createdAt: { meta: Meta.date, column: "created_at" },  // Custom column name
});

const UserWrite = deriveWrite<User>({
  id: { meta: Meta.int },
  name: { meta: Meta.string },
  email: { meta: Meta.string },
  createdAt: { meta: Meta.date, column: "created_at" },
});

const UserCodec = deriveCodec<User>({
  id: { meta: Meta.int },
  name: { meta: Meta.string },
  email: { meta: Meta.string },
  createdAt: { meta: Meta.date, column: "created_at" },
});
```

### @deriving(Meta) for Column Types

For newtype/branded column types, derive Meta instances:

```typescript
// Define a branded type
type UserId = string & { readonly _brand: "UserId" };

// Derive Meta for the newtype
@deriving(Meta)
type UserId = string & { readonly _brand: "UserId" };

// Or use imap manually
const UserIdMeta = Meta.imap(
  Meta.string,
  (s: string) => s as UserId,      // string → UserId
  (id: UserId) => id as string,    // UserId → string
);
```

### Column Name Transformation

```typescript
import { toSnakeCase } from "@typesugar/sql";

// Automatically convert camelCase fields to snake_case columns
toSnakeCase("createdAt"); // "created_at"
toSnakeCase("userId"); // "user_id"
toSnakeCase("firstName"); // "first_name"
```

### Instance Registries

For implicit resolution and auto-derivation, instances are stored in registries:

```typescript
import {
  getRegistry,
  putRegistry,
  metaRegistry,
  readRegistry,
  writeRegistry,
  codecRegistry,
} from "@typesugar/sql";

// Register custom instances
metaRegistry.set("UserId", UserIdMeta);
readRegistry.set("User", UserRead);
writeRegistry.set("User", UserWrite);

// Lookup instances (for summon integration)
const userRead = readRegistry.get("User") as Read<User>;

// Pre-registered primitives:
// - string, number, int, bigint, boolean
// - Date, Buffer, json, uuid
```

---

## ConnectionIO — Pure Database Operations

`ConnectionIO<A>` is a free monad describing database operations. It separates the **description** of what to do from **execution**, enabling pure functional database code.

### Why ConnectionIO?

- **Pure functions** — Database operations are referentially transparent
- **Composable** — Chain operations with `map`, `flatMap`, `zip`
- **Testable** — Mock the interpreter, not the database
- **Resource-safe** — Connection handling is automatic
- **Transaction-safe** — Compose operations, run atomically

### Basic Operations

```typescript
import { ConnectionIO } from "@typesugar/sql";

// Lift a pure value
const pure = ConnectionIO.pure(42);

// Unit (void) value
const unit = ConnectionIO.unit;

// Delay a computation
const delayed = ConnectionIO.delay(() => expensiveComputation());

// Lift an async operation
const async = ConnectionIO.async(() => fetchFromExternalAPI());
```

### Query Operations

```typescript
// Query returning single result (or null)
const findOne = ConnectionIO.query(
  sql$<User>`SELECT * FROM users WHERE id = ${id}`.toQuery(),
  UserRead
);
// ConnectionIO<User | null>

// Query returning multiple results
const findAll = ConnectionIO.queryMany(
  sql$<User>`SELECT * FROM users WHERE active = ${true}`.toQuery(),
  UserRead
);
// ConnectionIO<User[]>

// Execute an update (returns affected row count)
const update = ConnectionIO.execute(
  sql$`UPDATE users SET name = ${"Bob"} WHERE id = ${1}`.toUpdate()
);
// ConnectionIO<number>

// Execute with generated keys returned
const insert = ConnectionIO.executeWithKeys(
  sql$`INSERT INTO users (name, email) VALUES (${"Alice"}, ${"a@example.com"})`.toUpdate(),
  ["id", "created_at"]
);
// ConnectionIO<{ id: unknown; created_at: unknown }[]>

// Raw SQL execution
const raw = ConnectionIO.raw("SELECT * FROM users WHERE id = $1", [userId]);
// ConnectionIO<SqlRow[]>
```

### Monad Operations

```typescript
// map — Transform the result
const program = ConnectionIO.query(findUserQuery, UserRead).map(
  (user) => user?.name ?? "Anonymous"
);
// ConnectionIO<string>

// flatMap — Chain operations
const program = ConnectionIO.query(findUserQuery, UserRead).flatMap((user) =>
  user
    ? ConnectionIO.pure(user)
    : ConnectionIO.execute(createDefaultUser).flatMap(() =>
        ConnectionIO.query(findUserQuery, UserRead)
      )
);
// ConnectionIO<User | null>

// chain — Alias for flatMap
const program = findUser(id).chain((user) => updateLastLogin(user.id));

// andThen — Sequence, ignoring first result
const program = logAccess(userId).andThen(findUser(userId));
```

### Applicative Operations

```typescript
// zip — Combine two operations, keeping both results
const program = findUser(userId).zip(findProfile(userId));
// ConnectionIO<[User | null, Profile | null]>

// zipLeft — Combine, keeping left result
const program = findUser(userId).zipLeft(logAccess(userId));
// ConnectionIO<User | null>

// zipRight — Combine, keeping right result
const program = logAccess(userId).zipRight(findUser(userId));
// ConnectionIO<User | null>

// ap — Applicative apply
const program = ConnectionIO.pure((u: User) => u.name).ap(findUser(userId));
// ConnectionIO<string | undefined>
```

### Error Handling

```typescript
import { ConnectionIO, Either, Left, Right } from "@typesugar/sql";

// attempt — Catch errors as Either
const safe = riskyOperation.attempt();
// ConnectionIO<Either<Error, Result>>

// handleError — Recover from errors
const withFallback = riskyOperation.handleError((err) => {
  console.error("Operation failed:", err);
  return ConnectionIO.pure(defaultValue);
});
// ConnectionIO<Result>

// orElse — Simple fallback
const withDefault = riskyOperation.orElse(ConnectionIO.pure(defaultValue));
// ConnectionIO<Result>
```

### Transaction Control

```typescript
// transact — Run in a transaction
const atomicProgram = ConnectionIO.execute(debitAccount)
  .flatMap(() => ConnectionIO.execute(creditAccount))
  .transact();
// If either fails, both are rolled back
```

### ORM Integration with Queryable

Use `fromQueryable` to integrate with Kysely, Drizzle, or other ORMs:

```typescript
import { ConnectionIO, Queryable } from "@typesugar/sql";

// Define a Queryable instance for your ORM
const kyselyQueryable: Queryable<KyselyQuery> = {
  execute: async (query, conn) => {
    // Execute the Kysely query using the connection
    return await query.execute(conn);
  },
};

// Use ORM queries in ConnectionIO
const program = ConnectionIO.fromQueryable(
  db.selectFrom("users").selectAll().where("id", "=", userId),
  kyselyQueryable
);
// ConnectionIO<User[]>
```

### Combinators

```typescript
import { sequence, traverse, parZip, parSequence, when, whenA, unfold } from "@typesugar/sql";

// sequence — Run multiple operations, collect results
const programs = [findUser(1), findUser(2), findUser(3)];
const all = sequence(programs);
// ConnectionIO<(User | null)[]>

// traverse — Map then sequence
const userIds = [1, 2, 3];
const users = traverse(userIds, (id) => findUser(id));
// ConnectionIO<(User | null)[]>

// parZip — Run two operations (potentially in parallel)
const both = parZip(findUser(1), findProfile(1));
// ConnectionIO<[User | null, Profile | null]>

// parSequence — Run all operations (potentially in parallel)
const all = parSequence([findUser(1), findUser(2), findUser(3)]);
// ConnectionIO<(User | null)[]>

// when — Conditional execution (void result)
const maybeLog = when(shouldLog, logAccess(userId));
// ConnectionIO<void>

// whenA — Conditional execution (with result)
const maybeUser = whenA(shouldFetch, findUser(userId));
// ConnectionIO<User | null>

// unfold — Loop with accumulator
const paginate = unfold(0, (page) =>
  ConnectionIO.query(getPage(page), PageRead).map((results) =>
    results.length > 0 ? [page + 1, results] : null
  )
);
// ConnectionIO<Page[]>
```

---

## Transactor — Execute ConnectionIO Programs

The `Transactor` interprets `ConnectionIO` programs against an actual database.

### Creating a Transactor

```typescript
import { Transactor, DbConnection } from "@typesugar/sql";

// From a connection pool (recommended)
const transactor = Transactor.fromPool({
  connect: () => pool.getConnection(),
  release: (conn) => conn.release(),
});

// From a single connection (for testing)
const transactor = Transactor.fromConnection(mockConnection);

// Custom constructor
const transactor = new Transactor(
  () => pool.getConnection(),
  (conn) => conn.release()
);
```

### Running Programs

```typescript
// run — Execute without transaction
const user = await transactor.run(findUser(userId));

// transact — Execute in a transaction (auto-rollback on error)
const result = await transactor.transact(
  ConnectionIO.execute(debitAccount).flatMap(() => ConnectionIO.execute(creditAccount))
);
```

### DbConnection Interface

Implement this interface for your database driver:

```typescript
interface DbConnection {
  query(sql: string, params: readonly unknown[]): Promise<SqlRow[]>;
  execute(sql: string, params: readonly unknown[]): Promise<number>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}
```

---

## Queryable — ORM Integration Interface

The `Queryable` interface enables integration with any ORM (Kysely, Drizzle, Prisma, etc.):

```typescript
interface Queryable<Q> {
  execute(query: Q, conn: DbConnection): Promise<unknown>;
}
```

### Kysely Example

```typescript
import { Queryable, ConnectionIO } from "@typesugar/sql";
import { Kysely } from "kysely";

const kyselyQueryable: Queryable<CompiledQuery> = {
  async execute(query, conn) {
    const { sql, parameters } = query;
    return await conn.query(sql, parameters);
  },
};

// Now use Kysely query builders in ConnectionIO
const findUsers = ConnectionIO.fromQueryable(
  db.selectFrom("users").selectAll().compile(),
  kyselyQueryable
);
```

### Drizzle Example

```typescript
import { Queryable, ConnectionIO } from "@typesugar/sql";

const drizzleQueryable: Queryable<DrizzleQuery> = {
  async execute(query, conn) {
    const { sql, params } = query.toSQL();
    return await conn.query(sql, params);
  },
};

// Use Drizzle queries in ConnectionIO
const findUsers = ConnectionIO.fromQueryable(db.select().from(users), drizzleQueryable);
```

---

## Macro Features

When used with the typesugar transformer, additional compile-time features are available:

### SQL Syntax Validation

```typescript
// Compile-time error: unbalanced parentheses
const bad = sql`SELECT * FROM users WHERE (id = ${1}`;

// Compile-time warning: potentially dangerous pattern
const risky = sql`DELETE FROM users`; // Warning: DELETE without WHERE
```

### Type Inference

```typescript
// Parameter types inferred from expressions
const query = sql$`SELECT * FROM users WHERE id = ${userId} AND name = ${name}`;
// If userId: number, name: string
// => TypedFragment<[number, string], SqlRow>
```

---

## API Quick Reference

### Fragment Building

| Function         | Description                              |
| ---------------- | ---------------------------------------- |
| `sql\`...\``     | Basic SQL fragment                       |
| `sql$\`...\``    | Typed SQL fragment (macro)               |
| `sql$<R>\`...\`` | Typed fragment with explicit result type |

### TypedFragment Combinators

| Function                         | Description                    |
| -------------------------------- | ------------------------------ |
| `emptyTyped`                     | Empty fragment                 |
| `andTyped(...frags)`             | Join with AND                  |
| `orTyped(...frags)`              | Join with OR                   |
| `commasTyped(...frags)`          | Join with commas               |
| `intercalateTyped(sep, frags)`   | Join with custom separator     |
| `inListTyped(col, values)`       | IN clause                      |
| `valuesTyped(write, value)`      | Single VALUES row              |
| `valuesManyTyped(write, values)` | Multiple VALUES rows           |
| `setTyped(write, partial)`       | SET clause                     |
| `whenTyped(cond, frag)`          | Conditional fragment           |
| `whereAndTyped(...frags)`        | WHERE with AND (filters nulls) |

### ConnectionIO Constructors

| Function                                | Description            |
| --------------------------------------- | ---------------------- |
| `ConnectionIO.pure(a)`                  | Lift a value           |
| `ConnectionIO.unit`                     | Void value             |
| `ConnectionIO.delay(f)`                 | Delayed computation    |
| `ConnectionIO.async(f)`                 | Async computation      |
| `ConnectionIO.query(q, read)`           | Single result query    |
| `ConnectionIO.queryMany(q, read)`       | Multiple results query |
| `ConnectionIO.execute(update)`          | Execute update         |
| `ConnectionIO.executeWithKeys(u, cols)` | Update with RETURNING  |
| `ConnectionIO.raw(sql, params)`         | Raw SQL                |
| `ConnectionIO.fromQueryable(q, qbl)`    | ORM query              |

### ConnectionIO Methods

| Method              | Description         |
| ------------------- | ------------------- |
| `.map(f)`           | Transform result    |
| `.flatMap(f)`       | Chain operations    |
| `.chain(f)`         | Alias for flatMap   |
| `.andThen(next)`    | Sequence            |
| `.zip(other)`       | Combine results     |
| `.zipLeft(other)`   | Combine, keep left  |
| `.zipRight(other)`  | Combine, keep right |
| `.ap(fab)`          | Applicative apply   |
| `.attempt()`        | Catch as Either     |
| `.handleError(f)`   | Error recovery      |
| `.orElse(fallback)` | Simple fallback     |
| `.transact()`       | Run in transaction  |

### Typeclass Instances

| Instance        | Type      | SQL Types              |
| --------------- | --------- | ---------------------- |
| `Meta.string`   | `string`  | TEXT, VARCHAR, CHAR    |
| `Meta.number`   | `number`  | NUMERIC, REAL, etc.    |
| `Meta.int`      | `number`  | INTEGER, INT           |
| `Meta.bigint`   | `bigint`  | BIGINT                 |
| `Meta.boolean`  | `boolean` | BOOLEAN                |
| `Meta.date`     | `Date`    | TIMESTAMP, TIMESTAMPTZ |
| `Meta.dateOnly` | `Date`    | DATE                   |
| `Meta.uuid`     | `string`  | UUID                   |
| `Meta.json`     | `unknown` | JSON, JSONB            |
| `Meta.buffer`   | `Buffer`  | BYTEA                  |

### Typeclass Combinators

| Combinator              | Description             |
| ----------------------- | ----------------------- |
| `Meta.nullable(m)`      | Allow NULL              |
| `Meta.optional(m)`      | NULL → undefined        |
| `Meta.array(m)`         | Array type              |
| `Meta.imap(m, f, g)`    | Bidirectional transform |
| `Meta.jsonAs<T>()`      | Typed JSON              |
| `Get.map(g, f)`         | Transform output        |
| `Put.contramap(p, f)`   | Transform input         |
| `Read.map(r, f)`        | Transform row           |
| `Read.product(r1, r2)`  | Combine reads           |
| `Read.tuple(...rs)`     | Multi-read              |
| `Write.contramap(w, f)` | Transform input         |
| `Write.product(w1, w2)` | Combine writes          |

---

## Zero-Cost Guarantee

All typeclass operations compile away via specialization:

```typescript
// Before (generic)
const program = ConnectionIO.query(findUserQuery, UserRead)
  .map(user => user?.name);

// After specialization (direct code)
const program = async (conn) => {
  const rows = await conn.query("SELECT ...", params);
  const user = rows[0] ? { id: rows[0].id, name: rows[0].name, ... } : null;
  return user?.name;
};
```

No runtime dictionary lookups, no wrapper allocations — just the code you'd write by hand.

---

## License

MIT
