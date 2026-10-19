## guides-c: docs fix report

All 27 findings are handled in my 14 files. I changed no code and ran no git commands. Prettier is clean on all 14 files, and no process of mine is still running. Scratch examples are in /private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/docfix/guides-c/

### Per finding

1. **zero-cost Option subpath: fixed.** The code is fixed; the example runs and prints 84. The output block now has the real `import { getOrElse, map } from "@typesugar/fp/data/option"` line.
2. **zero-cost `===`: fixed.** The example now imports `derive` and `@typesugar/std/syntax/eq/ops` and pastes the real `typesugar expand --js` output. It prints true.
3. **std-typeclasses quick start: fixed.** Rewritten with `/** @derive(Eq, Ord, Show) */`, the `eq/ops` and `ord/ops` imports, and `summon<Show<Point>>().show(p1)`. The page now says std ships no `.show()` sugar. The Monoid `+` example uses `syntax/monoid/ops` (prints `{count:3,sum:15}`). The "auto-derived" claim is removed.
4. **typeclasses bare `@instance`: fixed.** Every instance now uses `/** @impl TC<T> */`. The page says a bare `@instance` is an error, and that a `const` annotated `Show<number>` also counts as an instance (it does: the scanner's type-annotation fallback).
5. **typeclasses `= summon<Show<A>>()`: fixed.** That form is removed; only `= implicit()` is shown, with a note on the TS9001 hint. The generic-instance example (`Show<A[]>`) is marked "Not yet supported in 1.0".
6. **`summon<Functor<Array>>`: fixed.** The page says it is TS9001 without an instance, then shows a declared `@impl Functor<Array>` that prints `[2, 4, 6]`, plus the "no Array.Functor companion" warning.
7. **units operators: fixed.** All operator claims and the "Typeclass Integration" table are cut. Only `.add`/`.sub`/`.mul`/`.div`/`.equals` are documented, and `d1.add(t)` is confirmed TS2345 with tsc.
8. **sql Codec duplicates: fixed.** The code is fixed and the example runs. A note says `@derive(Codec)` alone also generates all three.
9. **sql zero-cost: fixed.** The feature bullet and the section are cut, replaced by a "Runtime Model" section saying the Transactor interprets programs at runtime.
10. **sql `@schema`: marked planned.** The section now says `@schema` warns and has no effect; write `sql$<RowType>`.
11. **sql `toQuery()`/`toUpdate()` types: fixed in code.** I re-verified with tsc; the doc is unchanged.
12. **type-system `wrap<UserId>(42)`: fixed in code.** tsc is clean on the quick start and newtype examples. I added the missing `Email` type and a note on the remaining strictOutput warning at `calculateArea(10, 5)`.
13. **type-safety `strict: true`: fixed.** The page now says strict (and "incremental") fails the build.
14. **playground: fixed.** It now says:

- the transform runs on the server (`/api/compile`);
- Run and comptime are off on the public playground; use `npx typesugar run`;
- Cmd/Ctrl+S copies the share URL.
  The runtime-bundle table is replaced by the real list of preloaded macro packages: validate and reflect macros are not loaded on the server. The examples table is updated to the 32 real examples.

15. **sql TypedQuery/TypedUpdate: fixed.** These methods are implemented in code now. The doc covers `to`/`map`/`unique`/`option`/`decode`, the build-the-decoder-then-`ConnectionIO.query(q)` pattern, the TypeError when a Read is also passed, `run(): ConnectionIO<number>`, and `withGeneratedKeys` appending RETURNING.
16. **sql `deriveRead`/`deriveWrite`/`deriveCodec`: fixed in code.** I re-ran the example and it passes.
17. **sql combinators: fixed.**

- `ap` arguments reversed and the function now accepts null.
- Queryable values built with `QueryableCompanion.make`.
- `unfold` uses `queryMany`.
- `Write.tuple` marked as TS2345 (use `Write.product`).
- The `fromPool` and constructor release shapes are corrected.
- parZip and parSequence are documented as sequential.

18. **sql Kysely/Drizzle raw: fixed.** The section is cut down to one paragraph: pass text plus parameters (Kysely `CompiledQuery.raw`), because `sql.raw` drops parameters. It is marked untested, since neither library is installed.
19. **sql syntax validation: fixed.** It is now described as a warning, and the DELETE-without-WHERE claim is removed.
20. **tagged-templates: fixed.** Rewritten:

- `Fragment.ident`/`Fragment.raw`, the real `query.text` with its newlines, and the real `__sql_build` compiled form;
- regex takes no flags and no interpolations; html has no trusted-HTML opt-out;
- the units section is rewritten (no substitutions, `.to(kilometers)`);
- `defineTaggedTemplateMacro({ name, module, expand })` plus `globalRegistry.register` (tsc clean);
- `sql` returns `Fragment` (use `sql$` for types).

21. **specialize `= implicit()`: fixed.** Documented as resolved but not specialized; still true on dist.
22. **typeclasses coherence: fixed.** Both halves are stated (declarations unchecked, ambiguity error at call sites), and the table row is updated.
23. **testing: fixed.**

- The quick start uses `const TIMEOUT_MS`, and the page explains what counts as a compile-time constant, including the `as const` gotcha (TS9219).
- The deprecated-aliases section is removed.
- The snapshot label (`file.ts — expr`, which needs a global `expect`) and the power-assert diagram are now the real output.

24. **type-safety CI gate: fixed.** The page uses `npx typesugar check` throughout. It explains that ts-patch type-checks the pre-macro source. The Turborepo snippet uses `tasks` and a package script.
25. **validate: fixed.**

- Zod/Valibot: the page says no instance ships, and shows how to write your own with `makeSchema`.
- Zero-cost Schema: specializes when the instance's source is visible, but not across a published package boundary (no TS9602); confirmed from dist.

26. **type-system exports: fixed.** `unsafeRefine` and `$` are removed, and `Eq` is renamed to `NumEq`.
27. **low items: fixed.**

- `register()` removed from reflect and strings.
- Real hoisted names in specialize.
- Absolute temperature conversion works (`celsius(0).to(kelvin)` is 273.15 K).
- `&#039;` escaping shown in strings and tagged-templates.
- The `sql$` widening claim is true now.
- The Vec `requires` comment now says the check is kept in the output.
- The `opaqueModule` op is typed `(n: number)`.
- strings and units no longer say "excluded from release"; they now say "published to npm, not under active development". PEP-059 decision 3 is still open.

### Examples re-run (helper against dist, plus tsc where types mattered)

| Page                | Examples                                                | Passing                                                              |
| ------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| zero-cost.md        | 3                                                       | 3                                                                    |
| std-typeclasses.md  | 2                                                       | 2                                                                    |
| typeclasses.md      | 9                                                       | 9 (the generic-instance example is cut)                              |
| units.md            | 5                                                       | 5                                                                    |
| type-system.md      | 4                                                       | 4 (1 known strictOutput warning, documented)                         |
| type-safety.md      | config only, checked against code                       | n/a                                                                  |
| testing.md          | 4                                                       | 4                                                                    |
| specialize.md       | 3                                                       | 3                                                                    |
| reflect.md          | 3                                                       | 3 (strictOutput `object` warnings, see below)                        |
| strings.md          | 5                                                       | 5                                                                    |
| tagged-templates.md | 7                                                       | 7 (the Kysely/Drizzle parts were not run)                            |
| sql.md              | about 30 snippets across 4 files                        | all pass except the two code bugs below, which the doc now documents |
| validate.md         | 6                                                       | 6                                                                    |
| playground.md       | UI/config, checked against Playground.vue and api/\*.ts | n/a                                                                  |

### Code bugs still open

1. **`= implicit()` is filled but not specialized.** Repro: `function sortWith<T>(items: T[], ord: Ord<T> = implicit())` then `sortWith([3,1,2])` gives `sortWith([3,1,2], numberOrd)` with no hoisted function. Location: pipeline order in macros/transformer-core.
2. **`andTyped`/`orTyped`/`whereAndTyped` need one shared parameter tuple type.** `andTyped(sql$`name = ${"Alice"}`, sql$`age > ${21}`)` gives strictOutput TS2345. Location: packages/sql/src/typed-fragment.ts:353-372 and 519.
3. **`Write.tuple(WriteUser, WriteProfile)` is TS2345** (Write is contravariant). Location: packages/sql/src/typeclasses.ts:884.
4. **`staticAssert` rejects `as const` values.** `const CONFIG = { TIMEOUT: 5 } as const; staticAssert(CONFIG.TIMEOUT > 0, ...)` gives TS9219, while the same object without `as const` passes. Location: @typesugar/testing staticAssert macro.
5. **`Unit.toString()` prints the SI value with the display symbol.** `kilometers(1).toString()` is "1000 km", and `units`100 km/h`` prints "27.77… km/h". Location: packages/units/src/types.ts:450. The doc now says this explicitly.
6. **Generated output has type errors.** `validator<T>()` (reflect) and `is<T>()`/`assert`/`validate` (validate) emit `value.name` on `object`, giving strictOutput TS2339 warnings. The programs run correctly.
7. **`wrap<Meters>(10)` erases to a bare `10`,** so the expanded output gets a strictOutput warning at `calculateArea(10, 5)` (libs report leftover).
8. **testCases collapses whitespace in labels.** Input `"  "` (two spaces) is labelled `input=" "`. Minor; documented.
9. **The validate and reflect macros are not preloaded by api/compile.ts,** so `is<T>()` and `typeInfo` from `@typesugar/reflect` do not expand in the playground. Its own comment says every package that registers macros must be listed. Documented in playground.md.
10. **Not mine, but noticed:** docs/writing-macros/tagged-template-macros.md still uses the wrong `defineTaggedTemplateMacro("name", {...})` signature.

### Not done

The review's "1.0 gaps" are not covered: testing.md has no mock/assertType/typeInfo section, sql.md does not mention the `./macros` entry or the legacy exports, and validate.md does not document `nativeParse*`. They were not numbered findings.

### Files changed

- /Users/deapovey/src/personal/typesugar/docs/guides/playground.md
- /Users/deapovey/src/personal/typesugar/docs/guides/reflect.md
- /Users/deapovey/src/personal/typesugar/docs/guides/specialize.md
- /Users/deapovey/src/personal/typesugar/docs/guides/sql.md
- /Users/deapovey/src/personal/typesugar/docs/guides/std-typeclasses.md
- /Users/deapovey/src/personal/typesugar/docs/guides/strings.md
- /Users/deapovey/src/personal/typesugar/docs/guides/tagged-templates.md
- /Users/deapovey/src/personal/typesugar/docs/guides/testing.md
- /Users/deapovey/src/personal/typesugar/docs/guides/type-safety.md
- /Users/deapovey/src/personal/typesugar/docs/guides/type-system.md
- /Users/deapovey/src/personal/typesugar/docs/guides/typeclasses.md
- /Users/deapovey/src/personal/typesugar/docs/guides/units.md
- /Users/deapovey/src/personal/typesugar/docs/guides/validate.md
- /Users/deapovey/src/personal/typesugar/docs/guides/zero-cost.md
