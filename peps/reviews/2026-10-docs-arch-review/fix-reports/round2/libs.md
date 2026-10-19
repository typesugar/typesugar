## Libs group report (type-system, validate, parser, contracts, contracts-refined, math)

I reproduced all 7 findings with a failing test first, and every test failed for the reason the finding gave. All are fixed, and the dists are rebuilt for type-system, validate, parser, contracts and math (contracts-refined needed no change). Package test suites pass: type-system 34, validate 36, parser 209, contracts 154, contracts-refined 107, math 494, plus root `tests/red-team-type-system.test.ts` (71). `tsc --noEmit` is clean in type-system, validate, parser, math and contracts. No process of mine is still running.

### Per finding

1. **C#12 type-system — fixed.** Test: `packages/type-system/tests/runtime.test.ts`, "docs C#12: Newtype base-type extraction" (typechecks `wrap<UserId>(42)`, `mkUserId(42)`, `newtypeCtor<Email>`, `validatedNewtype`, `calculateArea(wrap<Meters>(10), wrap<Meters>(5))`, and checks that brand mixing still gives 3 errors). `Newtype<Base, Brand>` now also carries a phantom `readonly [__base]: Base`, and `UnwrapNewtype<T> = T extends { readonly [__base]: infer Base } ? Base : T`. Running plain `tsc` on the doc quick start against dist now passes. **Docs should say:** the quick-start examples type-check with plain tsc as written.
   - One leftover: the expanded output still gets a strictOutput warning at `calculateArea(10, 5)`, because `wrap` erases to the bare literal. Not fixed; it is a separate design point (`wrap` could emit `10 as Meters`).
2. **C#25 validate — fixed (from source); does not work from dist.** Test: `packages/validate/src/__tests__/schema-specialize.test.ts` (both the `NativeSchema` form and the guide's generic `Schema<F>` form are specialized and executed). Two changes to `nativeSchema` in `schema.ts`:
   - It now has a `@impl Schema<ValidatorF>` tag.
   - `parse` is now expression-bodied (`validator(data) ? data : (() => { throw … })()`). Even with the tag, the old block body with `throw` failed inlining with TS9602 "inlining returned no result".
   - **Limitation:** a consumer importing `@typesugar/validate` from dist is still not specialized, and gets no TS9602. The `.d.ts` has no object literal to inline. The same is true of fp's `@impl` instances (`mapTwice(optionFunctor, …)` from dist stays unspecialized). This is a cross-package limitation in macros/instance-extraction, not something validate can fix.
   - **Docs should say:** passing `nativeSchema` specializes when its source is visible to the compiler, and not yet across a published package boundary. Keep the zero-cost claim softened.
3. **B#21 / W#24 parser — fixed, line/col added.** Tests: `grammar-macro.test.ts` "docs B#21 / W#24…" (inlined parser, with and without the user importing `ParseError`), `grammar.test.ts` "throws ParseError…", `combinators.test.ts` "error carries 1-based line/col".
   - The inlined `parseAll` now throws `new ParseError(input, pos, expected)`, referenced through `ctx.ensureImport("ParseError", "@typesugar/parser")` and built as AST.
   - The runtime `grammar`/`buildParser` also threw plain `Error` before; it now throws `ParseError` too.
   - `ParseError` gains `line` and `col` (1-based).
   - **Docs should say:** the README example (`err instanceof ParseError`, `${err.line}:${err.col}`) now works with or without the transformer.
4. **A#20 contracts `formatCertificate` — fixed.** Test: `contracts-coq.test.ts` "summary never prints 'undefined'…". The summary falls back to `step.description`, or to plain "Proven by X", and a step with no description prints no description line. The guide's example now prints "Summary: Proven by linear: x > 0 implies x >= 0". **Docs should say:** the guide's step literal omits the required `justification`, `subgoals` and `usedFacts`, so it is a type error under tsc. Use `createStep(rule, description, justification)` and paste the real layout ("Proof Certificate / Goal: / Status: ✓ PROVEN / Method: …").
5. **S#22 contracts `ensures: { result => … }` — fixed by supporting the form.** Test: `contracts-e2e.test.ts` "docs S#22…" (executes and throws `PostconditionError`).
   - The finding asked for an error unless support was trivial. It was: the arrow form outside braces was already supported, so a lone arrow inside an `ensures` block is now treated the same way (its parameter is bound to the result).
   - As a backstop, a function value used as a condition anywhere else (for example inside `requires: { … }`) is now a compile error explaining that it is always truthy.
   - **Docs should say:** the home-page `sqrt` example works as written. `ensures: { result >= 0 }` is the canonical form.
6. **B#13 math — fixed.** Test: `modular.test.ts` "docs B#13: mismatched moduli". `modAdd`, `modSub`, `modMul` and `modDiv` now throw `RangeError("<op>: moduli differ (…)")`, and so do the `numericMod` methods built on them. The file's JSDoc no longer claims a compile-time error: tsc confirms that N is inferred as `7 | 11`, so it type-checks. **Docs should say:** mixing moduli throws RangeError at runtime and is not a type error.
7. **A#19 contracts-refined inline `requires` — fixed (small; the fix is in contracts).** Test: `contracts-e2e.test.ts` "docs A#19…".
   - Inline `requires(...)` never called the prover.
   - Under `proveAtCompileTime` it now runs `tryProve` with the enclosing function's parameter facts.
   - This only happens when the call is at function entry: a direct body statement preceded only by other `requires(...)`. Otherwise a parameter could have been reassigned before the check. A test covers that case.
   - **Docs should say:** the contracts.md:113 comment ("elided when proveAtCompileTime is on (Positive type)") is now true.

### Decisions

- C#25: rewrote `nativeSchema.parse` as an expression body so it can be inlined; behaviour and message are unchanged.
- B#21: `ParseError`'s message adds a context snippet on a second line. The text emitter `generateParserCode` (codegen.ts, a typescript-free string API) still throws a plain `Error` with the same first line. The parity tests (`codegen-parity.test.ts`, `codegen.test.ts` TSP-12) now compare first lines across emitters, plus the full message, class and fields between the AST emitter (given a ParseError ref) and the runtime. When a ref is passed, the AST emitter no longer emits the unused `__lineCol` helper.
- S#22: chose to support the form (trivial) over making it an error, plus the always-truthy error elsewhere.
- No `parseStatements`/`parseExpression` call sites were added; all codegen is `ts.factory`.

### Needs from other owners

- `packages/macros/src/diagnostic-suppression-rules.ts`, Rule 3 (NewtypeAssignment): it existed to hide the TS2345 that fix 1 removes. It is probably dead now and its comment (lines 507-530) describes the old bug. Consider removing or updating it. The `tests/diagnostic-suppression-newtype.test.ts` tests use a local copy of the old types, so they are unaffected.
- macros/instance-extraction and transformer-core specialization: instances imported from a package's dist are never specialized, and no warning says so. This affects validate and fp alike. It needs a manifest or registry, or at least a visible TS9602 for "instance declared in a .d.ts".

### Files changed

- packages/type-system/src/newtype.ts, packages/type-system/tests/runtime.test.ts
- packages/validate/src/schema.ts, packages/validate/src/**tests**/schema-specialize.test.ts (new)
- packages/parser/src/{combinators,grammar,codegen-ast,macros}.ts, packages/parser/src/**tests**/{grammar-macro,grammar,combinators,codegen-parity,codegen}.test.ts
- packages/contracts/src/prover/certificate.ts, src/parser/contract-block.ts, src/parser/predicate.ts, src/macros/requires.ts, tests/contracts-coq.test.ts, tests/contracts-e2e.test.ts
- packages/math/src/types/modular.ts, packages/math/tests/modular.test.ts

Nothing is left failing. Scratch probes are in /private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/fix2/libs/.
