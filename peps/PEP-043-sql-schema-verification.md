# PEP-043: Compile-Time SQL Schema Verification

**Status:** Draft
**Date:** 2026-06-10
**Author:** Dean Povey

## Context

`@typesugar/sql` builds typed queries Doobie-style, but the types are asserted by
the user: nothing checks that `users.email` actually exists in the database, or
that it's a `text` and not an `integer`. The query is type-safe against a schema
_the user transcribed by hand_ — drift between the real schema and the TypeScript
declaration is invisible until runtime.

Rust's sqlx proved the better model: verify queries against the _actual schema_
at compile time. typesugar has the machinery to do this — `comptime` can read
files (and, with explicit capability, talk to a dev database) during compilation,
and the diagnostics system can point at the exact column reference that's wrong.

## Proposal

### Schema sources (in order of preference)

1. **Schema snapshot file** (default, hermetic): `typesugar.sql.json` (or `.sql`
   DDL) checked into the repo. Generated/refreshed by a CLI:
   `typesugar sql pull --url $DATABASE_URL`. Builds never touch the network.
2. **Live introspection** (opt-in, dev only): `sql: { url: env(...) }` in
   `.typesugar.config.ts`; the macro introspects `information_schema` at build
   time and caches the result in `.typesugar-cache/`. CI uses the snapshot.

The snapshot-first design keeps builds deterministic and sidesteps the security
review's concerns about compile-time I/O (SECURITY-REVIEW F3/F4): live
introspection is an explicit, named capability in config, never a default.

### What gets verified

For the existing typed DSL:

- Table and column existence; column type compatibility with the declared
  TypeScript row type (per-dialect type mapping table, Postgres first).
- Nullability: a `string` field mapped to a nullable column is a diagnostic
  ("did you mean `string | null`?" with a suggested fix).
- `@column` JSDoc mappings (closing the existing TODO at
  `packages/sql/src/derive-meta.ts:181`).

For raw queries, a new checked tagged template:

```typescript
const rows = await sql.checked`
  SELECT id, email FROM users WHERE created_at > ${since}
`;
// rows: { id: number; email: string }[]  ← inferred from the schema
```

The macro parses the SQL at compile time (reuse `@typesugar/parser`'s PEG
machinery for a pragmatic SELECT/INSERT/UPDATE/DELETE subset — not a full SQL
grammar), resolves the projection against the schema, **infers the row type**,
and type-checks the parameter interpolations. Unparseable statements fall back to
unchecked with a diagnostic, never a hard error.

### Diagnostics

```
error[sql001]: column `emial` does not exist on table `users`
  --> src/queries.ts:14:27
   |
14 |   SELECT id, emial FROM users
   |              ^^^^^ did you mean `email`?
   |
   = note: schema snapshot: typesugar.sql.json (pulled 2026-06-01)
```

Stale-snapshot detection: a hash of the snapshot is embedded in the cache key, so
`sql pull` invalidates all cached verifications.

## Implementation Plan

- **Wave 1 — snapshot format + `sql pull`** (Postgres via `pg`, dev-dependency
  only), schema registry available to macros.
- **Wave 2 — DSL verification**: table/column/type/nullability checks on the
  existing query builder; `@column` JSDoc support.
- **Wave 3 — `sql.checked` template**: SQL subset parser, projection → row type
  inference, parameter type checking.
- **Wave 4 — dialects**: MySQL, SQLite. Each is a type-mapping table + introspection
  query, not new architecture.

## Open Questions

1. Row-type inference (Wave 3) generates a _type_ at the call site — this needs
   type macros (PEP-012, Done) in expression position. Verify the language
   service surfaces the inferred type in hover; if not, this couples to PEP-034
   follow-ups.
2. Views, CTEs, and joins in `sql.checked`: joins are required for credibility;
   CTEs can be a fast-follow; views come free if introspection includes them.
3. Migrations interplay: should `sql pull` warn when the snapshot is older than
   the newest file in `migrations/`? Cheap heuristic, high value — recommended.
