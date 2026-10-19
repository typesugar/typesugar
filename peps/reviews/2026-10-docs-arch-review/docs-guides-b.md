## guides-b documentation review (deep-review-1.0)

I ran every non-trivial example in scope through the helper (`doc-example.mjs`), one run at a time. The helper skips the type check when the transformer changes nothing, so I also type-checked the generated output, or the source where that mattered, with a small script (`guides-b/tc.mjs`, `guides-b/srctc.sh`). Scratch files are in /private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/docrev/guides-b/. Besides the helper's own output, I wrote three tiny local modules (`my-extensions.ts`, `my-ext2.ts`, `generic-ext.ts`, `arr-ext.ts`) into the gitignored `/Users/deapovey/src/personal/typesugar/.typesugar/doc-examples/` for the cross-file extension examples. Nothing else in the repo was touched.

**Output type errors I did not count:** expected artifacts of erasing `@opaque` Option (`number` vs `Option<number>`).

### 1. Pattern-matching extractors `Some/None/Left/Right` silently produce wrong results

- Severity: high
- Location: docs/guides/pattern-matching.md:309-350. The code is packages/std/src/macros/match.ts:109-161: the built-in extractors test `_tag`/`value`.
- Problem: the doc presents Option/Either extractor matching as working. The generated code tests `_m._tag === "Some"` and reads `.value`. But fp's Option is `A | null` and Either is `{left}`/`{right}`, so no arm ever matches.
  - The doc's exact examples fail to build ("scrutinee type is not enumerable").
  - Once a user adds the `.else()` that error asks for, every value goes to `.else`.
- Evidence (pm6.ts): `match(Some(5)).case(Some(v)).then(v*2).else(-1)` prints `-1`; `match(Right(3)).case(Right(val))...else("fallback")` prints `fallback`. Both compile with no typesugar error. The `Cons/Nil/Ok/Err` rows in the table use the same `_tag` scheme.
- Suggested fix: this is a code bug. Until it is fixed, remove the extractor section and table, or mark them "not working with @typesugar/fp's representations".

### 2. Array extension methods (all generic ones) are never rewritten, yet they type-check, so they crash at runtime

- Severity: high
- Location: docs/guides/extension-methods.md:14-20, 140-150, 263-287. Also the std showcase comment `[1, 2, 3].head()`.
- Problem: with `import { head, tail, chunk, unique } from "@typesugar/std"`, the call `[1,2,3].head()` / `arr.head()` is left untouched. The global augmentation makes it type-check, so the result is a runtime `TypeError: arr.head is not a function`.
  - The doc's own generic `"use extension"` example fails the same way: `[1,2,3].first()` is not rewritten (TS2339, then a runtime TypeError).
  - A non-generic `total(arr: number[])` IS rewritten. That points to generic (`T[]` / `readonly A[]`) first parameters failing to match.
- Evidence: ext4.ts output keeps `console.log(arr.head());` and the run fails with `TypeError: arr.head is not a function`. ext8.ts (`total(xs)`) is rewritten correctly.
- Suggested fix: a code bug in extension resolution for generic first parameters. In the docs, drop the Array and generic examples or show the direct-call form until it is fixed.

### 3. Library manifest page describes a feature nothing consumes

- Severity: high
- Location: docs/guides/library-manifest.md (whole page). The code is packages/core/src/manifest.ts.
- Problem:
  - `discoverManifests`, `getManifestRegistry` and `mergeManifestIntoRegistry` are exported from @typesugar/core, but nothing in packages/\*/src calls them. So `typesugar.manifest.json` and the `package.json#typesugar` instances/extensions are never read.
  - `typesugar manifest validate|list|check` does not exist (the CLI accepts build, watch, check, expand, run, init, doctor, create, preprocess, approve-macros).
  - There is no `manifest` plugin config.
  - The priority table describes a registry that PEP-052 removed.
- Evidence: `grep -rn "getManifestRegistry\|discoverManifests\|mergeManifestIntoRegistry" packages --include='*.ts'` finds no consumer. `node packages/transformer/dist/cli.js --explain` prints `Unknown command` and lists the real commands.
- Suggested fix: mark the page "Planned, not implemented in 1.0" (like TS9050 in error-messages.md), or remove it and its index/sidebar entries.

### 4. `/** @tailrec */` and `/** @extension */` on functions are silently ignored, but the JSDoc guide recommends exactly that

- Severity: high
- Location: docs/guides/jsdoc-vs-decorators.md:3-4, 24, 33 ("function declaration … ✅ tsc-clean … **JSDoc**"), 40-42. The code is packages/transformer-core/src/macro-helpers.ts:54-83.
- Problem: JSDoc dispatch only covers interfaces, classes, type aliases and variable statements (`isJSDocMacroTargetNode`). The tag set is typeclass, impl, instance, derive, deriving, operators, operator, extension, reflect, hkt, adt. So the following does nothing, with no diagnostic:
  - `/** @tailrec */ function f…` stays recursive, so the user loses stack safety without being told.
  - `/** @extension */ function volume…` is not registered (`b.volume()` gives TS2339).
    The decorator forms work. The page also never mentions the new rule that a tag only triggers at the start of a comment line, and not inside a code fence. I confirmed that `/** Derives @derive(Eq) … */` does nothing while ` * @derive(Eq)` on its own line works.
- Evidence: em3.ts (`/** @tailrec */`) emits 0 diagnostics and unchanged output; em4.ts (the decorator form) reports "@tailrec: … not in tail position". jd2.ts: `/** @extension */` is ignored.
- Suggested fix:
  - Change the function row to "decorator only (JSDoc not supported on functions)" and drop "every attribute macro" from the intro.
  - Add: "A JSDoc macro tag must begin its own comment line (`/** @derive(Eq) */` or ` * @derive(Eq)`); a tag mid-sentence or inside a ``` fence is ignored."

### 5. Object-form `match(value, handlers)` (match.md) is not exhaustive, has no OR patterns, and only types `kind`

- Severity: high
- Location: docs/guides/match.md:14-62 and 24-27. The code is packages/std/src/macros/match-runtime.ts:77-91.
- Problem:
  - Handlers are typed as optional (`[K in T["kind"]]?`), and the macro reports nothing for a missing case. ma3.ts gives 0 diagnostics, and a missing variant throws `Error("Non-exhaustive match …")` at runtime.
  - Only the `kind` discriminant type-checks. The doc's `tag` (Result) and `type` (Shape) examples get TS2769 "Property 'kind' is missing" in the user's tsc/IDE (srctc on ma1.ts).
  - `"rectangle | triangle"` OR keys are not supported. The macro warns "handler key 'rectangle | triangle' can never match", and the doc's `isRound` example throws at runtime for a rectangle.
  - Guards don't exist in this form.
- Suggested fix:
  - Use `kind` in the examples, or show the 3-arg overload `match(shape, {...}, "type")`.
  - Delete the OR-pattern and Guards bullets/section.
  - Say this form is not exhaustiveness-checked; for that, use the fluent API.

### 6. Typeclass method sugar on primitives, and `Show` from std, don't exist

- Severity: medium
- Location: docs/guides/extension-methods.md:237-261, 289-302 (`(42).show()`, `"hi".show()`, `(42).print()`, `extend(42).show()`).
- Problem:
  - `import { Show, Eq } from "@typesugar/std"` fails: std does not export `Show`.
  - `(42).show()` and `(42).equals(42)` are never rewritten (TS2339, runtime TypeError), even with `import "@typesugar/std/syntax/eq"`.
  - The `@typeclass`/`@instance` decorator Printable example fails with "@impl requires arguments …". The JSDoc `@impl Printable<number>` version still doesn't rewrite `(42).print()`.
  - What works: `point.equals(other)` on a `@derive(Eq)` type, after `import "@typesugar/std/syntax/eq"` (ext13.ts, ext14.ts).
- Suggested fix: show method sugar only on user types with derived/impl instances, plus the required `import "@typesugar/std/syntax/<tc>"` activation import. Remove the primitive examples.

### 7. Either and IO "dot syntax" don't exist; the List API is wrong

- Severity: medium
- Location: docs/guides/fp.md:69-98, 118-142, 144-158; extension-methods.md:377-386.
- Problem:
  - Either has no methods: `parseNumber("42").map(...)` gives TS2339 and a runtime TypeError.
  - `IO.of` is `pure` (it takes a value, not a thunk). IO has no `.flatMap`/`.unsafeRun` methods. Working form: `IO.delay(() => …)`, `IO.flatMap(io, f)`, `runIOSync(program)` (fp5.ts runs).
  - `List` is exported as a type only (`List.of` gives SyntaxError "does not provide an export named 'List'"; use `listOf`). There are no `.head/.map/.filter/.foldLeft` methods, and per the breaking-change list `tail` now returns `List | undefined`.
- Evidence: fp2.ts, fp4.ts, fp6.ts.
- Suggested fix: rewrite these sections with the function forms above.

### 8. The "Implicit conversion between Option<T> and T | null" claim is false

- Severity: medium
- Location: docs/guides/fp.md:30-33, 176; extension-methods.md:408-418.
- Problem: `const opt: Option<number> = nullable` is TS2322 and `const raw: number | null = opt` is TS2322. No suppression rule exists for this: core's rules only cover MacroGenerated (codes 2451, 2304, 2339, 6133, 6196), and macros adds one for TS1206.
- Suggested fix: remove these claims, and show `Some(x)` / `None` construction or an explicit conversion helper.

### 9. fp "Zero-Cost" and HKT examples are wrong

- Severity: medium
- Location: docs/guides/fp.md:229-254.
- Problem:
  - The output is `getOrElse(flatMap(map(42, x => x * 2), x => x + 1), 0)`, not `42 * 2 + 1`.
  - `.getOrElse(0)` is a type error, because the signature takes a thunk.
  - The HKT example imports `$`, `Functor`, `Monad` as values and uses `FunctorOption`/`FunctorArray`. None of these exist as values: `Functor`/`Monad` are types, and the instance is `optionFunctor`. `Kind` is not imported.
- Evidence: fp7.ts output.
- Suggested fix: show the real emitted output, and use `optionFunctor` with `import type { Functor, Kind }`.

### 10. Missing exports used in examples

- Severity: medium
- Location:
  - extension-methods.md:132 (`titleCase`, `collapseWhitespace`) and :143 (`groupBy`, which is exported as `arrayGroupBy`).
  - math.md:211, 236 (`matrixGet`; the real name is `get`).
  - math.md:309 (`integral`; the real name is `polyIntegral`).
  - math.md:431 (`normedVec2`, `normedVec3`).
  - operators.md:10 (`numericRational`, `rational` imported from `@typesugar/std`; they live in `@typesugar/math`).
  - index.md:127 (`Result`, `Ok`, `Err` not exported by @typesugar/fp).
  - index.md:149 (`cfg()` listed under `@typesugar/core`; it is in `@typesugar/macros` / `typesugar`).
- Evidence: TS2305/TS2724 from the type check, and `chk-exports.mjs` against the built dist.
- Suggested fix: rename to the real exports listed above.

### 11. Range chaining doesn't work

- Severity: medium
- Location: docs/guides/extension-methods.md:156-177.
- Problem: `(1).to(10)` works, but `.step().toArray()`, `.reversed()`, `.forEach`, `.map`, `.filter` and `.contains` on a Range give TS2339 and a runtime `TypeError: step(...).toArray is not a function`. Range is a plain `{start,end,step,inclusive}` object, so it is also not iterable (see #15).
- Suggested fix: use `toArray(step(to(0, 100), 10))`, or fix the code.

### 12. Namespace-import extensions don't work

- Severity: medium
- Location: docs/guides/extension-methods.md:54-67.
- Problem: with `import * as std from "@typesugar/std"`, `(42).clamp(0, 100)` is not rewritten. The import is elided and the run fails with `TypeError: 42.clamp is not a function` (ext3.ts).
- Suggested fix: remove the section, or say named imports are required.

### 13. Math: type-safety claims false, wrong outputs, operators don't dispatch

- Severity: medium
- Location: docs/guides/math.md:224, 326, 190, 489-502.
- Problem:
  - `matMul(a, a)` on 2×3 matrices is not a type error (`@ts-expect-error` unused); it only throws at runtime.
  - `modAdd(mod(5, 7), mod(2, 11))` is not a type error either, and silently returns `{value: 0, modulus: 7}`.
  - `toFixed(bigDecimal("123.456"), 2)` returns `"123.45"` (it truncates via setScale), not `"123.46"`.
  - `a + b` on Rationals compiles to `[object Object][object Object]` and `NaN`, even with the std numeric/fractional ops imports (mt5.ts, mt6.ts).
  - Not mentioned anywhere: `rat()`/`rational()` now throw `RangeError` on non-integers (verified with `rat(0.5, 1)` and `rational(0.5)`).
- Suggested fix:
  - Drop the "Type error!" comments.
  - Change the `toFixed` comment to `"123.45" (truncates)`.
  - Remove or mark the Operator Support section.
  - Add "non-integer number arguments throw RangeError; pass bigint or integers".

### 14. Graph dependency example builds dependents first and doesn't type-check

- Severity: medium
- Location: docs/guides/graph.md:372-394, 132-139, 159-256.
- Problem:
  - `topoSort(deps)` returns `["app","api","ui","auth","components","styles","db"]`, edges pointing to dependencies. The doc claims `db` comes first, and its "Build packages in order" loop would build `app` before `db`.
  - `buildOrder.order` is TS2339 without narrowing on `ok`.
  - `compare: (a, b) => a.totalMs - b.totalMs` is TS2322 (`number` is not `Ordering`).
  - The main `order` machine is a compile error under the transformer (dead-end Rejected; the doc admits this). The "Running Instances" section builds on it, so it won't build, and the CLI now exits non-zero on macro errors.
  - The `A --go--> B, C` example is a syntax error, not "Dead-end: C".
  - Undirected `topoSort`/`isDAG`/`detectCycles` throwing (a breaking change) is not mentioned.
  - The DSL is not compile-time parsed (`digraph` stays a runtime call; only `stateMachine` is inlined).
- Suggested fix:
  - Use `reverseGraph(deps)` or reverse the order, and narrow with `if (buildOrder.ok)`.
  - Add `@terminal Rejected` to `order`.
  - Use separate `A --go--> B` lines in the dead-end example.
  - Note the undirected-graph throw.

### 15. Fusion: `fused()` compile-time fusion has shipped but is documented as "Phase 2 future"; integration claims are false

- Severity: medium
- Location: docs/guides/fusion.md:7, 154-194, 210-213.
- Problem:
  - `fused(arr.map(…).filter(…).reduce(…))` already compiles to a single for-loop (fu1.ts output). It is undocumented, and the page says it is planned.
  - std `Range` and fp `List` are not iterable: `lazy(...)` on either throws `TypeError: this.source is not iterable` (fu2.ts, fu3.ts).
  - The `lazy` macro is deliberately unregistered, so "the `lazy` macro will…" is stale.
  - The terminal-ops block (61-78) is not valid TS (chained `;.`); cosmetic.
- Suggested fix: document `fused()`, its supported steps, and its "left unfused" fallback; remove the Range/List interop claims.

### 16. Pattern-matching: catch-all object/tuple patterns rejected; custom/derived extractors don't exist; wrong error codes

- Severity: medium
- Location: docs/guides/pattern-matching.md:140-152, 253-262, 403-453, 357-365, 485.
- Problem:
  - `.case({ ...rest })` as the last arm and `.case([x, y]).as(p)` on a tuple both give "Non-exhaustive match — scrutinee type is not enumerable" (pm3a.ts, pm3c.ts), so the doc's Object-pattern and AS-pattern examples fail to build.
  - `/** @impl Destructure<typeof Email, …> */` does not register an extractor. `Email({...})` compiles to `instanceof Email` (ReferenceError).
  - Auto-derived `Point(x, y)` compiles to `instanceof Point` (ReferenceError: Point is not defined).
  - Real diagnostics carry no code. TS9401/TS9402 are extension-method codes ("No extension method …").
- Suggested fix:
  - Add `.else()` to those examples.
  - Remove the Custom Extractors and Auto-Derivation sections, or document `registerExtractor` if that is the supported path.
  - Drop `[TS9401]`/`[TS9402]` from the sample errors.

### 17. error-messages.md: `--explain` and the import/method suggestion diagnostics don't exist

- Severity: medium
- Location: docs/guides/error-messages.md:32, 123-149, 251-273.
- Problem:
  - `npx typesugar --explain TS9001` gives "Unknown command: --explain".
  - TS9061 ("Macro `comptime` is not defined") and TS9062 (`value.clamp` without an import) are only catalog entries: nothing in packages/\*/src emits them. em2.ts gives 0 typesugar diagnostics, only plain TS2304/TS2339.
  - The TS9061 sample suggests `import { comptime } from "typesugar"`, which is OK, but the real trace for a missing Eq suggests `import { Eq } from "typesugar"`, and the root is now runtime-only (a code issue to note).
  - The hero (`p1 === p2` giving TS9001 with spans) is not what is emitted: em6.ts gives "GenericDerivation failed for Eq … Color lacks Eq" with no code.
- Suggested fix: remove the `--explain` section (point to /errors/ pages), mark TS9061/TS9062 as not yet emitted, and use real captured output for the hero.

### 18. Opt-out: the file-level example doesn't opt out, `@ts-no-typesugar-all` on the line above is ignored, config opt-out is a no-op

- Severity: medium
- Location: docs/guides/opt-out.md:18-21, 65-70, 191-214. The code is packages/core/src/resolution-scope.ts:403-430 and 436-480.
- Problem:
  - The example's `("use no typesugar");` (parenthesised, and "after imports") is a ParenthesizedExpression, which the directive scan ignores, so `comptime` still expands (oo1.ts gives `export const y = 7`).
  - The line marker only applies to its own line: `// @ts-no-typesugar-all` above a line does not stop `(42).clamp` from being rewritten (oo2.ts).
  - `resolution.mode` / `fileOverrides` are stored but never consulted (no reader of `.mode`), and they are resolution modes, not transformation opt-outs.
- Suggested fix:
  - Write `"use no typesugar";` unparenthesised as the first statement of the file.
  - Put `// @ts-no-typesugar-all` on the same line.
  - Remove the Configuration-Level section.

### 19. erased(): the `@derive` auto-derivation example fails

- Severity: medium
- Location: docs/guides/erased.md:227-243 (also 214, 225).
- Problem: `erased<[Show, Eq]>(p)` with `@derive(Show, Eq)` gives "Missing typeclass instances for erased(): Show<**object>, Eq<**object>". It still fails with a typed `p: Point`, JSDoc derive and std imports (erased4.ts: Show<Point>, Eq<Point> missing), and at runtime the stub throws. Only primitives are tested (packages/erased/tests/macro-execution.test.ts). Separately, `erased<[Show, Eq]>` needs `Show`/`Eq` types in scope (TS2304). The page says Clone/Debug/Json cannot be resolved, but the macro maps them.
- Suggested fix: use a primitive example (`erased<[Eq, Hash]>(n)` with std instances, as the test does), or fix companion resolution.

### 20. Mapper "Zero-Cost" example fails the build

- Severity: low
- Location: docs/guides/mapper.md:308-323.
- Problem: with the Quick Start `UserDTO`, renaming only `firstName` leaves `lastName` unmapped, which gives "Cannot map field 'lastName' …" (mp2.ts).
- Suggested fix: add `lastName: "last_name"` to the rename and the output.

### 21. Parser: `ParseError` has no `line`/`col`, and the compiled `grammar` throws a plain Error

- Severity: low
- Location: docs/guides/parser.md:21, 170-179.
- Problem: the class has `pos` and `expected` only, so `err.line`/`err.col` are undefined. The inlined grammar parser throws `new Error(...)`, so `instanceof ParseError` is false (pa1.ts).
- Suggested fix: use `${err.pos}`, and say the grammar parser throws `Error` (or make it throw ParseError).

### 22. Minor

- Severity: low
- Problems:
  - operators.md:65-74: the Bitwise table is broken by an unescaped `|`.
  - fp.md:268-272: the do-notation `yield: { { (user, posts, comments); } }` (prettier-mangled) yields only `comments`.
  - graph.md:343: custom-GraphLike users get TS9602 "auto-specialization … skipped" warnings from library code they can't fix.
  - extension-methods.md:216: `format` is not a std export (illustrative).
  - erased.md:158: the `extendCapabilities` callback params are implicit-any under strict.

## 1.0 gaps

- guides/index.md links three pages that don't exist: `./hlist.md`, `./collections.md`, `./symbolic.md`. It omits `ai-assistants.md`, which is in the sidebar.
- index.md calls `pattern-matching.md` "(v2)" and `match.md` the main guide; the sidebar does the reverse ("Pattern Matching (object form)" for match.md).
- `fused()` (@typesugar/fusion) is undocumented public API.
- `registerExtractor` / the real custom-extractor path for match is undocumented.
- The JSDoc line-start trigger rule (a breaking change) is not documented anywhere in scope.
- The PEP-052 activation imports (`import "@typesugar/std/syntax/<tc>[/ops]"`) needed for method and operator sugar are not mentioned in extension-methods.md or operators.md.
- Graph: undirected `topoSort`/`isDAG`/`detectCycles` throwing is not documented.
- Math: `rat()`/`rational()` RangeError and `rationalToBigDecimal` HALF_EVEN are not documented.

## Examples checked

| Page                   | Examples                     | Passed                                               |
| ---------------------- | ---------------------------- | ---------------------------------------------------- |
| erased.md              | 9                            | 8                                                    |
| error-messages.md      | 8                            | 3                                                    |
| extension-methods.md   | 20                           | 8                                                    |
| fp.md                  | 12                           | 4                                                    |
| fusion.md              | 8                            | 6                                                    |
| graph.md               | 10                           | 6                                                    |
| index.md               | quick-ref imports, links     | 8/10 imports; 3 dead links                           |
| jsdoc-vs-decorators.md | 5                            | 3                                                    |
| library-manifest.md    | 0 runnable (feature unwired) | n/a                                                  |
| mapper.md              | 11                           | 10                                                   |
| match.md               | 4                            | 0 (all fail tsc; OR pattern and exhaustiveness fail) |
| math.md                | 12                           | 7                                                    |
| operators.md           | 5                            | 3                                                    |
| opt-out.md             | 7                            | 4                                                    |
| parser.md              | 4                            | 2                                                    |
| pattern-matching.md    | 20                           | 12                                                   |

## Summary

- Counts: high 5, medium 14, low 3.
- Top problem 1: Option/Either match extractors silently take the wrong arm (match.ts expects `_tag`; fp uses null / `{left|right}`). This is a code bug the docs showcase.
- Top problem 2: array and other generic extension methods are never rewritten but type-check via the global augmentation, so they crash at runtime.
- Top problem 3: the library-manifest page documents an unwired feature and CLI. On top of that, `/** @tailrec */` and `/** @extension */` on functions are silently ignored while the JSDoc guide recommends them.
- Also broadly stale: fp.md (Either/IO/List APIs, implicit Option conversion) and match.md (no exhaustiveness, `kind`-only typing).
