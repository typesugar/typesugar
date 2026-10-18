# @typesugar/sql

> 📖 **Full documentation:** [SQL guide](https://typesugar.org/guides/sql). The microsite is the canonical reference; this README is a quickstart.

Doobie-inspired type-safe SQL for TypeScript: composable `sql` fragments, compile-time validation, and `ConnectionIO` for pure database operations.

## Installation

```bash
npm install @typesugar/sql
```

## Quick Start

```typescript
import { sql, ConnectionIO, Transactor, deriveRead, Meta } from "@typesugar/sql";

const name = "Alice";
const age = 30;

const query = sql`SELECT * FROM users WHERE name = ${name} AND age > ${age}`;
console.log(query.text); // "SELECT * FROM users WHERE name = $1 AND age > $2"
console.log(query.values); // ["Alice", 30]

interface User {
  id: number;
  name: string;
}

// Row decoder (or generate it: `@derive(Read) interface User { ... }` → ReadUser)
const ReadUser = deriveRead<User>({ id: { meta: Meta.int }, name: { meta: Meta.string } });

// A pure description of a database program — nothing runs yet
const getUserName = (id: number) =>
  ConnectionIO.query(
    sql`SELECT id, name FROM users WHERE id = ${id}`.toQuery<User>(),
    ReadUser
  ).map((user) => user?.name ?? "nobody");

// `dbConnection` is your driver adapter (see DbConnection: query/execute/begin/commit/rollback)
const transactor = Transactor.fromConnection(dbConnection);
const userName = await transactor.run(getUserName(1));
```

Placeholders render Postgres-style (`$1, $2, …`) by default. For MySQL or SQLite pass a
dialect: `Transactor.fromConnection(conn, { dialect: "mysql" })` (renders `?`), or
`fragment.render("sqlite")`.

Identifiers (table/column names) can't be bound as parameters. APIs that take a name as a
string (`Fragment.set`, `inList`, `select(...)`, …) only accept plain identifiers and throw
otherwise; use `Fragment.ident(name)` to quote anything else.

## Documentation

- [SQL guide](https://typesugar.org/guides/sql) — full reference
- [API Reference](https://typesugar.org/reference/packages#sql)

## License

MIT
