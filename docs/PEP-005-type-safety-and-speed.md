# PEP-005: Type Safety and Speed — Matching the TypeScript Developer Experience

**Status:** Draft
**Date:** 2026-03-14
**Author:** Dean Povey
**Depends on:** PEP-002 (oxc backend), PEP-004 (source-based typeclass features)

## Context

TypeScript developers expect a specific experience:

- **Dev server is instant.** Vite, esbuild, SWC strip types without checking them. Feedback comes from the bundler in milliseconds.
- **IDE shows errors in background.** tsserver runs incrementally, red squiggles appear as you type.
- **CI blocks on correctness.** `tsc --noEmit` runs in CI. Broken types don't merge.

typesugar now has this same split (PEP-002 delivered the oxc backend for speed), but macros introduce a wrinkle: **macros participate in creating the type structure.** `@derive(Eq)` creates `.equals()`. `summon<Eq<Point>>()` resolves to a concrete instance via the TypeChecker. Extension methods rewrite `point.show()` to `showPoint.show(point)` based on type information.

This means:

1. **Pre-macro typechecking is incoherent.** Code that uses `@derive(Eq)` is intentionally type-incomplete before macros run — the methods don't exist yet.
2. **OXC backend has no TypeChecker.** Files without type-aware macros get fast transforms but zero type validation during the build.
3. **Macro-generated code may have type errors** that only `strict: true` or a separate `tsc --noEmit` catches.
4. **Macros that depend on types can silently degrade** when the TypeChecker returns incomplete information (e.g., `any` for unresolved types).

### Current State

| Context | Typechecking | Speed |
|---------|--------------|-------|
| OXC backend build | ❌ None | ⚡ Fast |
| TS backend build | ⚠️ Macro validation only (ctx.reportError) | Slower |
| `strict: true` | ✅ Post-macro typecheck | +Full tsc pass |
| IDE (language service) | ✅ Transform-first, then typecheck | Background |
| CI (`tsc --noEmit`) | ✅ Full typecheck | Separate step |

### The Gap

The ecosystem pattern is: **fast build + background IDE typecheck + CI gate.** typesugar matches this, but there are gaps:

1. **Macro diagnostic quality varies.** Some macros emit rich `DiagnosticBuilder` errors (TS9001-TS9999), others fall back to bare `ctx.reportError()` strings. The user experience is inconsistent.
2. **No "type confidence" signal.** When a macro asks the TypeChecker for a type and gets `any` (because of upstream errors), there's no standard way to detect and warn about this.
3. **`strict: true` is all-or-nothing.** It typechecks every file's expanded output at build end. There's no way to typecheck incrementally or only changed files.
4. **OXC → TS fallback is file-level.** A file with one `@impl` falls back entirely to TS. There's no partial acceleration.
5. **Language service doesn't surface macro diagnostics.** `ctx.reportError()` during transformation doesn't propagate to the IDE as red squiggles — only TypeScript's own diagnostics are shown.
6. **Documentation doesn't explain the model.** Users don't know that Vite doesn't typecheck, or that `strict: true` exists, or how the IDE fits in.

### Design Principles

1. **Match the ecosystem.** Don't fight how TypeScript works. Fast dev builds, background IDE checking, CI correctness gate.
2. **Macros should fail loudly.** When a macro can't do its job due to type issues, the error should be as clear as a TypeScript error — with source location, explanation, and fix suggestion.
3. **No silent degradation.** If a macro skips rewriting because the type resolved to `any`, that should be visible somewhere — not silently producing different runtime behavior.
4. **Incremental where possible.** Don't typecheck the whole project when one file changed.

## Waves

### Wave 1: Documentation — Explain the Model

Make the "fast build + IDE + CI" model explicit in all user-facing docs so users understand how to get type safety.

**Tasks:**

- [x] Add `backend` option to `docs/getting-started.md`
- [x] Add `backend`, `strict`, and typechecking guidance to all environment docs (vite, esbuild, webpack, tsc, bun, vitest, jest, rollup, monorepo)
- [x] Add a dedicated `docs/guides/type-safety.md` guide that explains:
  - The three-layer model (build, IDE, CI)
  - Why pre-macro typechecking is incoherent
  - How macros validate types during expansion
  - When to use `strict: true` vs `tsc --noEmit`
  - Recommended CI configuration
- [x] Add typechecking section to `docs/architecture.md`

**Gate:**

- [x] Every environment doc mentions `backend` and typechecking
- [x] `docs/guides/type-safety.md` exists and is linked from the guides index

### Wave 2: Macro Diagnostic Quality Audit

Audit all built-in macros and upgrade their error reporting to use `DiagnosticBuilder` with rich context.

**Tasks:**

- [x] Inventory all `ctx.reportError()` / `ctx.reportWarning()` calls in `packages/macros/src/`
- [x] Identify calls that should use `DiagnosticBuilder` instead (i.e., they have enough context to provide labeled spans, fix suggestions, or see-also links)
- [x] Upgrade priority macros:
  - [x] `summon()` — uses `DiagnosticBuilder` with TS9001/TS9005/TS9008, resolution trace as notes, import suggestions
  - [x] `@derive` failures — uses TS9060/TS9101/TS9102 with labeled spans and suggestions
  - [x] Operator rewrite — uses TS9203/TS9803 with fix suggestions
  - [x] Extension method resolution — uses TS9206/TS9402/TS9403 with usage help
  - [x] `= implicit()` resolution — uses TS9001 with resolution trace and import suggestions
- [x] Ensure all diagnostics include import suggestions via `getSuggestionsForSymbol()` / `getSuggestionsForTypeclass()`

**Gate:**

- [x] All type-aware macros use `DiagnosticBuilder` for user-facing errors
- [x] At least 5 error scenarios produce labeled-span diagnostics with fix suggestions
- [x] No bare string `ctx.reportError()` calls for resolvable type errors

### Wave 3: Type Confidence Detection

Add infrastructure for macros to detect when the TypeChecker is returning unreliable information.

**Tasks:**

- [x] Add `ctx.isTypeReliable(type: ts.Type): boolean` to `MacroContext`:
  - Returns `false` if type is `any` (implicit — not annotated)
  - Returns `false` if type is `error` type
  - Returns `false` if the containing file has semantic errors affecting this node
  - Returns `true` otherwise
- [x] Add `ctx.assertTypeReliable(node: ts.Node, purpose: string)` convenience:
  - Checks `isTypeReliable` on the node's type
  - If unreliable, emits a diagnostic: "typesugar skipped [purpose] because the type of [node] could not be resolved. Fix upstream type errors first."
  - Returns the type if reliable, `null` if not
- [x] Integrate into key macro sites:
  - [x] `extractMetaFromTypeChecker()` — warn when field types resolve to `any`
  - [x] Operator rewrite — warn when operand type is unreliable
  - [x] Extension method resolution — warn when receiver type is unreliable
  - [x] Auto-specialization — warn when function parameter types are unreliable

**Gate:**

- [x] `ctx.isTypeReliable()` exists and is tested
- [x] Macros that skip rewriting due to unreliable types emit a diagnostic
- [x] A test case demonstrates: file with type error → macro skips with clear message → fix type error → macro works

### Wave 4: Language Service Macro Diagnostics

Surface macro expansion diagnostics (from `ctx.reportError()`) in the IDE as red squiggles.

**Tasks:**

- [x] During language service transformation, collect macro diagnostics from the pipeline's `TransformResult.diagnostics`
- [x] Map diagnostic positions back to original source coordinates (using the pipeline's `PositionMapper`)
- [x] Inject macro diagnostics into `getSemanticDiagnostics()` alongside TypeScript's own diagnostics
- [x] Use typesugar error code range (TS9001-TS9999) so they're distinguishable from native TS errors
- [x] Ensure diagnostics survive incremental updates (cached transformations retain their diagnostics)

**Gate:**

- [x] `summon<Eq<UnknownType>>()` shows a red squiggle in VS Code with "No instance found for Eq<UnknownType>"
- [x] Fix suggestions from `DiagnosticBuilder` appear in the IDE's "Quick Fix" menu
- [x] Macro diagnostics disappear when the issue is fixed (no stale squiggles)

### Wave 5: Incremental Strict Mode

Make `strict: true` incremental — only typecheck files that changed or whose macro output changed.

**Tasks:**

- [ ] Track which files produced changed output during transformation
- [ ] On `buildEnd`, only create the expanded program for changed files (+ their dependents)
- [ ] Cache the previous strict typecheck results; only re-check invalidated files
- [ ] Add `strict: "incremental"` option (vs `strict: true` for full check, `strict: false` for none)
- [ ] Measure and report strict typecheck time in verbose mode

**Gate:**

- [ ] `strict: "incremental"` typechecks only changed files
- [ ] Rebuild after single-file change is <50% of full strict typecheck time
- [ ] Full `strict: true` behavior unchanged

### Wave 6: Adversarial Red Team — Type Safety Bypass and Error Quality

Systematically try to write code that bypasses typesugar's type safety guarantees or produces confusing/misleading errors. For each finding, either fix the issue or improve the diagnostic. This wave is iterative — run attacks, triage findings, fix, repeat.

**Attack Categories:**

| Category | Goal | Example |
|----------|------|---------|
| Silent wrong code | Macro generates code that compiles but does the wrong thing | Derive Eq for type with `any` field → comparison always true |
| Typecheck bypass | Code that should error but doesn't | Use OXC backend to skip type-aware validation entirely |
| Confusing errors | Valid typesugar code that produces incomprehensible errors | Typo in type name → "Cannot read properties of undefined" in macro internals |
| Misleading errors | Error points to wrong location or suggests wrong fix | Missing import → error appears on unrelated line |
| Degraded expansion | Macro silently skips or produces suboptimal code | Type resolves to `any` → operator not rewritten → runtime `[object Object]` |
| Edge case crashes | Unusual but valid patterns that crash the transformer | Recursive types, conditional types, mapped types as macro inputs |

**Tasks:**

- [ ] Create `tests/red-team-type-safety.test.ts` with adversarial test cases organized by attack category
- [ ] **Round 1 — Silent wrong code:**
  - [ ] Derive Eq/Ord/Hash for types with `any`-typed fields
  - [ ] Derive for types with fields whose types have errors (missing imports)
  - [ ] `summon<Eq<T>>()` where T is a type parameter (not concrete)
  - [ ] Operator overload on a value whose type is a union including `any`
  - [ ] Extension method on a value typed as intersection with `any`
- [ ] **Round 2 — Typecheck bypass:**
  - [ ] Write file with `@impl` that has wrong method signatures → does OXC backend catch it?
  - [ ] Write `@derive(Eq)` on a class with private fields → what happens?
  - [ ] Use `specialize()` with a dictionary that doesn't match the typeclass interface
  - [ ] `= implicit()` parameter that resolves to wrong typeclass instance
  - [ ] Pass wrong number of type args to `summon<>()`
- [ ] **Round 3 — Confusing errors:**
  - [ ] Typo in typeclass name: `@derive(Eqq)` — is the error clear?
  - [ ] Missing import for typeclass: `summon<Eq<Point>>()` without importing Eq
  - [ ] Circular derivation: type A has field of type B, B has field of type A
  - [ ] `@derive(Eq)` on an empty interface (no fields)
  - [ ] Nested generics: `summon<Functor<Array<Option<number>>>>()`
- [ ] **Round 4 — Edge cases:**
  - [ ] Conditional types as macro input: `type X = T extends string ? A : B`
  - [ ] Mapped types: `type X = { [K in keyof T]: T[K] }`
  - [ ] Template literal types as field types
  - [ ] Intersection types with overlapping fields
  - [ ] `@derive` on a re-exported type (defined in another file)
  - [ ] Types imported from `.d.ts` files (no source)
- [ ] Triage each finding:
  - **Fix**: Improve macro validation or type confidence check
  - **Diagnose**: Upgrade error message via `DiagnosticBuilder`
  - **Accept**: Document as known limitation with clear error
  - **Defer**: Track in `sandbox/red-team/FINDINGS.md` for future work
- [ ] After each round, re-run previous rounds to verify fixes don't regress

**Gate:**

- [ ] `tests/red-team-type-safety.test.ts` has ≥30 adversarial test cases across all categories
- [ ] Every "silent wrong code" finding is either fixed or emits a diagnostic
- [ ] Every "confusing error" finding either has an improved message or is documented
- [ ] Findings tracked in `sandbox/red-team/FINDINGS.md` with status
- [ ] `pnpm test red-team-type-safety` passes

### Wave 7: OXC Diagnostic Pass (Exploratory)

Investigate whether OXC can provide useful diagnostics without full typechecking — catching structural errors that don't require type resolution.

**Tasks:**

- [ ] Research oxc's diagnostic capabilities (parse errors, unreachable code, unused imports)
- [ ] Prototype: run `oxc_linter` rules during the OXC backend transform pass
- [ ] Evaluate which rules catch real issues vs noise for typesugar users
- [ ] If valuable: add `lint: true` option that enables OXC diagnostics during transform
- [ ] If not valuable: document findings and close wave

**Gate:**

- [ ] Decision documented: "OXC diagnostics are/aren't worth integrating"
- [ ] If integrated: at least parse errors and obvious structural issues are reported

## Consequences

### Benefits

1. **Consistent developer experience.** Macros fail with clear, IDE-visible diagnostics — not confusing post-expansion type errors.
2. **Silent degradation eliminated.** When a macro can't do its job due to type issues, the user knows.
3. **Faster CI.** Incremental strict mode means `strict: true` doesn't slow down CI for unchanged files.
4. **Clear documentation.** Users understand the model and know how to configure their desired level of type safety.
5. **Battle-tested type safety.** Adversarial red teaming (Wave 6) proactively finds and fixes holes before users hit them.

### Trade-offs

1. **Macro authoring complexity.** Macro authors need to use `DiagnosticBuilder` and `ctx.isTypeReliable()` instead of bare `reportError()`. This is more code, but better UX.
2. **Language service overhead.** Injecting macro diagnostics into `getSemanticDiagnostics()` adds work to the IDE path. Must be fast enough to not degrade typing responsiveness.
3. **Incremental strict mode complexity.** Tracking file dependencies for incremental checking adds state management.
4. **Red team maintenance.** Adversarial tests need updating as macros evolve, but they also serve as regression tests.

### Future Work

- **Watch mode typechecking.** `typesugar watch` could run incremental strict typechecks as files change, similar to `tsc --watch`.
- **Error recovery in macros.** When a macro detects unreliable types, it could emit a "placeholder" expansion that typechecks but is marked for re-expansion once types stabilize.
- **OXC type inference.** As oxc's type inference matures, some type-confidence checks could run in the fast path without a full TypeChecker.
- **Continuous red teaming.** Wave 6 establishes the initial adversarial suite, but new macro features should always get a red-team pass before release. Consider a CI job that runs red-team tests with stricter thresholds.
