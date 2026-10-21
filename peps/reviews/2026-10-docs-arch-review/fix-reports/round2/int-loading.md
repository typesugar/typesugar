## int-loading report

**The hypothesis is mostly wrong.** The macro-loader change in d1ecfbdc is not the main cause. The cause is the other part of that commit: unplugin's `include`/`exclude` changed from substring matches to globs. The root `vitest.config.ts` excluded `"tests"`, `"packages/transformer"`, `"packages/core"` and so on. As substrings, `"tests"` covered every `tests/` and `__tests__/` directory and `"packages/transformer"` also covered transformer-core. Before that commit, the root plugin never macro-expanded any test file. As globs, those entries match only the exact directories, so every test file started being expanded. Stub-throw probes and invalid-usage probes then failed to compile.

Also: vitest is 2.1.9, which ignores `test.projects`. The "legacy" project and every `packages/*/vitest.config.ts`, including mapper's own typesugar plugin, play no part in root runs. Everything runs as one project under the root plugin. I reported this and did not change it.

**About the coordinator's FYI:** the `vitest.config.ts` glob edit is mine.

### Fix (case a, regression): `/Users/deapovey/src/personal/typesugar/vitest.config.ts`

- **New exclude list:** `packages/core/**`, `packages/transformer*/**`, `packages/unplugin-typesugar/**`, `packages/vscode/**`, `**/tests/**`, `**/__tests__/**`, with a comment saying why.
- **Same set as before:** I checked it against all 1,167 tracked .ts/.js files. The new globs exclude exactly the same files as the old substring filter (0 differences).
- **No per-file opt-outs:** test files were never meant to be expanded, so none are needed.

### Per file (all now pass with the config fix)

Two batches, run alone: 10 passed plus 1 skipped file (310 tests), and 8 passed (286 tests). The skipped file was already skipped before (`describe.skip` in red-team-mapper).

| File                                                                                                                                                     | Case  | Notes                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| strings, mapper api, mapper-nested, red-team-mapper, effect fused/compiled/layer-make, validate macros, parser grammar, erased-extended, testing.test.ts | a     | Deliberate runtime-stub or invalid-usage probes. Fixed by the config, tests unchanged.                                                                                                            |
| contracts.test.ts                                                                                                                                        | a     | Fixed by the config. A statically false `requires(false)` and `old()` outside `ensures` are now compile errors when expanded, which I think is correct. The test's deliberate runtime call stays. |
| erased-extended (Show<number>)                                                                                                                           | —     | A real diagnostic, given the file imports no instance provider. Not a bug.                                                                                                                        |
| units.test.ts, red-team-units                                                                                                                            | a + c | Pass via the config. They exposed latent bug 1 below.                                                                                                                                             |
| units-macro-expansion                                                                                                                                    | a + c | Passes via the config. New tests added for bugs 1 and 2.                                                                                                                                          |
| math modular.test.ts                                                                                                                                     | a + c | Passes via the config. Exposed latent bug 2.                                                                                                                                                      |
| red-team-macros                                                                                                                                          | a + c | Passes via the config. Exposed latent bug 3.                                                                                                                                                      |
| red-team-testing                                                                                                                                         | a + c | Passes via the config. Exposed latent bug 4.                                                                                                                                                      |
| generic.test.ts                                                                                                                                          | a + b | Passes via the config. The `typeAssert` there had never been checked, and its expectation was wrong.                                                                                              |

### Latent bugs fixed (failing test first, each one reproduced)

1. **`units` with a negative literal crashed the expansion.** `units\`-5 m\`` hit TypeScript's "Debug Failure. Negative numbers should be created in combination with createPrefixUnaryExpression".
   - Fix: a `numberLiteral()` helper in `packages/units/src/macros.ts` builds `-` applied to a positive literal, through the AST factory.
   - Test: `units-macro-expansion.test.ts`, "negative literals expand and run". It runs the output and checks -5 m, -2.5 kg and a plain -3.
2. **The `units` macro had no `module`.** Any function whose original export name is `units` got expanded. `import { modUnits } from "@typesugar/math"` followed by `modUnits(6)` was a compile error ("Invalid units() call").
   - Fix: added `module: "@typesugar/units"`.
   - Test: "leaves another module's function named `units` alone", using an in-memory two-file host.
   - Through the real pipeline, the `@typesugar/math` re-export of `units` still expands, and `modUnits` runs (`5 m -3 kg 1,5`).
3. **Auto-specialization hoisted names could be invalid identifiers.** A brand taken from type text such as `any[]` produced `const __typesugar___double_any[]_0__ = ...`, so the output would not parse.
   - Fix: `toIdentifierText()` in `SpecializationCache.generateHoistedName` (`packages/macros/src/specialize.ts`) replaces every character that can't appear in an identifier with `_`. It checks each character with `ts.isIdentifierPart` (no regex).
   - Test: `tests/specialize-improvements.test.ts`, "produces a valid identifier when a brand is a type's text".
   - Checked end to end: the example now runs and gives `[2,4,6]`. transformer-core specialization tests still pass.
4. **`Extends<A, B>` was distributive.** `Extends<never, string>` gave `never` and `Extends<string | number, string>` gave `boolean`.
   - Fix: `[A] extends [B] ? true : false` in `packages/type-system/src/type-utils.ts`.
   - Test: `packages/type-system/tests/runtime.test.ts`, "Extends is not distributive". It type-checks under strict and covers `null`/`undefined` too.
   - `@typesugar/testing` re-exports this type, so it gets the fix as well.
5. **`tests/generic.test.ts` (case b, wrong assertion):** `GenericMeta.kind` is `readonly`, so the expected type is now `{ readonly kind: ... }`. Its typeAssert now resolves cleanly through the real pipeline.

I rebuilt the dists for `@typesugar/units`, `@typesugar/macros` and `@typesugar/type-system`. The units, type-system, math modular/bridge-esm and specialize-improvements tests pass. I ran prettier on the changed files.

### Decisions for Dean

- Test files stay unexpanded under the root plugin, which keeps the old behaviour. The other choice would mean rewriting many tests written for the runtime stubs.
- Making a statically false precondition a compile error is acceptable.
- Not changed: through a non-strict `transformCode`, `typeAssert<Not<Extends<null, undefined>>>` reports as false. That comes from strictNullChecks being off, not from `Extends`.

### Needs / observations for other owners

- **unplugin owner:** your concurrent `unplugin.ts` edit (an empty `include` matches nothing; relative `node_modules` ids are excluded) doesn't affect my config fix.
- **transformer (macro-loader / import-resolution), observation only:** strings.test.ts failed in the full run but passed alone, so whether a file's macros expand depends on which files ran first. A relative import into a package's src (for example `../src/index.js`, mapped back to `@typesugar/strings`) expands only if some earlier file loaded that package's macros by its package name. This is low priority for users, but worth knowing.
- **Infra, for the orchestrator to decide:** root `test.projects` is ignored by vitest 2.1.9 (it would need `workspace`, or an upgrade to vitest 3.2 or later). The package vitest configs are dead in root runs.

### Files changed

- /Users/deapovey/src/personal/typesugar/vitest.config.ts
- /Users/deapovey/src/personal/typesugar/packages/units/src/macros.ts
- /Users/deapovey/src/personal/typesugar/packages/units/tests/units-macro-expansion.test.ts
- /Users/deapovey/src/personal/typesugar/packages/macros/src/specialize.ts
- /Users/deapovey/src/personal/typesugar/tests/specialize-improvements.test.ts
- /Users/deapovey/src/personal/typesugar/packages/type-system/src/type-utils.ts
- /Users/deapovey/src/personal/typesugar/packages/type-system/tests/runtime.test.ts
- /Users/deapovey/src/personal/typesugar/tests/generic.test.ts

Nothing assigned to me is still failing, and no process of mine is running. The vitest process still running belongs to the transformer-core agent.
