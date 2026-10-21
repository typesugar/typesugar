## SQL group: fix report (docs-guides-c.md C#8, C#10, C#11, C#15, C#16, C#27)

Test file: `/Users/deapovey/src/personal/typesugar/packages/sql/tests/docs-review-fixes.test.ts`. All 20 tests in it pass. Every one of them failed before the fix, except C#8 (see below). `tests/sql.test.ts`, `tests/sql-extended.test.ts`, `tests/review-fixes.test.ts` and `src/__tests__/sql.test.ts` still pass (221 + 60 tests). `tsc --noEmit -p packages/sql` is clean, and dist has been rebuilt.

### Per finding

- **C#8: fixed.** Tests: "C#8 … the doc example runs and all three instances work", "works whatever order Codec appears in", "@derive(Codec) alone…". Read, Write and Codec now share a live registry for the current pass (keyed by MacroContext, then by the target node), so `ReadX`/`WriteX` are each emitted once. Codec also declares `expandAfter: ["Read","Write"]`. My first test passed before the fix because `execute()` transpiles to CJS, which turns the duplicate `export const` into a silent reassignment. I tightened it to count the declarations and type-check the output, and it then failed as expected. Type-checking the output also showed two more strict-mode errors in the derived code, which I fixed:
  - `fields as T` is now `fields as unknown as T` (it was TS2352).
  - `xRegistry.set(name, X as never)` (it was TS2345, because `Write<T>` is not assignable to `Write<unknown>`).
  - Codec now emits `Codec.fromReadWrite<T>(…)`.
  - **Docs should say:** `@derive(Read, Write, Codec)` and `@derive(Codec)` both work. Each produces ReadX, WriteX and CodecX exactly once.
- **C#11: fixed.** Test: "dist/index.d.ts declares toQuery/toUpdate on Fragment for consumers", which type-checks a consumer file against `../dist/index.js`. `toQuery<R>()` and `toUpdate()` are now real methods on the `Fragment` class in `types.ts`. I removed the `declare module "./types.js"` augmentation and the prototype patch from `index.ts`. **Docs:** the existing examples are correct now.
- **C#15: fixed (implemented, not re-tagged).** Tests: the eight "C#15 …" tests.
  - `TypedQuery` now carries `decoder` and `cardinality`:
    - `to(read)` sets the decoder.
    - `map(f)` applies `f` after the decoder, or to the raw row if there is none. A `null` row stays `null`.
    - `unique()` makes the run fail unless exactly one row comes back.
    - `option()` returns `null` for zero rows and fails for more than one.
    - A new `decode(row)` method is public.
  - `ConnectionIO.query`/`queryMany` now take an optional `read`. Without one they use the query's own decoder, or return raw rows.
  - `TypedUpdate.run()` now returns `ConnectionIO<number>`, the same as `ConnectionIO.execute(this)`.
  - `withGeneratedKeys(...cols)` appends ` RETURNING cols` unless the statement already has one. Columns are validated as identifiers, and an empty list throws.
  - Untyped `Query.map(f)` now applies `f` through the same path. `Query` gained `decoder`, `decode()` and `cardinality`. Legacy `SimpleConnectionIO.query(q, decoder?)` behaves the same way.
  - **Docs should say:** build the decoder on the query (`q.to(ReadUser).map(f).unique()`), run it with `ConnectionIO.query(q)` or `ConnectionIO.queryMany(q)` and no Read, and `upd.run()` is a ConnectionIO for the affected-row count.
- **C#16: fixed.** Tests: "the doc example type-checks" and "the record key is used as the field". `DeriveColumn.field` is now optional, because the record key is used as the field. **Docs:** the existing `deriveRead`/`deriveWrite`/`deriveCodec({ id: { meta: Meta.int }, … })` example is correct now.
- **C#27: fixed.** Tests: "sql$`WHERE id = ${0}` is TypedFragment<[number], void>" and "andTyped over mixed literals type-checks in the output". Interpolated types are widened with `checker.getBaseTypeOfLiteralType`, so `${0}`gives`[number]`, `${"x"}` gives `[string]` and `${true}`gives`[boolean]`. **Docs:** the existing claim `// TypedFragment<[number], void>` is true now.
- **C#10: fixed (warning only, as briefed).** Test: "C#10 … decorator form". `schemaMacro` is now an attribute macro on interface, type and class targets. It reports the warning "@schema: schema-based result-type inference is not implemented; this decorator has no effect … Give the row type explicitly instead: sql$<RowType>`...`" and leaves the declaration unchanged. I updated the JSDoc in infer-macro.ts to match. **Docs should say:** schema inference is not implemented, and users should write `sql$<RowType>`.
- **C#19 (finding 7): skipped.** No bug: unbalanced parentheses giving a warning is the intended behaviour.

### Decisions Dean should know about

- If you pass an explicit Read to `ConnectionIO.query`/`queryMany` for a query that already has its own decoder (from `.to()` or `.map()`), it throws a TypeError ("already decodes its rows"). I chose that over silently picking one of the two. `SimpleConnectionIO.query` follows the same rule.
- `TypedUpdate.run()` changed its return type from `TypedUpdate<P>` to `ConnectionIO<number>`, which is a breaking change to the type. `unique()` and `option()` still return `TypedQuery`, with cardinality checked when the query runs.
- connection-io.ts now imports `TypedQuery`/`TypedUpdate` type-only. Otherwise the new `typed-fragment → connection-io` value import would create a runtime import cycle.

### Needs from other owners

- `packages/transformer-core/src/macro-helpers.ts` `JSDOC_MACRO_TAGS`: add `["schema", "schema"]` so the JSDoc form `/** @schema("users") */` also reaches the warning. Today only the decorator form `@schema("users")`, which is what the docs show, warns. The JSDoc form is still ignored without a message.

### Files changed

- `/Users/deapovey/src/personal/typesugar/packages/sql/src/derive-typeclasses.ts`
- `/Users/deapovey/src/personal/typesugar/packages/sql/src/derive-common.ts`
- `/Users/deapovey/src/personal/typesugar/packages/sql/src/types.ts`
- `/Users/deapovey/src/personal/typesugar/packages/sql/src/index.ts`
- `/Users/deapovey/src/personal/typesugar/packages/sql/src/typed-fragment.ts`
- `/Users/deapovey/src/personal/typesugar/packages/sql/src/connection-io.ts`
- `/Users/deapovey/src/personal/typesugar/packages/sql/src/typeclasses.ts`
- `/Users/deapovey/src/personal/typesugar/packages/sql/src/infer-macro.ts`
- `/Users/deapovey/src/personal/typesugar/packages/sql/tests/docs-review-fixes.test.ts` (new)
- `packages/sql/dist/*` (rebuilt)

All changes use ts.factory. I added no parseStatements or parseExpression calls.

### Left failing

Nothing. No processes are still running.
