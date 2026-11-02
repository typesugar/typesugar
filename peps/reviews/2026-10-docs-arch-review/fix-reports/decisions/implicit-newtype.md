Both items are done and their tests pass. The only failures in the two suites come from another agent's unfinished test file.

**A. `= implicit()` calls are now specialized**

- **Fixed.** In `transformer.ts` `tryTransformImplicitsCall`, the completed call now goes through `tryAutoSpecializeFn` (the same path explicit calls take). If that declines, it falls back to the old `visitEachChild` route.
  - The comment there notes that this deliberately supersedes the PEP-056 parity choice in 7210ac66 (Dean's decision 2026-10-19).
  - `sortWith([3,1,2])` now emits a hoisted `__typesugar___sortWith_number_0__([3, 1, 2])` with the compare inlined. The output is byte-identical to the explicit `sortWith([3,1,2], numberOrd)`, and it runs.
  - The old dist already held the reverted r3 version; my code matches it.
- **Extra fix 1: `// @no-specialize` was ignored on implicit calls.** The rebuilt call has no parent chain, so the marker scan failed silently. `tryAutoSpecialize` in `specialization.ts` now reads the marker from the original call (`realLocation(node) ?? node`).
- **Extra fix 2: a real pre-existing bug.** Take `sortTwice(items, ord = implicit()) { return sortWith(sortWith(items)); }`. Specializing it dropped `ord`, and the hoisted copy then threw "implicit() requires the typesugar transformer" at runtime. This already happened for the explicit `sortTwice(xs, numberOrd)`; my change would have spread it to implicit calls.
  - New `findUnfilledImplicitCall` in `specialization.ts`: if a function's body calls an `= implicit()` function without passing the instance, the call is not specialized. It warns TS9602 and keeps dictionary passing, for both explicit and implicit calls.
- **Tests:**
  - `docs-review-engine-r3.test.ts` section 6 was rewritten. It checks the hoisted form, that the hoisted body has no `compare`, that the output runs to `[1,2,3]`, implicit equals explicit, `@no-specialize`, and the propagation fallback (explicit and implicit, with warning and runtime result).
  - Before the fix, the new section-6 tests failed as expected.
  - `implicit-no-autospec.test.ts` was renamed with plain `mv` to `implicit-autospec.test.ts`. It asserts `const result = __typesugar___showValue_…__(42)` and runs to `"42"` / `"show 42"`.
  - `typeclass-example.test.ts:17-18` now asserts `__typesugar___show_number_N__(42)` and `__typesugar___show_string_N__("hello")`.
- **Docs:**
  - `docs/guides/specialize.md`, "With `= implicit()`": implicit calls are specialized like explicit ones, with a new example of the propagated-dictionary fallback, and a bullet under "When Specialization Is Skipped".
  - `docs/guides/error-messages.md`: TS9602 lists the propagated `= implicit()` reason.
  - No other doc or README sentence said implicit calls aren't specialized.
- **Results:**
  - `packages/transformer/tests`: 603/603 pass.
  - `packages/transformer-core/tests`: 391/403. All 12 failures are in `macro-identity.test.ts`, an untracked test from the registry agent's work in progress (`lookupMacroByName is not a function`). Not mine.
  - tsc is clean for transformer-core and macros. transformer-core dist is rebuilt, and the doc examples run correctly against it.

**B. NewtypeAssignment rule deleted**

- **Removed:**
  - From `diagnostic-suppression-rules.ts`: `createNewtypeAssignmentRule` and its helpers (`findUnwrapNewtypeArgument`, `isUnwrapNewtypeTypeNode`, `isNewtypeBrandSymbol`, `hasNewtypeBrand`, `extractNewtypeBaseTypes`). `reportCheckerFailure` and the assignment helpers stay, because other rules use them.
  - Its registration and name-list entries, its test entry (rule counts updated), and the export in `packages/macros/src/index.ts` (one line; the other agent's ts-guard import there is untouched).
- **Proof test kept and reworded** ("@typesugar/type-system newtypes need no diagnostic suppression"): with no rules, the real library gives exactly `TS2322 bad1` and `TS2345 bad2`.
- **Root tests:**
  - `diagnostic-suppression-newtype`: retargeted to the real `packages/type-system/src/newtype.ts` with all built-in rules registered. Constructors produce no diagnostics, and the must-report cases stay reported, plus the Feet/Meters case moved in from must-report.
  - `must-report`: newtype section removed (it lives in the newtype file now).
  - `cli-pipeline`: the registration tests use MacroDecorator in its place; the newtype section and its parts of the combined test were dropped.
  - `opaque-integration` and `type-rewrite`: the coexistence-with-NewtypeAssignment blocks were removed.
  - `diagnostic-parity`: counts are now 6 and 5. The trivially-passing newtype test became "no rule hides an implicit Base → Newtype assignment".
- **Dropped one case:** `wrap<Meters>(seconds)` type-checks with the real library (`UnwrapNewtype<Meters>` is `number`). The old error came only from the old-shape local fixture. No doc claims it's an error; a comment in the test explains.
- **Docs:** no source doc or README mentions the rule; only generated `docs/.vitepress/dist` output does.
- **Results:** all 8 affected test files pass. macros dist is rebuilt.

**Changeset:** `.changeset/decisions-1.0-implicit-specialize-newtype-rule.md`, minor bumps for transformer-core and macros (the behaviour change, the new fallback, and the removed export).

**Decisions for Dean:**

- The propagated-dictionary fallback is new behaviour, and it also applies to explicit calls, which used to emit code that crashed.
- Changeset bumps are minor, not patch, because of the removed export.
- I rebuilt `@typesugar/core` dist from current source (no source edits). It lacked the TS-guard agent's `assertSupportedTypeScript`, which broke every `transformCode` test.

Every vitest, build and tsc ran through the limiter, one at a time, and none of my processes are still running. No git state was changed.

**Files changed:**

- `packages/transformer-core/src/transformer.ts`
- `packages/transformer-core/src/specialization.ts`
- `packages/transformer-core/tests/docs-review-engine-r3.test.ts`
- `packages/transformer/tests/implicit-autospec.test.ts` (renamed from `implicit-no-autospec.test.ts`)
- `packages/transformer/tests/typeclass-example.test.ts`
- `packages/macros/src/diagnostic-suppression-rules.ts`
- `packages/macros/src/diagnostic-suppression-rules.test.ts`
- `packages/macros/src/diagnostic-suppression-registration.ts`
- `packages/macros/src/diagnostic-suppression-registration.test.ts`
- `packages/macros/src/index.ts`
- `tests/diagnostic-suppression-newtype.test.ts`
- `tests/diagnostic-suppression-must-report.test.ts`
- `tests/diagnostic-suppression-cli-pipeline.test.ts`
- `tests/diagnostic-suppression-opaque-integration.test.ts`
- `tests/diagnostic-suppression-type-rewrite.test.ts`
- `tests/diagnostic-parity.test.ts`
- `docs/guides/specialize.md`
- `docs/guides/error-messages.md`
- `.changeset/decisions-1.0-implicit-specialize-newtype-rule.md`
- Rebuilt dists: core, transformer-core, macros
