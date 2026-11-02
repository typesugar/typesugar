## guides-c review: findings (most severe first)

Scope: the 14 pages under `docs/guides/` assigned to guides-c. I kept to the brief: the repo was read-only, I ran one helper at a time, and I added single-file `tsc --noEmit` checks (about 270 MB each) on the helper's copied files under `.typesugar/doc-examples/`. Scratch files are in /private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/docrev/guides-c/

**Helper caveat for validate:** the transformer's macro loader resolves packages from its own location, so `@typesugar/validate` macros never load in this monorepo. I checked validate examples with `node --import packages/validate/dist/macros.js doc-example.mjs ...`.

**Helper caveat for type errors:** `strictOutput` does not report type errors against package `.d.ts` types. That is why I used `tsc` for those.

### 1. zero-cost.md's "zero-allocation" Option example crashes at runtime: the macro emits an import path that does not exist

- Severity: high
- Location: docs/guides/zero-cost.md:88-103. The bug is in `subpathFor()` at packages/transformer-core/src/dts-opaque-discovery.ts:142-149, which computes the subpath relative to the dir of the module the user imported, not the package entry.
- Problem: the page says the output is real `typesugar expand` output. When you import from `@typesugar/fp/data/option`, the rewrite adds `import { getOrElse, map } from "@typesugar/fp/option"`. That path does not exist.
- Evidence: the output contains `import { getOrElse, map } from "@typesugar/fp/option";` and the run fails with `ERR_MODULE_NOT_FOUND ... @typesugar/fp/dist/option.js`. Importing `{ Some, type Option } from "@typesugar/fp"` emits `@typesugar/fp/data/option`, which works and prints 84.
- Suggested fix: fix `subpathFor` so it computes relative to the package's real entry. Until then, change the example to `import { Some, type Option } from "@typesugar/fp";`.

### 2. zero-cost.md's derive/operator example leaves `===` unrewritten

- Severity: high
- Location: docs/guides/zero-cost.md:42-77
- Problem: the page says `a === b` compiles to `Point.Eq.equals(a, b)`. In real output `a === b` stays reference equality and the program prints `false`. The output shown is also not the real output: the real one has a `namespace Point { export const Eq = { equals: (a, b) => a.x === b.x && ..., notEquals } }` with no `Eq.number.equals`. Operator rewriting only happens if you import `@typesugar/std/syntax/eq/ops` (PEP-052). With that import, the same code prints `true`.
- Suggested fix: add `import "@typesugar/std/syntax/eq/ops";` and `import { derive } from "typesugar";` to "You write", then paste the real `expand --js` output.

### 3. std-typeclasses.md quick start is false from start to finish

- Severity: high
- Location: docs/guides/std-typeclasses.md:11-27, 35-68
- Problem: the page says "Typeclasses are auto-derived for your types", that `p1 === p2` is true and that `p1.show()` returns "Point(x = 1, y = 2)". In fact nothing is auto-derived (typeclasses.md:132 says so explicitly). The run prints `false` and `false`, then `TypeError: p1.show is not a function`. `===` and `+` need `@derive` plus the `.../syntax/<tc>/ops` markers. std ships no Show syntax marker.
- Evidence: with `/** @derive(Eq, Ord, Show) */` and `import "@typesugar/std/syntax/eq/ops"`, `p1 === p2` gives true and `Point.Show.show(p1)` gives "Point(x = 1, y = 2)".
- Suggested fix: rewrite the example with `@derive(Eq, Ord, Show)`, the `syntax/eq/ops` and `syntax/ord/ops` imports, and `summon<Show<Point>>().show(p1)` (or `Point.Show.show`). Remove "auto-derived" and the claim that `===` compiles to `User.Eq.equals(user1, user2)` unless the marker is shown.

### 4. typeclasses.md: the bare `@instance` decorator on a const is a macro error

- Severity: high
- Location: docs/guides/typeclasses.md:66-79 (Creating Instances), 257-276 (Semigroup/Monoid), 599-603 (Coherence)
- Evidence: `[error] @impl requires arguments: @impl("Type"), @impl("Typeclass<Type>"), or @impl(Typeclass, Type)` on every `@instance const ShowNumber: Show<number> = ...`. With `/** @impl Show<number> */` the same code works and prints 42 and "hello".
- Suggested fix: use `/** @impl Show<number> */ const ShowNumber: Show<number> = {...}` throughout.

### 5. typeclasses.md: "Generic Functions" and "For Generics" examples fail with TS9001

- Severity: high
- Location: docs/guides/typeclasses.md:92-101, 143-154
- Evidence (generic default): `function print<A>(value: A, S: Show<A> = summon<Show<A>>())` gives `[TS9001] No instance found for Show<A>`, and the run throws "summon() must be processed...".
- Evidence (generic instance): `/** @impl Show<A[]> */ function ShowArray<A>(SA: Show<A>)` followed by `summon<Show<number[]>>()` gives `[TS9001] No instance found for Show<number[]>`. The bare `@instance` form errors as in finding 4.
- Note: the `= implicit()` version of `print` does work (prints 42, "hello", #42).
- Suggested fix: delete the `= summon<Show<A>>()` example and point to `= implicit()`. Remove the generic-instance example or mark it unsupported (PEP-059 P1 item 12).

### 6. typeclasses.md: `summon<Functor<Array>>()` silently resolves to the Option instance and returns NaN

- Severity: high (silent wrong output, an engine bug)
- Location: docs/guides/typeclasses.md:556-559
- Problem: the doc says the result is `[2, 4, 6]`. The output is `optionFunctor.map([1, 2, 3], (x) => x * 2)` and it prints `NaN`, with no diagnostic. This used the page's own HKT example in the same file.
- Suggested fix: file it as an engine bug. In the doc, drop the Array line or declare an Array instance.

### 7. units.md: operator syntax does nothing; `d1 + d2` concatenates strings

- Severity: high
- Location: docs/guides/units.md:33-49 and 210-222 ("Typeclass Integration")
- Problem: there is no `@op` anywhere in packages/units/src (grep returns nothing), so the "Typeclass Integration" table is false. `d1 + d2`, `d1 - d2` and `d1 / t` are left as they are.
- Evidence: the run prints `100 m50 m`, `NaN`, `NaN`, and `d1 === meters(100)` is `false`.
- Suggested fix: remove the operator section and table, or ship `@op` support. Document only `.add`/`.sub`/`.mul`/`.div`, which do type-check: `d1.add(t)` is TS2345.

### 8. sql.md: `@derive(Read, Write, Codec)` emits duplicate declarations and the module throws SyntaxError

- Severity: high
- Location: docs/guides/sql.md:552-557 (Read/Write/Codec derive example)
- Evidence: `@derive(Codec)` re-emits `ReadAcct` and `WriteAcct`, so the output has `export const ReadAcct` twice and the run fails with `SyntaxError: Identifier 'ReadAcct' has already been declared`.
- Suggested fix: document `/** @derive(Codec) */` alone, which generates `ReadX`, `WriteX` and `CodecX`, or fix Codec derivation so it does not re-emit Read and Write.

### 9. sql.md: the "Zero-Cost Guarantee" is false; ConnectionIO is a runtime free monad and nothing specialises it

- Severity: high
- Location: docs/guides/sql.md:1021-1039. Also the feature bullet at line 13: "all typeclass overhead compiles away".
- Evidence: transformer output keeps `ConnectionIO.query(findUser(1).toQuery(), ReadUser).flatMap(...)` unchanged. `Transactor.interpret` (connection-io.ts:466-482) walks the `FlatMap` nodes at runtime.
- Suggested fix: delete the section and the bullet. Say instead that "ConnectionIO programs are data interpreted by the Transactor at runtime".

### 10. sql.md: `@schema` / `registerSchema` schema inference does not exist in the runtime package

- Severity: high
- Location: docs/guides/sql.md:324-349
- Problem: `registerSchema` is exported only from `@typesugar/sql/macros`, so importing it from the root fails: `SyntaxError: The requested module '@typesugar/sql' does not provide an export named 'registerSchema'`. `@schema` is stripped silently. `SELECT *` and `SELECT id, name` both infer `Record<string, unknown>`, not `UsersTable` or `Pick<...>`. PEP-059 P1 item 14 already notes "`@schema` is a no-op".
- Suggested fix: remove the section, or mark it "planned".

### 11. sql.md: `sql\`...\`.toQuery()`/`.toUpdate()` are type errors for every consumer (packaging bug)

- Severity: high
- Location: docs/guides/sql.md:133-142, 671-673, 718-721. The cause is packages/sql/dist/index.d.ts:1632, `declare module "./types.js" { interface Fragment { toQuery... } }`. dist has no `types.d.ts`, so the augmentation applies to nothing.
- Evidence: `tsc` gives `TS2551: Property 'toQuery' does not exist on type 'Fragment'. Did you mean 'query'?`. It works at runtime.
- Suggested fix: move the augmentation into the module that declares `Fragment`, or add the methods to the class.

### 12. type-system.md: `wrap<UserId>(42)` (the quick-start example) is a type error

- Severity: high
- Location: docs/guides/type-system.md:16-20, 79-101. The cause is packages/type-system/src/newtype.ts:79: `UnwrapNewtype<T> = T extends Newtype<infer Base, string> ? Base : T` infers the whole branded type as `Base`.
- Evidence: a standalone probe with the same three types fails: `Type 'number' is not assignable to type 'number & { readonly [__brand]: "UserId" }'`. `tsc` on the example reports TS2345 for `wrap<UserId>(42)`, `mkUserId(42)`, `mkEmail("a@b")` and `calculateArea(wrap<Meters>(10), ...)`. The expanded output fails too: `strictOutput: Argument of type 'number' is not assignable to parameter of type 'Meters'` at `calculateArea(10, 5)`.
- Suggested fix: fix `UnwrapNewtype`, for example `T extends infer B & { readonly [__brand]: string } ? B : T`, or derive the base type through a brand-keyed accessor. Then re-check the doc.

### 13. type-safety.md: `strict: true` does not fail the build, but the page sells it as the CI gate

- Severity: high (a CI pipeline built from the page would pass with type errors)
- Location: docs/guides/type-safety.md:120-161, 191. The code is packages/unplugin-typesugar/src/unplugin.ts:284-298, where `buildEnd` only calls `console.error` on the strict diagnostics.
- Suggested fix: either make strict mode fail the build, or say that it reports but does not fail, and remove "With strict mode (no separate tsc step)".

### 14. playground.md describes a playground that does not exist

- Severity: medium
- Location: docs/guides/playground.md:9-18, 57, 137-140
- **Run:** `api/run.ts` always returns 403, and Playground.vue:657-667 shows "Run is not available on the public playground". So "Run the output", "your code executes with real @typesugar/fp..." and "All examples are runnable" are false.
- **Where the transform runs:** it is not "in your browser". `doTransform` POSTs to `/api/compile`.
- **comptime:** it is disabled on `/api/compile` (`setComptimeEvaluationEnabled(false)`), but the page lists `comptime` as usable.
- **Cmd/Ctrl+S:** it runs `copyShareUrl()` (Playground.vue:921-923), not Transform.
- **Lower-impact details:** the examples table omits the effect, math, testing and validate groups, which exist in docs/examples, and the core examples cfg, operators and specialize. That also contradicts line 38's "math/testing/effect excluded".
- Suggested fix: say that transform runs server-side with comptime off, that Run is unavailable on the public site (use `npx typesugar run`), and that Cmd+S copies the share URL.

### 15. sql.md: TypedQuery/TypedUpdate methods are no-op casts; `withGeneratedKeys` adds no RETURNING

- Severity: medium
- Location: docs/guides/sql.md:185-224. The code is packages/sql/src/typed-fragment.ts:192-255.
- Problem: `map(f)` ignores `f`, `to(read)` ignores `read`, and `unique()`, `option()` and `run()` return `this` or a cast. `withGeneratedKeys("id")` returns a TypedQuery whose SQL has no RETURNING; `toSql()` gives `INSERT INTO users (name, email) VALUES ($1, $2)`. The page calls these "Transform result type", "Expect exactly one row", "Execute and return affected count" and "Execute with RETURNING clause". `Query.map(_f)` in types.ts:291 is the same.
- Suggested fix: document them as type-only re-tags, or implement them. Point users to `ConnectionIO.executeWithKeys`, which does append RETURNING.

### 16. sql.md: programmatic `deriveRead` / `deriveWrite` / `deriveCodec` examples don't type-check

- Severity: medium
- Location: docs/guides/sql.md:560-579. The type is `DeriveColumn` at packages/sql/src/typeclasses.ts:982-990, where `readonly field: string` is required.
- Evidence: `TS2741: Property 'field' is missing in type '{ meta: Meta<number>; }' but required in type 'DeriveColumn<number>'`, eight times.
- Suggested fix: make `field` optional, since the key already provides it, or add `field: "id"` and so on to the example.

### 17. sql.md: several ConnectionIO / Queryable / combinator examples are wrong

- Severity: medium
- Location: docs/guides/sql.md
- **`ap` (line 779):** `ConnectionIO.pure((u: User) => u.name).ap(findUser(userId))` has the arguments reversed. The signature is `fa.ap(ff)` (connection-io.ts:162) and tsc gives TS2345. Correct form: `findUser(id).ap(ConnectionIO.pure(...))`. The input is `User | null`, so the function must accept null.
- **Queryable literals (lines 818-823, 950-955, 966-971):** they lack `_tag: "Queryable"`, which the interface requires (queryable.ts:5), so tsc gives TS2741. `Queryable` is only exported as a type. Use `QueryableCompanion.make(execute)`.
- **`unfold` (lines 864-869):** `ConnectionIO.query` returns one row or null, so `results.length` fails with TS18047/TS2339. Use `queryMany`.
- **`Write.tuple(WriteUser, WriteProfile)` (line 535):** TS2345, because `Write<User>` is not assignable to `Write<unknown>` (Write is contravariant).
- **`Transactor.fromPool({ ..., release: (conn) => conn.release() })` (lines 901-904):** `DbConnection` has no `release()`.
- **"parZip/parSequence (potentially in parallel)":** they are always sequential (connection-io.ts:617-628).

### 18. sql.md: the Kysely/Drizzle "raw fragment" integration passes params that the raw APIs don't accept

- Severity: medium (not run: neither library is installed in the repo)
- Location: docs/guides/sql.md:984-1013
- Problem: as far as I know, both `kysely`'s `sql.raw(sql: string)` and `drizzle-orm`'s `sql.raw(str: string)` take a single string. `fragment.values` would be ignored and the `$1` placeholders left unbound. The page also says this gives "type safety from typesugar/sql's compile-time validation".
- Suggested fix: use Kysely `CompiledQuery.raw(text, params)` / Drizzle's `sql` template, or drop the section.

### 19. sql.md: "SQL Syntax Validation" claims do not hold

- Severity: medium
- Location: docs/guides/sql.md:1006-1012
- Evidence: the unbalanced-parenthesis query gives `[warning] SQL warning: Unbalanced parentheses`, not a compile-time error. `` sql`DELETE FROM users` `` gives no diagnostic at all.
- Suggested fix: change "Compile-time error" to "warning" and remove the DELETE-without-WHERE claim.

### 20. tagged-templates.md: most examples outside SQL are wrong

- Severity: medium
- Location: docs/guides/tagged-templates.md
- **`raw` from `@typesugar/sql` (line 39):** it doesn't exist; runtime check shows `typeof S.raw` is `undefined`. Use `Fragment.raw`.
- **Regex flags (lines 78-79):** ``regex`hello`i`` is not valid TypeScript syntax.
- **Regex interpolation (lines 85-86):** `[error] regex does not support interpolations`.
- **`html` with `raw(trustedHtml)` (line 107):** strings' `raw` is a tagged template that throws "raw`...` was not transformed" when called as a function, and the result would be escaped anyway.
- **Units section (lines 118-130):** `` units`${speed} * ${time}` `` gives `[error] units template literals with substitutions are not yet supported`. `meters.to("km")` is TS2345, because `.to` takes a constructor.
- **`defineTaggedTemplateMacro("myTag", {...})` (line 146):** the real signature is `defineTaggedTemplateMacro({ name, expand })` (core/src/registry.ts:560), and it only returns a definition; it does not register it.
- **`SqlQuery<[number, string]>` (line 178):** no such type; `sql` returns `Fragment`.
- **"Compiled" output (line 170):** it is really `__sql_build([...], [userId])`. Also, `query.text` keeps the template's newlines, unlike the comment at line 20.
- Suggested fix: rewrite the page to match sql.md, strings.md and units.md, which are already correct on most of these points.

### 21. specialize.md: the `= implicit()` example is resolved but not inlined

- Severity: medium
- Location: docs/guides/specialize.md:77-89
- Evidence: the output is `console.log(sortWith([3, 1, 2], numberOrd));` with no hoisted specialization. The explicit call in the same file does get one, `__typesugar___sortWith_number_0__`.
- Suggested fix: say that the instance is filled in but the filled call is not currently specialized, or fix the pipeline order.

### 22. typeclasses.md "Coherence": ambiguity is reported, not "unspecified"

- Severity: medium
- Location: docs/guides/typeclasses.md:589-603, table at 610
- Problem: the page says resolution between two instances is "unspecified". Two `@impl Show<number>` in scope plus a `summon` gives `[error] Ambiguous Show instance for 'number': ShowNumber, ShowNumber2 are all in scope. Keep exactly one in scope, or pass the instance explicitly.` The declarations alone compile silently, which is correct as written.
- Suggested fix: state both halves: declarations aren't checked, but call-site resolution errors on ambiguity.

### 23. testing.md: the quick-start `staticAssert` examples fail

- Severity: medium
- Location: docs/guides/testing.md:28, 66
- **`staticAssert(CONFIG.TIMEOUT > 0, ...)`:** with `const CONFIG = { TIMEOUT: 5 } as const` it gives `[TS9219] staticAssert condition must be a compile-time constant`.
- **`SUPPORTED_LOCALES.length > 0`:** fails with `as const`, passes without it.
- **Deprecated aliases (lines 222-225):** `powerAssert` and `comptimeAssert` are not exported (packages/testing/src/index.ts).
- **Smaller mismatches:** the snapshot label is `file.ts — expr` with no `:line`, and the power-assert failure prints a diagram rather than the "Sub-expressions:" list.
- Suggested fix: say what counts as a compile-time constant (literal expressions), and remove the alias section.

### 24. type-safety.md recommends plain `tsc --noEmit` as the CI gate, which contradicts the rest of the docs

- Severity: medium
- Location: docs/guides/type-safety.md:54-68, 144-152
- Problem: the same page (lines 70-93) says pre-macro source is type-incomplete, so plain `tsc` reports TS2339 on `@derive` members. The ts-patch entry is emit-time, with no `transformProgram`. getting-started/index.md:60 says the CI gate is `typesugar check`.
- Minor: the Turborepo snippet uses a `"command"` key that turbo doesn't have, and the pre-2.0 `pipeline` key.
- Suggested fix: use `npx typesugar check` as the gate.

### 25. validate.md: Zod/Valibot support and the zero-cost Schema claim aren't backed by code

- Severity: medium
- Location: docs/guides/validate.md:96-100, 143-146, 230-239
- **Zod/Valibot:** no `ZodF`, `ValibotF` or Zod/Valibot `Schema` instances ship; they are mentioned only in a comment at schema.ts:50-51.
- **Zero-cost:** `nativeSchema` has no `@impl` tag (schema.ts:118), so `processBody(nativeSchema, isUser, data)` is not specialized and no TS9602 is emitted. The output is unchanged.
- Suggested fix: present Zod/Valibot as user-written instances, add `/** @impl Schema<ValidatorF> */` to `nativeSchema`, or soften the claim.

### 26. type-system.md: documented exports that don't exist

- Severity: medium
- Location: docs/guides/type-system.md:28, 144-145, 372, 361, 381
- **`unsafeRefine`:** no runtime export, and the macro is "not registered" (type-system/src/macros.ts:13). The page lists it twice as a working macro.
- **`$<F, A>`:** not exported.
- **Comparison `Eq`:** it is exported as `NumEq`.
- Suggested fix: remove `unsafeRefine` or ship it, drop `$`, and rename `Eq` to `NumEq`.

### 27. Lower-severity items

- Severity: low
- **reflect.md:169, strings.md:96:** `register()` is listed but not exported by either package.
- **specialize.md:35, 131:** the hoisted name is `__typesugar___sortWith_number_0__`, not `__sortWith_number__` / `__fn_Brand__`. TS9602 and "Ambiguous instance" diagnostics are each emitted twice (code dedup issue).
- **units.md:114:** the note says absolute temperature conversion is unsupported. It works now: `celsius(0).to(kelvin)` gives `273.15 K`.
- **strings.md:55, tagged-templates.md:98:** `'` is escaped to `&#039;`; the docs show it unescaped.
- **sql.md:145, 1017:** `sql$` emits literal param types (`` sql$`WHERE id = ${0}` `` gives `TypedFragment<[0], void>`, not `[number]`). As a result, `andTyped` / `orTyped` / `whereAndTyped` over mixed literals give `strictOutput` type errors in the output.
- **type-system.md:265:** `requires(Vec.length(v) === 3); // PROVEN` — the runtime check is kept in the output.
- **type-system.md:279:** the `opaqueModule` op `(n) => ...` is implicitly `any` (TS7006).
- **Generated output with type errors (code issue):** `validator<T>()` (reflect) and `is<T>()` (validate) produce `value.id` on `object`. `@derive(Read)` produces `fields as User`.
- **strings.md:5, units.md:7:** both say "excluded from release", but they are published (PEP-059 decision 3).

## 1.0 gaps

- `@typesugar/testing`'s `mock<T>()`, `createMockFn`, `createMockObject`, `assertType` and `typeInfo` have no section in testing.md.
- sql.md never mentions the `./macros` entry, the `SimpleConnectionIO`/`SimpleTransactor` legacy exports, or the "Legacy\*" Meta exports (two parallel APIs, PEP-059 P1 item 14).
- There is no page explaining the `syntax/<tc>` and `syntax/<tc>/ops` markers as a prerequisite. std-typeclasses.md, zero-cost.md and units.md all assume operators work without them.
- validate.md does not document `nativeParseOrElse` / `nativeParseMap` / `nativeParseAll` / `nativeSafeParseAll` beyond an import list, and the generic `parseOrElse(S)` does not type-check with `nativeSchema` (TS2345).
- Every page in scope is reachable from the sidebar, and every internal link and anchor in scope resolves.

## Examples checked

| Page                | Examples                            | Passed                           |
| ------------------- | ----------------------------------- | -------------------------------- |
| playground.md       | 3 (UI/config, checked against code) | 0                                |
| reflect.md          | 4                                   | 4                                |
| specialize.md       | 4                                   | 3                                |
| sql.md              | 26                                  | 12                               |
| std-typeclasses.md  | 2                                   | 0                                |
| strings.md          | 5                                   | 5 (html output differs slightly) |
| tagged-templates.md | 11                                  | 3                                |
| testing.md          | 6                                   | 4                                |
| type-safety.md      | 3 (config, checked against code)    | 1                                |
| type-system.md      | 8                                   | 6                                |
| typeclasses.md      | 12                                  | 6                                |
| units.md            | 6                                   | 4                                |
| validate.md         | 6                                   | 5                                |
| zero-cost.md        | 3                                   | 1 (comptime)                     |

## Summary

- Counts: 14 high, 13 medium (findings 14 to 26), and 1 grouped low finding (27) covering 9 items.
- Top problem 1: the hero pages zero-cost.md and std-typeclasses.md, and units.md's operator section, show `===` and `+` sugar that does nothing without the PEP-052 syntax markers. zero-cost.md's Option example also crashes because of a real subpath bug in `dts-opaque-discovery.subpathFor`.
- Top problem 2: typeclasses.md's bare `@instance`, generic `summon<Show<A>>()` and generic-instance examples all fail. `summon<Functor<Array>>()` silently picks the Option instance and returns NaN.
- Top problem 3: sql.md has a false zero-cost section, a non-existent `@schema`, `@derive(Read, Write, Codec)` that emits a SyntaxError, `toQuery()` that is a type error for every consumer (dangling d.ts augmentation), and no-op TypedQuery methods.
- Also high: type-system's `wrap<UserId>(42)` fails type-checking (`UnwrapNewtype` bug), and the unplugin's `strict: true` never fails the build.
