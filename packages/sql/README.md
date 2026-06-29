# @typesugar/sql

> 📖 **Full documentation:** [SQL guide](https://typesugar.org/guides/sql). The microsite is the canonical reference; this README is a quickstart.

Doobie-inspired type-safe SQL for TypeScript: composable `sql` fragments, compile-time validation, and `ConnectionIO` for pure database operations.

## Installation

```bash
npm install @typesugar/sql
```

## Quick Start

```typescript
import { sql, ConnectionIO, Transactor } from "@typesugar/sql";

const name = "Alice";
const age = 30;

const query = sql`SELECT * FROM users WHERE name = ${name} AND age > ${age}`;
console.log(query.text); // "SELECT * FROM users WHERE name = $1 AND age > $2"
console.log(query.params); // ["Alice", 30]

const getUser = (id: number) =>
  ConnectionIO.query(sql`SELECT * FROM users WHERE id = ${id}`.toQuery()).map(
    (rows) => rows[0] ?? null
  );

const transactor = new Transactor(dbConnection);
const user = await transactor.run(getUser(1));
```

## Documentation

- [SQL guide](https://typesugar.org/guides/sql) — full reference
- [API Reference](https://typesugar.org/reference/packages#sql)

## License

MIT
