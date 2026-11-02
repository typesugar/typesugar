## guides-b docs fix report

All 22 findings and the 1.0 gaps in `docs-guides-b.md` are handled. Every example I touched, and every example the review marked failing, was re-run through `doc-example.mjs --run` against the current dist. Where it mattered I also type-checked the source under strict `tsc`. Prettier has been run on all 16 files. I made no code changes and ran no git commands. No process of mine is still running.

### Per finding

- **#1 Some/None/Left/Right extractors — fixed.** Re-verified that they match fp's shapes. The doc now explains the fp representations, notes the `_tag` fallback, and says Some+None, Left+Right and Cons+Nil need no `.else()`. The Ok/Err rows now describe the `{ ok, value/error }` shape.
- **#2 Generic Array extensions — doc kept.** The code fix made it true: `[1,2,3].head()`, `.tail()`, `.chunk()`, `.unique()` and the `"use extension"` generic `first`/`mapTo` all rewrite and run.
- **#3 library-manifest.md — cut to a short stub** marked "Planned — not in 1.0". It points to `typesugar.macros` and Authoring Libraries. The index row now says "Planned — not in 1.0".
- **#4 JSDoc on functions — fixed.** The page now says only function-target macros (`@tailrec`, `@extension`) dispatch on functions, and other tags warn. It documents the line-start rule with a verified example. The `/** @contract */` example is replaced by plain `requires:` plus the syntax import, because `@contract` is not a JSDoc tag.
- **#5 match.md — fixed.** Examples now use `kind`, and the third-argument discriminant overload is shown. The OR-pattern and Guards claims are removed. The page says this form is not exhaustiveness-checked and the title is now "(object form)".
- **#6 Typeclass method sugar — fixed.** Examples now show `point.equals(other)` with `import "@typesugar/std/syntax/eq"` and a user-defined JSDoc `@typeclass`/`@impl` example (`price.print()`). The primitive `.show()` examples are removed.
- **#7 Either/IO/List — fixed.** These now use the function forms: `E.map`, `IO.delay`/`IO.flatMap`/`runIOSync`, `listOf` and `L.*`. The page notes that `tail` returns `List | undefined`.
- **#8 Implicit Option conversion — fixed.** Replaced with `fromNullable`/`toNullable` in fp.md and extension-methods.md.
- **#9 fp zero-cost and HKT — fixed.** The output block is the real emitted output, and the example uses `getOrElse(() => 0)`. The HKT example uses `optionFunctor` with `import type { Functor, Kind }`.
- **#10 Missing exports — fixed.** `titleCase`/`collapseWhitespace` became `camelCase`/`kebabCase`, `groupBy` became `arrayGroupBy`, `matrixGet` became `get`, `integral` became `polyIntegral`, and the `normedVec*` names became `normedNumberArray`. operators.md now imports from `@typesugar/math`. In index.md, `Result/Ok/Err` were replaced by `Left/Right/type Either`, and `cfg` now lists `@typesugar/macros`.
- **#11 Range chaining — doc kept** (now true). It notes that every method used must be imported by name, and that a Range is not iterable.
- **#12 Namespace imports — doc kept** (now true; re-verified).
- **#13 Math — fixed.** The "Type error!" comments now say RangeError, `toFixed` is noted as `"123.45"` (truncates), and the operator section has the activation imports (verified: 5/6, 1/6, 3/2). Added the `rat()`/`rational()` RangeError and the `rationalToBigDecimal` HALF_EVEN rounding.
- **#14 Graph — fixed.** The dependency example uses `reverseGraph` and narrows on `ok`. The `Ordering` compare and the missing `notEquals` are fixed. `order` now has `@terminal Rejected`. The dead-end, unreachable and nondeterministic examples each produce exactly their own error. Added the undirected-graph throw, the TS9602 note, the fact that `digraph` is parsed at runtime, and that state/event types are `string`.
- **#15 Fusion — fixed.** `fused()` is documented: both receiver shapes, the step table, the unfused fallback, and real output. The "Phase 2 future" text, the Range/List interop claims and the stale `lazy` macro line are removed. The terminal-ops block is now valid TS.
- **#16 Pattern-matching — fixed.** `.else()` is added to the object and tuple/AS examples. The Custom Extractor and Auto-Derivation sections are cut to a one-line "not yet supported". Error samples now use the real text with no codes.
- **#17 error-messages.md — rewritten with real captured output.** This covers the TS9001 hero with its trace, the derive failure (TS9999), the match message, TS9209 for comptime, `@tailrec` (TS9999) and TS9602. TS9061/TS9062 are marked planned. The `--explain` section is replaced by a pointer to the `/errors/` pages, and the CLI's `tsc`-style layout is documented.
- **#18 opt-out — fixed.** The directive is now an unparenthesised first statement, and the line markers are same-line only. The configuration section is removed and the note about stripping the directive is corrected.
- **#19 erased — fixed** (now works). The example uses `erased<[ShowCapability, EqCapability]>(p)` with a typed `p` and prints `Point(x = 1, y = 2) true`. Clone, Debug and Json mapping are verified, and the primitive case needs std's instances imported.
- **#20 mapper — fixed** (`lastName` added to the rename and the output).
- **#21 parser — doc kept** (now true; prints `at 1:1`). Added a short `ParseError` fields note.
- **#22 Minor — fixed.** These cover the bitwise table, the fp `yield: ({ … })` syntax, the TS9602 note in graph.md, the illustrative `format` (now two namespace imports, with the real ambiguity message), and the typed `extendCapabilities` parameters.
- **1.0 gaps — fixed.** In index.md: dead hlist/symbolic rows are removed, Collections links to `/reference/packages#collections`, AI Assistants is added, and the match naming matches the sidebar. Also covered: `fused` is documented, the JSDoc line-start rule is documented, and the activation imports are now in extension-methods.md, operators.md and math.md. The undirected-graph throw and the math RangeError/HALF_EVEN notes are in.

### Examples re-run

| Page                   | Examples                | Passing                                                                                  |
| ---------------------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| erased.md              | 4                       | 4 (only the documented strict `WithShow` warning remains)                                |
| error-messages.md      | 7 captured              | 7 (output is real)                                                                       |
| extension-methods.md   | 9 test files, ~40 calls | all                                                                                      |
| fp.md                  | 5                       | 5 (Option erasure warnings documented; the HKT example's plain-tsc TS2345 is documented) |
| fusion.md              | 3                       | 3                                                                                        |
| graph.md               | 6                       | 6                                                                                        |
| index.md               | imports and links       | all resolve                                                                              |
| jsdoc-vs-decorators.md | 4                       | 4                                                                                        |
| mapper.md              | 1                       | 1                                                                                        |
| match.md               | 3                       | 3 (documented strict warnings)                                                           |
| math.md                | 2                       | 2                                                                                        |
| operators.md           | 3                       | 2; unary and wrong-operand behaviour now documented                                      |
| opt-out.md             | 4                       | 4                                                                                        |
| parser.md              | 1                       | 1                                                                                        |
| pattern-matching.md    | 5                       | 5                                                                                        |

### Code bugs still open

1. **Unary `@op` is not dispatched.** `-v` stays plain JS (prints `null`). There is no PrefixUnary handling in operator rewriting (`macros/src/operators.ts` only maps binary tokens). The doc marks it "not yet supported".
2. **Binary `@op` ignores the right operand's type.** With a same-file `/** @impl VecOps<Vec2> */`, `v + 5` becomes `({ x: v.x + 5..x, … })` with no macro diagnostic; only strictOutput catches it. Now documented.
3. **Object-form `match()` output has spurious strict errors.** "Property 'kind' does not exist on type 'never'", and "Expected 0 arguments, but got 1" for zero-parameter handlers. Documented as a known issue.
4. **`/** @contract \*/`on a function is silently ignored.**`contract`is not in`JSDOC_MACRO_TAGS` (`transformer-core/src/macro-helpers.ts:54`), although the macro's `validTargets` include "function".
5. **No user path for custom or derived extractors.** `registerCustomExtractor`/`registerProductExtractor` exist only in-compiler. `match(s).case(Email({user, domain}))` compiles to `_str instanceof Email` (std `match.ts:568-594`).
6. **`stateMachine` states and events are typed `string`.** `m.create().transition("nope")` type-checks and throws at runtime.
7. **HKT with plain `tsc`.** `double(optionFunctor, Some(21))` with `Functor<F>`/`Kind` gives TS2345, but transformer output type-checks. Documented.
8. **Option annotations are kept after `Some(x)` → `x` erasure,** which causes strict output errors (the known annotation-erasure issue). Documented in fp.md.
9. **Several user-facing errors still use the generic TS9999:** `@tailrec` not in tail position, GenericDerivation failure, non-exhaustive match. TS9061/TS9062 are not emitted. The CLI never uses `renderDiagnosticCLI`; it prints one-line `tsc` format.

### Files changed

All in `/Users/deapovey/src/personal/typesugar/docs/guides/`: erased.md, error-messages.md, extension-methods.md, fp.md, fusion.md, graph.md, index.md, jsdoc-vs-decorators.md, library-manifest.md, mapper.md, match.md, math.md, operators.md, opt-out.md, parser.md, pattern-matching.md.

Scratch repros and edit scripts are in `/private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/docfix/guides-b/`. The helper modules I added (`gb-*.ts`/`.js`) are in the gitignored `/Users/deapovey/src/personal/typesugar/.typesugar/doc-examples/`.
