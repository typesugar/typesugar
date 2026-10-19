## int-engine report

All four assigned failing files now pass. The follow-ups (including the `join` hijack you added mid-task) are done, each with a failing test written first. transformer-core dist and core dist are rebuilt.

**Final regression run** (one vitest, `--maxWorkers 3`): `packages/transformer-core/tests`, `packages/std/tests` and the two root diagnostic-suppression files gave 46 files, 926 tests, 1 failure. That failure is `arrow-let-yield.test.ts` (item 6), which I updated and re-ran together with `packages/transformer/tests`: 52 files, 596 tests, all passing. `tsc --noEmit` on transformer-core is clean. No processes of mine are left running.

### Per file / item

1. **`tests/diagnostic-suppression-cli-pipeline.test.ts:63`, `tests/diagnostic-suppression-must-report.test.ts:57`, `packages/transformer-core/tests/specialization-safety.test.ts:47`: case (c), fixed.**
   - **Why the tests broke:** the committed root `vitest.config.ts` exclude list stopped matching anything after d1ecfbdc switched to real globs, so the plugin macro-expanded test files. The tooling owner's glob fix (now apparently committed, since `vitest.config.ts` is clean in `git status`) stops that.
   - **The bug underneath is real for user code:** `host.directoryExists?.bind(host)` has receiver `F | undefined`. A union has only the properties all its members share, so `bind` did not count as native. The erased generic match from 71259ec3 then offered the call to every imported function's `Function.prototype.bind`.
   - **Fix in `import-resolution.ts`:**
     - The native-method check uses `getNonNullableType(receiver)`.
     - A qualifier member declared only in default lib files (`bind`/`call`/`apply`/`toString`…) is never an extension candidate.
     - The same export reached two ways (`import { head }` plus `import * as std` from one module) is de-duplicated instead of being reported as ambiguous.
   - **Test:** `docs-review-engine.test.ts` › "never redirects a native Function method on an optional receiver" (executes the output).

2. **`packages/std/tests/match-execution.test.ts:391`: not a code bug; fixed by the `vitest.config.ts` change.**
   - It passes with the working-tree config and fails with the committed one. I checked by running the test against a temporary copy of `HEAD:vitest.config.ts` (now deleted).
   - std's `match` is both the runtime function and the macro, so expanding `runtimeMatch` is correct behaviour once the file is macro-expanded. The test simply must not be expanded. No resolution change was needed.

3. **TS9222 help text: done.** "At module top level" is gone from the help in `transformer-core/src/transformer.ts` and from the explanation in `packages/core/src/diagnostics.ts`.
   - I edited core because nobody else owns it; tell me if that is a problem.
   - **Test:** `packages/transformer/tests/comprehension-value-positions.test.ts` › "the TS9222 help…" now also asserts the text has no "top level".

4. **Chained Range rewrites: fixed in `rewriting.ts`.**
   - **Cause:** this was not the synthetic receiver. Range is a plain interface, so the checker types `(1).to(5).reversed()` as an error type.
   - **Fix:** new `inferExtensionCallType` recovers the type inside-out, from the original real nodes only. It takes the return type of the imported extension the inner call will be rewritten to.
   - **Limits:**
     - It skips generic extension signatures, which keep the existing "receiver type could not be resolved" warning.
     - It deliberately does not bail when the receiver has a non-callable member of the same name, because Range has a `step: number` field.
   - **Found on the way:** `getSymbolsInScope(..., Value)` leaves out import aliases, so the new code uses `Value | Alias`. The existing `isExtensionCalleeBound` uses `Value` only and probably never sees imported callees. I left it alone because the import resolver covers that case.
   - **Test:** `packages/std/tests/range-readme-exec.test.ts` › "chained extension calls on a rewritten receiver" covers `reversed().toArray()`, `step(10).toArray()`, `step(3).reversed().toArray()` and `reversed().size()`, all executed.

5. **Collapsing the `__letyield_N` temp: done.**
   - `const __letyield_N = E; <decl> x = __letyield_N;` becomes `<decl> x = E`.
   - `export default __letyield_N` becomes `export default E`.
   - Implemented as `collapseCompValueSlots` in `transformer-utils.ts` (built with `ts.factory.update*`) and called from `visitStatementContainer`.
   - **Test:** `comprehension-value-positions.test.ts` › "a const / export default comprehension emits `const r = <chain>` (no tag temp)" (executed).

6. **`packages/std/tests/arrow-let-yield.test.ts` › export default: case (b), caused by my item 5.** It pinned the old `const __letyield_N = …; export default __letyield_N` output. It now asserts `export default Effect.flatMap(` and no `__letyield_`, and is renamed "exports the comprehension chain directly".

7. **`import { join } from "node:path"; xs.join("/")` (from int-misc): fixed.**
   - `receiverMatchesFirstParam` no longer treats a rest first parameter as the receiver slot.
   - **Test:** `docs-review-engine.test.ts` › "a rest-parameter function named like a native method does not hijack it" (executed). I also checked real `node:path` against the rebuilt dist: `xs.join("/")` is left alone.

### Decision for Dean

int-misc also suggested that a bare named import should never replace a method the receiver natively has. I did not do this. The current design (see the comment in `scanImportsForExtension`) deliberately allows a bare imported function named after a method to override it explicitly. With the rest-parameter fix, `join` no longer qualifies anyway. Restricting the explicit override is a product decision.

### Needs from other owners

None. The `vitest.config.ts` glob fix must stay committed; it is what makes `match-execution` and the three bind files pass in a full run.

### Files changed

- `/Users/deapovey/src/personal/typesugar/packages/transformer-core/src/import-resolution.ts`
- `/Users/deapovey/src/personal/typesugar/packages/transformer-core/src/rewriting.ts`
- `/Users/deapovey/src/personal/typesugar/packages/transformer-core/src/transformer.ts`
- `/Users/deapovey/src/personal/typesugar/packages/transformer-core/src/transformer-utils.ts`
- `/Users/deapovey/src/personal/typesugar/packages/core/src/diagnostics.ts` (TS9222 explanation text only)
- `/Users/deapovey/src/personal/typesugar/packages/transformer-core/tests/docs-review-engine.test.ts`
- `/Users/deapovey/src/personal/typesugar/packages/std/tests/range-readme-exec.test.ts`
- `/Users/deapovey/src/personal/typesugar/packages/std/tests/arrow-let-yield.test.ts`
- `/Users/deapovey/src/personal/typesugar/packages/transformer/tests/comprehension-value-positions.test.ts`

### Behaviour the docs should now describe

- Chained Range extension calls such as `(1).to(10).step(2).reversed().toArray()` work.
- `const result = let: …` works anywhere, not only at module top level.
- Expression-position comprehensions emit `const r = <chain>` and `export default <chain>` directly, with no temp variable.

Nothing is left failing.
