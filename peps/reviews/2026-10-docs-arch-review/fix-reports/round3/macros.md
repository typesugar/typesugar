## r3-macros report

All six findings are handled, plus the extra reflect item. Two tests still fail on purpose: each waits on a one-line change in a file I don't own (see "Needs from other owners"). Each test failed before its fix, and both remaining failures were checked to fail for the expected reason. Dists rebuilt: core, macros (after the reflect change), testing, typesugar. Typecheck is clean for macros, testing and typesugar. `check-runtime-purity` passes, and `generate-error-docs --check` passes (72 codes).

### Per finding

1. **@impl companion: fixed.** Test: `packages/macros/tests/docs-r3-review.test.ts`, "#1 …custom-Box let: example" and "proper-type instance". The companion is now `namespace Box { export const FlatMap = flatMapBox; }`. The `as FlatMap<Box>` assertion added nothing and never type-checked, so it is gone; the companion takes the instance's own type. The std README Box example now has no strictOutput warnings and runs (`{"value":10}`).
2. **Comment leak: fixed.** Tests: "#2 authoring derive example" (e2e, prints with no comments and runs) and "every node … (tokens included) is synthetic". Root cause: core's `stripPositions` walks with `visitEachChild`, which skips token children (`===`, `&&`, `=>`). Those tokens kept their offsets from the temporary parse file, so the printer emitted whatever comment the user's file had at that offset. Fix: a `parseDerivedExpression` helper in auto-derive.ts resets every node and token using `ts.forEachChild`. It is used at all 3 cached-string parse sites, so it adds no new parse call.
3. **TS9999 codes: partially fixed.**
   - `@tailrec`: fixed. Every failure now reports TS9220 (I removed it from RESERVED_CODES and regenerated the docs). Test: "#3 @tailrec … TS9220".
   - GenericDerivation failure: I added a new **TS9106** "Cannot derive {typeclass} for '{type}'" descriptor (docs/errors/TS9106.md generated). `tryExpandGenericDerive` now throws a `GenericDeriveError`, and a new exported `reportGenericDeriveFailure(ctx, node, deriveName, error)` emits TS9106 with the trace as a note. The unit test passes ("reportGenericDeriveFailure turns … into TS9106").
   - The e2e test "a failed generic derivation reports TS9106" **still fails** (it still gets the TS9999 "GenericDerivation failed" error). The error is reported from transformer-core, which I don't own.
4. **staticAssert: partially fixed.**
   - (a) Fixed. A failing assertion now emits `// staticAssert: "math is broken" ✗ FAILED`. A non-boolean condition now gets the "unverified" comment instead of ✓. Tests: `packages/macros/src/static-assert.test.ts`, "docs review r3 #4" (two tests).
   - (b) The `as const` case is **not fixed**; its test there **still fails** (it gets TS9219). The cause is core's evaluator (`packages/core/src/context.ts` `evaluateNode`), which doesn't unwrap `as`/`satisfies`. That file isn't mine.
5. **createMacroTestContext printing: fixed.** Test: `packages/testing/tests/macro-context-print.test.ts` (4 tests). Its `parseExpression`/`parseStatements` now make every node and token position-free. `quote(ctx)\`1 + 2\``prints`1 + 2`, and spliced arguments and statements print correctly.
6. **Umbrella exports: fixed.** Test: `packages/typesugar/tests/runtime-bundle.test.ts`, "derive markers from the umbrella". `Show`, `Semigroup` and `Monoid` are exported from `@typesugar/macros/runtime` and from `typesugar`. They are the same objects as in macros, and a browser bundle of them pulls in no typescript.

- **Extra (reflect validator, from the coordinator): fixed.** reflect.ts `fieldAccess` now reads fields through `(value as Record<string, unknown>)` in both the property and element branches. I flipped `it.fails` to `it` in packages/reflect/tests/validator-output.test.ts, and it passes. I also updated one text assertion in packages/macros/src/validator.test.ts to the new output shape; its behaviour assertions are unchanged.

### Docs updated

- **error-messages.md:** the `@tailrec` sample now reads `error TS9220: [typesugar] [TS9220] @tailrec: …`, checked against real output.
- **derive.md:** says `Show`/`Semigroup`/`Monoid` come from `typesugar`. Verified: `import { derive, Show, Semigroup, Monoid } from "typesugar"` runs and prints `Point(x = 1, y = 2)`.
- **testing-macros.md:** the "quote output garbles, use transformCode" note is replaced with "prints correctly".

Left unchanged until the needs below land:

- **error-messages.md:97** and **derive.md:401** (GenericDerivation text). Once the transformer-core change lands, they should show `error TS9106: [typesugar] [TS9106] Cannot derive Eq for 'UserProfile'` followed by `= note: resolution trace…`.
- **testing.md:76-78** (the `as const` gotcha). Once the core change lands, `as const` and `satisfies` values should count as compile-time constants.

### Decisions for Dean

- I dropped the companion's type assertion entirely rather than synthesising an import of the typeclass type plus an HKT form. The instance's own type is what the companion should carry anyway.
- TS9106 is a new descriptor rather than a reuse. TS9101 is specific to one field, and TS9214 ("Macro expansion failed") reads like a bug in the macro.
- A failed staticAssert's comment is now `✗ FAILED`.

### Needs from other owners

1. **transformer-core, `packages/transformer-core/src/macro-helpers.ts:674`:** replace `ctx.reportError(arg, \`GenericDerivation failed for ${deriveName}: ${error}\`);`with`reportGenericDeriveFailure(ctx, arg, deriveName, error);`, imported from `@typesugar/macros`. That makes the TS9106 e2e test pass.
2. **core, `packages/core/src/context.ts` `evaluateNode`:** near the top, add `if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node)) return this.evaluateNode(node.expression);`. Do the same unwrapping in `isComptime`. That fixes the `as const` staticAssert test.
3. **core, `packages/core/src/ast-utils.ts`:** `stripPositions`, `stripCommentsDeep` and `cloneNodeDeep` skip token children, which is the root cause of #2. Pass a tokenVisitor (5th argument of `visitEachChild`) or walk with `ts.forEachChild`. Every `ctx.parseExpression` user outside auto-derive can still leak comments through operator tokens.

### Files changed

- packages/macros/src/{typeclass.ts, auto-derive.ts, tailrec.ts, static-assert.ts, static-assert.test.ts, runtime-stubs.ts, index.ts, reflect.ts, validator.test.ts}
- packages/macros/tests/docs-r3-review.test.ts (new)
- packages/testing/src/macro-context.ts, packages/testing/tests/macro-context-print.test.ts (new)
- packages/typesugar/src/{index.ts, derive-markers.ts}, packages/typesugar/tests/runtime-bundle.test.ts
- packages/core/src/diagnostics.ts (TS9106 added)
- scripts/generate-error-docs.mjs (TS9220 removed from RESERVED_CODES), docs/errors/TS9220.md, docs/errors/TS9106.md (new), docs/errors/index.md
- packages/reflect/tests/validator-output.test.ts (the one line)
- docs/guides/error-messages.md, docs/guides/derive.md, docs/writing-macros/testing-macros.md

### Still failing (both expected until the needs above land)

- `docs-r3-review.test.ts` > "a failed generic derivation reports TS9106…": gets `[typesugar] GenericDerivation failed for Eq: Error: cannot derive Eq for 'UserProfile'…` instead.
- `static-assert.test.ts` > "`as const` object property reads…": gets a TS9219 error for `const CONFIG = { TIMEOUT: 5 } as const;`.

Scratch repros are in /private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/fix3/r3-macros/. No processes of mine are still running.
