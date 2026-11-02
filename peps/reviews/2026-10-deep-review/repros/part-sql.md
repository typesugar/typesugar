# Findings: packages/sql/src

Repro scripts: /private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/review/sql1.mjs, sql2.mjs, sql3.mjs (run against packages/sql/dist). I could not get an end-to-end transformCode run to expand `sql` (or `units`) in a small harness, so the macro-output findings rest on reading the codegen, not on transformed output.

### 1. `ConnectionIO.flatMap` is a stub that ignores `f`, so every monadic combinator returns `undefined`
- Severity: critical
- Confidence: confirmed (repro'd)
- Location: packages/sql/src/connection-io.ts:158-165
- Problem: `flatMap(f)` returns `new ConnectionIO({ _tag: "Pure", value: undefined })` and never stores `f`. The `ConnectionOp` algebra has no FlatMap node, and `Transactor.interpret` has no case for one. `map`, `ap`, `zip`, `zipLeft`, `zipRight`, `chain`, `andThen`, `sequence`, `traverse`, `parZip`, `parSequence` and `unfold` are all built on `flatMap`, so all of them are broken. The source operation is also dropped and never runs.
- Failure scenario: `xa.run(ConnectionIO.pure(2).map(x => x*10))` gives `undefined`. `xa.run(ConnectionIO.execute(upd).map(n => n+1))` gives `undefined` and never calls `conn.execute` at all, so the write is silently lost. `sequence([pure(1), pure(2)])` gives `undefined`. The tests only check `toBeInstanceOf(ConnectionIO)`. `tests/sql-extended.test.ts:229` even documents "the stub flatMap returns Pure(undefined)".
- Suggested fix: add `{ _tag: "FlatMap"; source: ConnectionIO<unknown>; f: (a: unknown) => ConnectionIO<A> }` to `ConnectionOp`, have `flatMap` build it, and add `case "FlatMap": return this.interpret(op.f(await this.interpret(op.source, conn)), conn)`. Make it stack-safe with a loop or trampoline, because `sequence`/`unfold` build long chains.
- Fix size: M

### 2. `sql$` emits params as `{ value: expr }` objects, which no consumer of `TypedFragment` understands
- Severity: high
- Confidence: high (codegen read, runtime shape repro'd)
- Location: packages/sql/src/infer-macro.ts:331-341
- Problem: `createTypedFragmentCall` emits `new TypedFragment<P,R>(segs, [{ value: e0 }, ...])`. But `TypedFragment.params` is `SqlParam[]`, and `toSql()`, `.query`, `Transactor` and every typed combinator pass `params` straight to the driver. Only `SelectBuilder.where` (query-builder.ts:40) expects `{value}`. Unlike `sql``, `sql$` also does not inline Fragment/TypedFragment interpolations, so `sql$`SELECT ... ${whereFrag}`` binds the fragment object as a parameter.
- Failure scenario: `ConnectionIO.query(sql$`SELECT * FROM users WHERE id = ${5}`.toQuery(), R)` sends `params = [{ value: 5 }]` to the driver. Repro: `new TypedFragment(["... id = ",""],[{value:5}]).toQuery().toSql()` gives `params: [ { value: 5 } ]`. No test exercises `sql$` expansion.
- Suggested fix: emit `[e0, e1, ...]` directly (or call a runtime helper that inlines fragment interpolations, as `__sql_build` does), and change `SelectBuilder.where` to accept a `TypedFragment`/`Fragment`.
- Fix size: S

### 3. Typed combinators break the segments/params invariant, so `.query` drops params and emits `?` mixed with `$n`
- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/sql/src/typed-fragment.ts:337-347 (inListTyped), 362-366 (valuesTyped), 371-389 (valuesManyTyped), 403-421 (setTyped)
- Problem: these build a single segment that already contains `?` placeholders (`["id IN (?, ?, ?)"]`) plus N params. Everywhere else, `Fragment`/`TypedFragment` assume `segments.length === params.length + 1`. `TypedFragment.query` delegates to `Fragment.query`, which iterates segments, so it appends `$1` after the text and drops the remaining params. Composition through `append`/`intercalateTyped`/`whereAndTyped` then misaligns the params.
- Failure scenario: `inListTyped("id",[1,2,3]).query` gives `{ text: 'id IN (?, ?, ?)$1', params: [1] }`. `whereAndTyped(inListTyped("id",[1,2,3]), eq).query` gives `'WHERE id IN (?, ?, ?) AND name = $1$2', params [1,2]`, so two params are lost and the placeholders are mixed. `toFragment()` into `sql`` composition has the same problem.
- Suggested fix: build these with real segments, e.g. inList: `[`${col} IN (`, ", ", ..., ")"]` with N params, and similarly for values/set, as `Fragment.inList`/`Fragment.values` already do.
- Fix size: S

### 4. Macro output references runtime identifiers it never imports; `registerInstanceMethods` is not exported at all
- Severity: high
- Confidence: high (static; `registerInstanceMethods` confirmed module-private)
- Location: packages/sql/src/macro.ts:124,155 (`Fragment`, `__sql_build`); infer-macro.ts:327,343 (`TypedFragment`, `SqlRow`); derive-typeclasses.ts:300,327-331,341-345,436,447-451,460-464,511 (`Get`/`Put`/`Read`/`Write`/`Codec`/`readRegistry`/`writeRegistry`); derive-meta.ts:220-226,247-249,411 (`stringMeta`, `nullable`, `registerInstanceMethods`, ...)
- Problem: generated code uses bare `createIdentifier` names. `MacroContext.ensureImport(symbol, from)` exists for this (core/src/types.ts:193), but the sql macros don't use it, and macro.ts:135 says "Users must import it". `@derive(Meta)` output calls `registerInstanceMethods(...)`. That function is a private no-op in meta.ts:44, not exported from any entry, so the expansion throws `ReferenceError` at module load even if the user imports everything.
- Failure scenario: the README quick start imports only `sql`. Once the macro fires, `sql`SELECT ... ${id}`` becomes `__sql_build([...],[id])`, which fails with `ReferenceError: __sql_build is not defined`. `@derive(Read)` with only `Read` imported fails with ReferenceError on `Get` / `readRegistry`.
- Suggested fix: replace each bare runtime identifier with `ctx.ensureImport("<name>", "@typesugar/sql")`. Drop the `registerInstanceMethods` statement from derive-meta (see #12).
- Fix size: S

### 5. The documented quick start (README + guide) fails at runtime in three separate ways
- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/sql/README.md:24-31; docs/guides/sql.md:41-61, 624-633; packages/sql/src/index.ts:28-43
- Problem: (a) `ConnectionIO.query(sql`...`.toQuery())`: the exported `ConnectionIO` is the typed one and expects a `TypedQuery` + `Read`, but `Fragment.toQuery()` returns an untyped `Query`, which has no `toSql`. (b) `new Transactor(dbConnection)`: the exported `Transactor` takes `(getConnection, release)` functions. (c) `.map(...)` and the static `ConnectionIO.flatMap(a, f)` (guide:630) are, respectively, the stub from #1 and absent on the exported class; only `SimpleConnectionIO` has a static `flatMap`. The docs also import `sqlKind` (and `sql$`) from `@typesugar/sql`. `sqlKind` does not exist anywhere, and `sql$` is not declared in dist/index.d.ts, so the import is a TS2305 error.
- Failure scenario: running the README verbatim gives `op.query.toSql is not a function`, then `this.getConnection is not a function`.
- Suggested fix: make `Fragment` interoperate with the typed API (e.g. `Fragment.toTypedQuery<R>()`), or rewrite the docs against `SimpleConnectionIO`/`SimpleTransactor`. Remove `sqlKind`, or add it as an alias of `sql$`. Add a runtime/ambient declaration for `sql$` (as for `sql`).
- Fix size: M

### 6. The documented `@column("created_at")` JSDoc form yields column name `(created_at)` / `("created_at")`
- Severity: medium
- Confidence: confirmed (repro'd TS JSDoc parsing)
- Location: packages/sql/src/derive-typeclasses.ts:205-219; packages/sql/src/derive-meta.ts:173-181
- Problem: for `/** @column("created_at") */`, the TS JSDoc tag `comment` is `("created_at")`. derive-typeclasses strips the quotes and keeps the parens, giving `(created_at)`. derive-meta keeps everything and then does `createIdentifier('("created_at")')` for `row.<col>`, which prints invalid JS. The derive-typeclasses module docs (lines 15-18) use exactly this form.
- Failure scenario: `@derive(Read)` with `/** @column("created_at") */ createdAt: Date` reads `row["(created_at)"]`, which is always undefined. With #7 that becomes silent garbage (for a string field it is the literal `"undefined"`).
- Suggested fix: parse `^\(?\s*["']?([^"')]+)["']?\s*\)?$`. In derive-meta use `createElementAccessExpression(row, createStringLiteral(col))`, not an identifier.
- Fix size: S

### 7. Get/Meta primitives turn a missing column (`undefined`) into `"undefined"` / `NaN` instead of NULL or an error
- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/sql/src/typeclasses.ts:149-157; packages/sql/src/meta.ts (stringMeta/numberMeta, ~line 213-225)
- Problem: the decoders check only `v === null`, so `undefined` falls into `String(v)` / `Number(v)`. `Read.make` reads `row[column]` with no presence check, and `Get.nullable` passes `undefined` through to the inner decoder.
- Failure scenario: a column-name mismatch (snake_case or #6) gives `Read.read({created_at:"2020"})` returning `{ createdAt: 'undefined' }`. A number field gives `NaN`. Both pass through `unsafeRead` without throwing. `Get.number.get("abc")` is also `NaN`.
- Suggested fix: treat `v === null || v === undefined` as NULL in every primitive decoder. Return null (not NaN) when `Number(v)` is NaN. Optionally make `Read.make` throw or return null when `!(column in row)`.
- Fix size: S

### 8. `orTyped` does not parenthesize, so `andTyped(orTyped(a,b), c)` gets the wrong precedence
- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/sql/src/typed-fragment.ts:308-312
- Problem: the untyped `Fragment.or` wraps its result in parens (types.ts:139-141); the typed version does not.
- Failure scenario: `andTyped(orTyped(a=1, b=2), c=3)` gives `a = $1 OR b = $2 AND c = $3`, which SQL evaluates as `a OR (b AND c)`. That is a wrong filter and a possible data leak or overly broad DELETE.
- Suggested fix: `return intercalateTyped(...).parens()` (and do the same for single-element input or not, to match `Fragment.or`).
- Fix size: S

### 9. `setTyped(meta, partial)` crashes on omitted Date/bigint fields and writes NULL for omitted optional fields
- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/sql/src/typed-fragment.ts:403-421
- Problem: it calls `meta.write(value as A)` on a `Partial<A>`, so every extractor runs on `undefined`. `Put.date.put(undefined)` throws, and so does `Put.bigint`. `Put.optional` maps `undefined` to `null`, which passes the `!== undefined` filter.
- Failure scenario: `setTyped(WriteUser, { name: "Bob" })` throws `Cannot read properties of undefined (reading 'toISOString')` when User has a Date column. With an optional `nickname`, it produces `name = ?, nickname = ?` with `[Bob, null]`, which wipes the column.
- Suggested fix: iterate `meta.columns` alongside the field names, skip fields where `value[field] === undefined` before calling the extractor. This needs Write to expose its field names or a per-field extractor.
- Fix size: M

### 10. Placeholder dialect is inconsistent: the typed Transactor sends `?` while Fragment, README and guide render `$n`
- Severity: medium
- Confidence: high
- Location: packages/sql/src/typed-fragment.ts:173-178, 228-233 (`toSql` joins with `?`); connection-io.ts:443-468 (Transactor uses `toSql`); types.ts:64-87 (`$n`)
- Problem: there is no dialect option. `TypedQuery.toSql()` produces `?` (MySQL/SQLite), but `TypedFragment.query` and `Fragment.query` produce `$n` (Postgres). The exported Transactor always uses `toSql`. The guide's examples are Postgres-style.
- Failure scenario: a node-postgres user running `ConnectionIO.query(typedQ, R)` through `Transactor` sends `WHERE id = ?`, and Postgres rejects it with a syntax error.
- Suggested fix: add a `placeholder` / dialect option on Transactor (or on `DbConnection`) and render through a single function; make `toSql` and `query` share it.
- Fix size: M

### 11. No identifier quoting anywhere; column/table names are concatenated raw (SQL injection via identifiers)
- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/sql/src/types.ts:186 (`inList` column), 213-218 (`Fragment.set` keys); typed-fragment.ts:346 (inListTyped), 414; query-builder.ts:35-67,82-104 (`from`, `join`, `orderBy`, columns); connection-io.ts:452-455 (RETURNING columns; also its `includes("RETURNING")` check is case-sensitive)
- Problem: values are parameterized, but every identifier-taking API interpolates raw strings, and the package offers no `Fragment.ident` / quoting helper or validation. The red-team tests cover only value injection.
- Failure scenario: `Fragment.set(req.body)` with key `"name = 'x' --"` renders `SET name = 'x' -- = $1`. `select(...).orderBy(req.query.sort)` is injectable in the same way.
- Suggested fix: add `Fragment.ident(name)` (dialect-aware `"..."` quoting with doubled quotes). Use it or validate `/^[A-Za-z_][A-Za-z0-9_.]*$/` in `set`/`inList`/`inListTyped`/the builder, and document that identifiers are not parameterized.
- Fix size: M

### 12. CLAUDE.md AST rule: unlisted `ctx.parseExpression` call sites, plus string codegen hidden in identifiers
- Severity: medium
- Confidence: confirmed
- Location: packages/sql/src/derive-typeclasses.ts:300, 436; derive-meta.ts:220-226, 241-246, 405-433
- Problem: derive-typeclasses builds `"Get.nullable(Get.string)"` strings and calls `ctx.parseExpression`. Neither call site is in CLAUDE.md's exhaustive exception list. derive-meta avoids the parser by putting whole expressions into `factory.createIdentifier("nullable(stringMeta)")` (the printer emits identifier text verbatim), which is the same string codegen in disguise. It also emits a `.source`-string DictMethod via `registerInstanceMethods`. CLAUDE.md says nothing should produce that shape any more (PEP-052 Wave 7). The string itself is wrong too: `JSON.stringify` turns `${row.x}` into a quoted string literal, so the "specialized" read would return literal strings. auto-derive-strategies.ts also returns string code, but it is never imported (dead).
- Failure scenario: a review gap per CLAUDE.md. Concretely, the derive-meta `source` would inline `{"id":"${row.id}"}` if anything consumed it.
- Suggested fix: build `Get.nullable(Get.string)` as nested `createCallExpression(createPropertyAccessExpression(...))`. A small recursive `{ctor, args}` descriptor in place of strings works for all three derive files. Delete the `registerInstanceMethods` emission and the dead auto-derive-strategies.ts, or add CLAUDE.md entries.
- Fix size: M

### 13. Derives reject `boolean | null`, string-literal unions and enums
- Severity: medium
- Confidence: high (logic traced; TS represents `boolean` as `true | false`)
- Location: packages/sql/src/derive-typeclasses.ts:65-98, 106-139, 147-180; derive-meta.ts:95-131
- Problem: the union branch requires exactly one non-null member. `boolean | null` is `true | false | null`, which has two. `"a" | "b"` members carry StringLiteral flags, not String, so they also fail the primitive checks. Enums fail similarly.
- Failure scenario: `@derive(Read) interface U { isActive: boolean | null }` gives "Cannot derive Read for field 'isActive': unsupported type 'boolean | null'". Nullable boolean columns are very common.
- Suggested fix: after removing null/undefined, treat "all BooleanLiteral" as boolean. Map StringLiteral/NumberLiteral/enum-literal unions to string/number (or check `typeChecker.getBaseTypeOfLiteralType`).
- Fix size: S

### 14. `@derive(Meta)` is wired as an attribute macro named `derive`, not as a derive, so it goes through the "Unknown derive" error path
- Severity: medium
- Confidence: medium (dispatch traced in transformer-core; not run end-to-end)
- Location: packages/sql/src/derive-meta.ts:270-272; interacts with transformer-core/src/transformer.ts:1497-1510 and macro-helpers.ts:613-626
- Problem: PEP-032 removed the `derive` attribute macro, and `@derive(X)` now dispatches to `globalRegistry.getDerive(X)`. No derive or GenericDerivation named `Meta` exists, so `expandDeriveDecorator` reports `Unknown derive: 'Meta'` and only then falls through to the sql attribute macro. In `@derive(Meta, Eq)`, Eq succeeds, so the fall-through never happens: Meta is silently dropped, yet the error is still reported. The JSDoc `@derive` path does not fall through at all. The guide documents `@deriving(Meta)`.
- Failure scenario: `@derive(Meta) interface User {...}` reports an error diagnostic even when it does expand. Mixed derive lists lose Meta.
- Suggested fix: re-register it as `defineDeriveMacro({ name: "Meta", ... })` using `DeriveTypeInfo` (like Read/Write/Codec), or fold it into `Codec`.
- Fix size: M

### 15. `SimpleTransactor` returns `rows.length` as the affected-row count
- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/sql/src/types.ts:398-402
- Problem: `UpdateIO` returns `result.rows.length`. For pg, `UPDATE`/`DELETE` without RETURNING has `rows = []`; the count is in `rowCount`, which `DbConnection` does not model.
- Failure scenario: an UPDATE affecting 7 rows reports `0` (repro: `affected: 0` with `rowCount: 7`).
- Suggested fix: add `rowCount?: number` to `DbConnection`'s result and return `rowCount ?? rows.length`.
- Fix size: S

### 16. Nested-fragment renumbering regex rewrites `$N` inside string literals
- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/sql/src/types.ts:74-77
- Problem: when a Fragment sits in `params`, `.query` renumbers with `/\$(\d+)/g` over the nested rendered text. That also hits `$1` inside quoted literals, comments and dollar-quoted bodies. Reachable via the public `new Fragment(segs, [frag])` (the `sql`` path inlines instead).
- Failure scenario: a nested `note = 'costs $1'` becomes `'costs $2'`.
- Suggested fix: render nested fragments recursively with an offset parameter instead of regex-rewriting text, or flatten nested fragments in the constructor.
- Fix size: S

### 17. `Get.array` drops NULL elements, and `Get.number` silently loses precision on int8/numeric strings
- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/sql/src/typeclasses.ts:152-155, 275-291
- Problem: `Get.array(Get.number).get([1,null,3])` returns `[1,3]`, which changes length and indices. `Get.number.get("12345678901234567891")` returns `12345678901234567000` with no warning. pg returns BIGINT and NUMERIC as strings by default.
- Failure scenario: positional array data shifts; ids above 2^53 are corrupted silently.
- Suggested fix: keep nulls (type `Get<(A|null)[]>`), or fail the decode. In `Get.number`, reject non-safe integers parsed from strings, or point users to `Get.bigint`.
- Fix size: S

### 18. `sql$` calls the checker on interpolations without an `isSyntheticNode` guard, and non-null-asserts `typeToTypeNode`
- Severity: low
- Confidence: high (static)
- Location: packages/sql/src/infer-macro.ts:280-285, 310-312
- Problem: `typeChecker.getTypeAtLocation(span.expression)` runs with no synthetic check (the CLAUDE.md rule), so a `sql$` produced by another macro could throw the `start < 0` crash. `typeToTypeNode(...)!` can return undefined, which leaves an undefined element in the tuple and crashes the printer.
- Failure scenario: a macro that expands to `sql$`...${x}`` throws inside the checker. The error surfaces only as "Tagged template macro expansion failed".
- Suggested fix: when `isSyntheticNode(span.expression)` is true, use `unknown` with a one-line warning; fall back to `unknown` when `typeToTypeNode` returns undefined.
- Fix size: S

## 1.0 gaps
- PEP-048 tiers sql as "Keep — Wedge" justified only by PEP-043 (compile-time schema verification), and PEP-043 is still **Draft**. The package is at 0.1.1 with no stability banner, while its core monad (#1) and typed macro (#2) do not work.
- `@schema` (infer-macro.ts:390-400) is a no-op expression macro, and nothing ever calls `registerSchema`. The documented schema-based result-type inference (`SELECT *` gives `UsersTable`) cannot fire.
- `sql$` has no runtime or ambient declaration in dist/index.d.ts, and the documented `sqlKind<...>` macro does not exist.
- Two parallel, overlapping typeclass APIs ship in the same entry: `meta.ts` (exported as Legacy* types plus `stringMeta`/`nullable`/...) and `typeclasses.ts` (`Get`/`Put`/`Meta`/`Read`). The typed `ConnectionIO` imports the legacy `Read`. Pick one before 1.0.
- Two ConnectionIO/Transactor implementations (`SimpleConnectionIO`/`SimpleTransactor` vs `ConnectionIO`/`Transactor`) have incompatible `DbConnection` shapes. The docs mix them.
- `parZip`/`parSequence` are documented as parallel but are sequential, and `ConnectionIO.async` is a `Delay` alias.
- `TypedQuery.unique()`/`option()`/`to()` and `TypedUpdate.run()`/`withGeneratedKeys` are type-only no-ops. `unique()` does not enforce exactly one row.
- `auto-derive-strategies.ts` is dead code (never imported); summon-based auto-derivation of Read/Write/Codec is documented in its header but not wired.
- There are no tests of any macro expansion in packages/sql (`sql`, `sql$`, `@derive(Meta)`, `@derive(Read/Write/Codec)`). Every runtime test calls the helpers directly, which is how #2, #4 and #14 went unnoticed.
- `validateSqlSyntax` (macro-utils.ts) is exported but unused. It counts parens inside string literals (`SELECT ')'` raises a hard error), and its "injection pattern" warnings are cosmetic.
