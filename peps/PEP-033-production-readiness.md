# PEP-033: Production Readiness — CLI, Macro Registration, and Documentation

**Status:** Done (all waves + reconciliation blockers N1–N6 resolved 2026-06-28)
**Date:** 2026-04-03 (updated 2026-04-04; reconciled 2026-06-28; completed 2026-06-28)
**Author:** Claude (with Dean Povey)

## Context

Six dry-run scenarios simulated new users following the getting-started docs to build real applications (REST API, data pipeline, scientific computing, parser/compiler, Effect-TS service, FP domain modeling). Each installed packages from scratch, wrote 200-450 lines of realistic code, and attempted to compile and run.

**Average rating: 4/10.** The macro expansion engine produces correct output, but the two primary CLI execution paths (`build` and `run`) are broken, and several headline features (pattern matching, Option dot-syntax, @service) silently fail due to a macro registration bug. A new user following the docs hits a wall within minutes.

The fixes below are organized into four waves by dependency order and blast radius: infrastructure first (unblocks everything), then correctness, then documentation, then polish.

## Wave 1: CLI Infrastructure (unblocks all workflows)

The three bugs that block every user. Fixing these alone would raise the average rating from 4/10 to ~7/10.

### 1A. Fix `typesugar build` crash: synthetic AST node positions ✅

**Bug:** `@derive` generates namespace companion AST nodes with `pos = -1`. TypeScript's `createTextSpan` throws `Error: start < 0` when the emitter tries to create diagnostics for these nodes. `typesugar build` is broken for any file using `@derive`.

**Root cause:** After `program.emit()` with the transformer, deferred checker callbacks hold references to synthetic nodes created during macro expansion. Calling `getPreEmitDiagnostics()` after emit triggers these callbacks, which crash in `createTextSpan` on nodes with `pos = -1`.

**Fix implemented:**

- [x] Move `getPreEmitDiagnostics(program)` before `program.emit()` in CLI — safe because the checker hasn't been polluted yet
- [x] Wrap post-emit `getTypeChecker()` / SFINAE filtering in try/catch as safety net
- [x] Updated `clampSyntheticPositions` documentation noting its limitations
- [x] 5 new tests in `build-emit.test.ts`

**Gate:** ✅

- [x] `typesugar build` succeeds on `examples/basic/`
- [x] All transformer tests pass (410/411, 1 flaky)

### 1B. Fix `typesugar run`: `Cannot find package 'typescript'` ✅ (partial)

**Bug:** The `run` command bundles with esbuild, marks `typescript` as external, and writes output to `/tmp/typesugar-*.mjs`. Node ESM resolution from `/tmp/` can't find `typescript`.

**Fix implemented:**

- [x] Write bundled temp file to `.typesugar-cache/` inside the project directory instead of `os.tmpdir()`

**Remaining issue:** esbuild does not support TypeScript namespace merging (`const Point` + `namespace Point`), which the `@derive` namespace companion pattern generates. This blocks `typesugar run` for any file using `@derive`. See [PEP-035](PEP-035-emit-pipeline-architecture.md).

### 1C. Fix ESM/CJS dual-package hazard in macro registration

**Bug:** The CLI entry is ESM and imports `globalRegistry` from `@typesugar/core` via ESM. The macro-loader uses `createRequire()` (CJS) to load macro packages. CJS-loaded packages register macros on the CJS instance of `globalRegistry`, but the transformer reads from the ESM instance. Result: macros from `@typesugar/std`, `@typesugar/effect`, `@typesugar/fp`, `@typesugar/validate`, `@typesugar/mapper` silently fail to register.

**Impact:** `match()`, `@service`, Option/Either dot-syntax, `is<T>()`, `transformInto()` all pass through unexpanded.

**Tasks:**

- [ ] **Switch macro-loader to use dynamic `import()` instead of `createRequire()`** — this ensures all packages load via ESM and share the same `globalRegistry` instance.
- [ ] **Alternatively, make `globalRegistry` a true singleton** — store it on `globalThis` so both ESM and CJS access the same object. This is the more defensive fix.
- [ ] **Add a diagnostic** — if `--verbose` is set, log the count of registered macros after loading. If zero macros registered from a package that was successfully loaded, emit a warning.
- [ ] **Regression test** — `typesugar expand` on a file using `match()` fluent API must produce expanded output (not pass-through).

**Gate:**

- [ ] `match()`, `@service`, Option `.map()`, `is<T>()` all expand correctly
- [ ] `typesugar run` + `typesugar build` work end-to-end with these features
- [ ] Verbose output shows correct macro registration counts

### 1D. SFINAE rules for pre-transform diagnostics ✅

**Bug:** `typesugar check` reports errors on valid typesugar code because it typechecks the pre-transform source. Errors like TS1206 (decorators on interfaces), TS2365 (operator overloading), TS2339/TS2304 (match fluent chain) are artifacts of the pre-transform source.

**Fix implemented:**

- [x] **MacroDecorator rule** — suppresses TS1206 on known typesugar decorators (`@derive`, `@tailrec`, `@contract`, `@service`, `@hkt`, `@adt`, `@opaque`, `@mock`, `@existential`)
- [x] **OperatorOverload rule** — suppresses TS2365 when at least one operand is an object type (handled by `@typeclass` `@op`)
- [x] **MacroCallChain rule** — suppresses TS2339/TS2304 inside `match()` fluent chains by walking the receiver chain to find the root `match()` call
- [x] Unified registration via `registerAllSfinaeRules()` in `sfinae-registration.ts`
- [x] 8 new tests in `sfinae-cli-pipeline.test.ts`

**Gate:** ✅

- [x] `typesugar check` on `examples/basic/` reports 0 errors
- [x] All SFINAE tests pass (21/21)

### 1E. LSP server stability ✅

**Bug:** The LSP server crashed on any unhandled exception (e.g., `start < 0` from synthetic nodes), resetting the connection for the client.

**Fix implemented:**

- [x] Added `safeHandler()` wrapper to all 15 LSP request handlers — server logs errors and returns fallback values instead of crashing
- [x] Handlers wrapped: completion, completionResolve, hover, definition, typeDefinition, references, documentHighlight, signatureHelp, prepareRename, rename, codeAction, semanticTokens, codeLens, inlayHint, executeCommand

### 1F. Zed extension ✅

**Bug:** The Zed extension hardcoded `node_modules/@typesugar/lsp-server/dist/server.js` relative to the worktree root, which failed for subdirectories and projects without the LSP server installed.

**Fix implemented:**

- [x] Use `zed::npm_install_package()` API to auto-install `@typesugar/lsp-server` from npm
- [x] Use `env::current_dir().join(SERVER_PATH)` to construct absolute path (following Vue extension pattern)
- [x] Project detection via `package.json` — only starts LSP for workspaces that use typesugar
- [x] Extension capabilities declared in `extension.toml` (`npm:install`)

### 1G. JSDoc `@derive` support ✅

**Bug:** `/** @derive(Eq, Clone, Debug) */` didn't work because:

1. `"derive"` was missing from `JSDOC_MACRO_TAGS` map (only `"deriving"` was listed)
2. `parseJSDocMacroArgs` didn't handle the `"derive"` case (fell through to default returning `[]`)

**Fix implemented:**

- [x] Added `"derive"` to `JSDOC_MACRO_TAGS`
- [x] Added `"derive"` case to `parseJSDocMacroArgs` with parenthesis stripping (`(Eq, Clone)` → `Eq, Clone`)

---

## Wave 2: Macro Correctness (fix wrong behavior)

With the CLI working, these fix cases where macros expand but produce incorrect output.

### 2A. Fix `@derive(Eq)` rewriting `=== undefined` / `=== null` ✅

**Bug:** The `===` operator rewrite for derived Eq fires even when one operand is `undefined` or `null`. `product === undefined` becomes `Product.Eq.equals(product, undefined)`, which crashes with `TypeError: Cannot read properties of undefined`.

**Fix implemented:**

- [x] Added `isNullOrUndefinedExpression()` guard in operator rewriting
- [x] `=== undefined`, `=== null`, `void 0` comparisons are no longer rewritten

### 2B. Fix `@derive` treating class methods as structural fields ✅

**Bug:** `@derive(Eq, Clone, Debug)` on a class with methods (e.g., `toString()`) attempts to derive Eq for the method type `() => string`.

**Fix implemented:**

- [x] Skip method declarations, method signatures, get/set accessors in derive field enumeration

### 2C. Fix `@contract` JSDoc macro not expanding

**Bug:** `/** @contract */` annotation on functions does not transform `requires:` and `ensures:` labeled blocks into runtime checks. They pass through as JavaScript label statements (no-ops).

**Tasks:**

- [ ] Investigate whether this is a registration issue (same root cause as 1C) or a separate expansion bug
- [ ] Regression test

### 2D. Fix operator overloading not expanding via `expand` command

**Bug:** `a + b` for types with `@typeclass` `@op +` annotations is not rewritten by `typesugar expand`. The SFINAE rule suppresses the error, but the actual rewrite doesn't happen.

**Tasks:**

- [ ] Investigate whether `expand` runs all transformer phases
- [ ] Regression test

### 2E. Fix expanded output type errors (namespace companion)

**Bug:** `@derive(Eq)` expanded output contains `as Eq<T>` where `Eq` was imported as a value, not a type. Running `tsc` on expanded output produces `TS2749`.

**Tasks:**

- [ ] Emit a type import for `Eq` alongside the value import, or use `typeof` in the cast expression
- [ ] Regression test

### 2F. Namespace companion pattern + esbuild — moved to PEP-035

Moved to [PEP-035 (Emit Pipeline Architecture)](PEP-035-emit-pipeline-architecture.md). The fix is to add a `ts.transpileModule()` post-pass that converts expanded TypeScript to JavaScript before handing it to esbuild/swc consumers, rather than changing the companion pattern itself.

### 2G. Fix `Hash.number` reference in derive expansion (NEW)

**Bug:** `@derive(Hash)` generates `Hash.number.hash(a.x)` but the primitive hash instance `Hash.number` is not emitted or imported. This causes a runtime error.

**Tasks:**

- [ ] Either emit the primitive hash instances inline, or import them from `@typesugar/std`
- [ ] Regression test

### 2H. Fix `MatchError` undefined in match expansion (NEW)

**Bug:** The `match()` macro expansion references `MatchError` which is not defined or imported in the expanded output, causing a runtime `ReferenceError`.

**Tasks:**

- [ ] Import `MatchError` from `@typesugar/std` in the expanded output, or inline the error class
- [ ] Regression test

---

## Wave 3: Documentation (unblock new users)

These can proceed in parallel with Wave 2 since they're pure doc changes.

### 3A. Document CLI commands in getting-started.md

**Gap:** The getting-started docs only cover Vite/esbuild/Webpack/ts-patch. The CLI commands (`typesugar run`, `build`, `check`, `expand`) are undiscoverable.

**Tasks:**

- [ ] Add a "Quick Start with the CLI" section to getting-started.md
- [ ] Add `typesugar init` mention

### 3B. Document required dependencies

**Gap:** `typescript` is required but not listed. `skipLibCheck: true` is needed for `@typesugar/fp` but not mentioned.

**Tasks:**

- [ ] Add `typescript` to the install command in getting-started.md
- [ ] Add `skipLibCheck: true` to the recommended tsconfig.json

### 3C. Document `match()` runtime form

**Gap:** Only the fluent `.case().then().else()` form is documented. The working runtime form `match(value, { variant: handler })` is undiscoverable.

**Tasks:**

- [ ] Add a "Pattern Matching" section showing both forms
- [ ] Update the std/pattern-matching.ts example

### 3D. Document Option/Either zero-cost representation

**Gap:** Users don't know that `Some(x)` returns raw `x` and `.map()` requires macro expansion.

**Tasks:**

- [ ] Add a note to the FP examples explaining the zero-cost representation
- [ ] Document the manual fallback

### 3E. Fix `staticAssert` documentation

**Gap:** Docs imply single-argument `staticAssert(condition)` but the signature requires two arguments.

**Tasks:**

- [ ] Update all `staticAssert` examples to include the message parameter
- [ ] Or: make the message optional in the runtime stub

### 3F. Document JSDoc vs decorator syntax (NEW)

**Gap:** No clear guidance on when to use `/** @derive(...) */` (JSDoc) vs `@derive(...)` (decorator). Users hit TS1206 errors when using decorator syntax on interfaces/functions.

**Tasks:**

- [ ] Document that JSDoc syntax is preferred for all typesugar macros on interfaces and functions
- [ ] Document that decorator syntax works on classes but not interfaces/functions
- [ ] Update all examples to use JSDoc syntax consistently (except on classes)

---

## Wave 4: Polish (improve developer experience)

Lower priority improvements that smooth rough edges.

### 4A. Fix `pipe()` return type inference

**Issue:** `pipe(value, fn1, fn2)` returns `unknown`, requiring explicit casts.

**Tasks:**

- [ ] Add overloaded signatures for `pipe` with 2-10 arguments

### 4B. Fix `isSome()` type guard

**Issue:** `isSome<A>(opt: Option<A>): boolean` returns plain `boolean`, not a type predicate.

**Tasks:**

- [ ] Change signature to `isSome<A>(opt: Option<A>): opt is NonNullable<A>`

### 4C. Fix `@typesugar/fp` declaration errors

**Issue:** 16 declaration errors in `@typesugar/fp` .d.ts files. Forces `skipLibCheck: true`.

**Tasks:**

- [ ] Audit and fix the .d.ts generation

### 4D. Separate macro code from runtime code in packages

**Issue:** Packages bundle macro definitions (which import `typescript`) alongside runtime code. Causes 10MB+ bundle sizes and runtime resolution failures.

**Tasks:**

- [ ] Split each affected package into `pkg/runtime` and `pkg/macros` entry points
- [ ] Update the macro-loader to load from `/macros` entry point

### 4E. Add `typesugar doctor` guidance for common issues

**Tasks:**

- [ ] Enhance `typesugar doctor` to detect: missing `typescript` dep, missing `skipLibCheck`, broken macro registration, invalid tsconfig plugin config

### 4F. LSP performance on large projects (NEW)

**Issue:** The LSP server times out (120s) on the monorepo because it loads ~100 files via tsconfig. Individual projects work but are slow to start.

**Tasks:**

- [ ] Lazy initialization — only process files as they're opened
- [ ] Incremental processing — don't re-transform unchanged files
- [ ] Consider limiting initial file scan to open documents only

---

## Progress Summary

> ⚠️ The per-item checkboxes in the Waves above are partially stale (written
> 2026-04-04). This table + the **Reconciliation (2026-06-28)** section below are
> authoritative.

| Item                              | Status (2026-06-28)                                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1A. Build crash                   | ✅ Done (`7d96691`)                                                                                                                                                                                                                                                                                                                 |
| 1B. Run ERR_MODULE_NOT_FOUND      | ✅ Done (subsumed by 1C globalThis-registry fix)                                                                                                                                                                                                                                                                                    |
| 1C. ESM/CJS macro registration    | ✅ Done — `globalRegistry` pinned to `globalThis` (registry.ts:480-483)                                                                                                                                                                                                                                                             |
| 1D. SFINAE rules                  | ✅ Done (`b435838`)                                                                                                                                                                                                                                                                                                                 |
| 1E. LSP stability                 | ✅ Done (`7d96691`)                                                                                                                                                                                                                                                                                                                 |
| 1F. Zed extension                 | ✅ Done (`b2399a4`)                                                                                                                                                                                                                                                                                                                 |
| 1G. JSDoc @derive                 | ✅ Done (`b435838`)                                                                                                                                                                                                                                                                                                                 |
| 2A. === undefined guard           | ✅ Done (`7d96691`)                                                                                                                                                                                                                                                                                                                 |
| 2B. @derive methods               | ✅ Done (`7d96691`)                                                                                                                                                                                                                                                                                                                 |
| 2C. @contract requires/ensures    | ✅ Done (PEP-049 W4; tests 29/29) — **but `old()` is broken, see N4**                                                                                                                                                                                                                                                               |
| 2D. Operator overload in expand   | ✅ Done — full pipeline runs in `expand` (operator-rewrite.test.ts)                                                                                                                                                                                                                                                                 |
| 2E. Namespace companion TS2749    | ✅ Done (PEP-038; annotation dropped, typeclass.ts:3540-3543)                                                                                                                                                                                                                                                                       |
| 2F. Namespace/esbuild             | ➡️ Moved to PEP-035                                                                                                                                                                                                                                                                                                                 |
| 2G. Hash.number reference         | ✅ Done (PEP-038; primitive hashing inlined, auto-derive.ts:979-998)                                                                                                                                                                                                                                                                |
| 2H. MatchError undefined          | ✅ Done (2026-06-28) — match now uses new `ctx.ensureImport("MatchError","@typesugar/std")`; expand emits the import. Verified + regression tests (hygiene.test.ts)                                                                                                                                                                 |
| 3A. Document CLI commands         | ✅ Done (getting-started.md L17-27)                                                                                                                                                                                                                                                                                                 |
| 3B. Document required deps        | ✅ Done (typescript + skipLibCheck documented)                                                                                                                                                                                                                                                                                      |
| 3C. Document match() runtime form | ✅ Done (2026-06-28) — fixed pattern-matching.md:574,583 contradiction; object-handler form documented as preserved + cross-linked to match.md                                                                                                                                                                                      |
| 3D. Option/Either zero-cost       | ✅ Done (fp.md + fp/README)                                                                                                                                                                                                                                                                                                         |
| 3E. staticAssert docs arity       | ✅ Done (message optional, runtime-stubs.ts:602)                                                                                                                                                                                                                                                                                    |
| 3F. JSDoc vs decorator syntax     | ✅ Done (2026-06-28) — new guide `docs/guides/jsdoc-vs-decorators.md` (support both; JSDoc recommended for interfaces/functions as portable/tsc-safe, decorator relies on TS1206 suppression); linked from guides index; interface examples in typeclasses.md/macro-types.md/macro-triggers.md reconciled to JSDoc with cross-links |
| 4A. pipe() return inference       | ✅ Done (2026-06-28) — public `pipe` now has value-first overloads (2–10 fns) in `macros/src/runtime-stubs.ts`; infers the threaded type, not `unknown`. Regression test `macros/src/pipe.test.ts`                                                                                                                                  |
| 4B. isSome() type guard           | ✅ Done (option.ts:199 predicate)                                                                                                                                                                                                                                                                                                   |
| 4C. @typesugar/fp .d.ts errors    | ✅ Done (2026-06-28) — fp `.d.ts` de-bundled (PEP-050); a fresh consumer importing `@typesugar/fp` (incl. `/data/option`) type-checks clean with `skipLibCheck: false`. getting-started.md updated: `skipLibCheck` no longer required for TypeSugar                                                                                 |
| 4D. Macro/runtime code split      | ✅ Done (2026-06-28, PEP-050) — all 13 runtime packages split (`./macros` entry + typescript-free `.` entry); `scripts/check-runtime-purity.mjs` passes and is wired into blocking CI                                                                                                                                               |
| 4E. doctor guidance               | ✅ Done (doctor.ts — all 4 checks)                                                                                                                                                                                                                                                                                                  |
| 4F. LSP perf on large projects    | ✅ Superseded by PEP-038 (recreation-storm removed; no benchmark)                                                                                                                                                                                                                                                                   |

## Reconciliation (2026-06-28)

A multi-agent audit re-verified every open item against the current tree (post
PEP-035/038/039/047/048/049) and ran an end-to-end CLI smoke test of the headline
features. Summary:

- **Resolved since 2026-04:** 1C (the macro-registration root cause — fixed via a
  `globalThis` registry singleton, not the dynamic-`import()` option originally
  proposed), 2C, 2D, 2E, 2G (2E/2G via PEP-038's GenericDerivation rework), all of
  Wave 3 except 3C/3F, plus 4B, 4E, and 4F (superseded by PEP-038).
- **Still genuinely open:** **4C** (fp `.d.ts` errors — `skipLibCheck:true` still
  required), and the partials **3F, 4A, 4D**.
- **Closed during this reconciliation (2026-06-28):** **2H** (added a new core API
  `ctx.ensureImport(symbol, from)` — `safeRef` alone only avoids name conflicts and
  does _not_ register an import in the common no-conflict case, so the originally
  suggested `safeRef` swap was a no-op; `match` now uses `ensureImport`, expand emits
  `import { MatchError } from "@typesugar/std"`, covered by `packages/core/src/hygiene.test.ts`).
  **3C** (fixed the `pattern-matching.md` contradiction).

### New blockers found by the smoke test (not previously tracked)

The original named bugs are mostly fixed, but the **Success Criteria are still not
met** — now for these reasons, which need their own items/PEP:

- **N1 — `@derive` companion emit ✅ FIXED (2026-06-28).** The companion form is the
  canonical surface (everything resolves via `companionPath` = `Type.TC`). The bug was
  the companion `const TypeName: Record<string,any> = {}` emitted by
  `ensureDataTypeCompanionConst` once per derive arg: it can't declaration-merge with
  the generated `namespace TypeName` (TS2451 "Cannot redeclare") and duplicated per arg.
  Root cause: that const was a _runtime_ workaround (`const`→`var` rewrite in
  `pipeline.ts` `fixCompanionConsts`) that never ran for type-checking or `expand`.
  **Fix:** stop emitting the companion const entirely (`typeclass.ts` `tryExpandGenericDerive`)
  — a `namespace` already provides the runtime value and merges legally with an
  interface (type space), type alias, or class. Verified: `@derive(Eq, Clone)` on both
  interface and class now `expand`s to output that passes `tsc --noEmit` _and_ runs
  (`Type.Eq.equals(a,b)` → `true`). Removed the now-dead `ensureDataTypeCompanionConst`
  (+ its exports/import); `fixCompanionConsts` left as a defensive no-op. Regression
  tests in `derive-advanced.test.ts`. The companion form's _instance-method sugar_
  (`u1.equals(u2)` → `Type.Eq.equals(u1,u2)`) is the separate extension-method rewrite
  path (N2/N3 territory), not this emit fix.

  Decision recorded: the documented surface is the **companion form** (`Type.Eq.equals`),
  with `u1.equals(u2)` as input sugar that rewrites to it — consistent with how
  operators, extension methods, and the instance registry already resolve.

- **N2 — `match()` ✅ MOSTLY FIXED (2026-06-28).** On investigation the match
  _runtime codegen_ was largely correct; the reported failures were elsewhere:
  - **Fluent `.then((s)=>…)` "returns handler uncalled"** was a **docs bug**, not a
    codegen bug. The fluent API is expression-based: `.then(expr)` using variables
    bound in the pattern (`.case({kind:"circle", radius: r}).then(Math.PI*r**2)`), per
    every example in `match.ts`. getting-started showed the unsupported `.then(fn)` form
    (which the codegen never calls). **Fixed** the getting-started example.
  - **`TS18004` on pattern-binding shorthand** (`.case({kind, r})` — `r` has no value
    in the pre-transform source) was a SFINAE gap: the MacroCallChain rule suppressed
    TS2339/TS2304 inside match chains but not TS18004. **Fixed** — added 18004 to
    `createMacroCallChainRule` (`macros/src/sfinae-rules.ts`); scoped to match chains
    (a genuine shorthand error outside a chain still reports). Regression tests in
    `sfinae-rules.test.ts`.
  - **`TS2769` on the object form** did **not** reproduce in a properly-wired project
    (`examples/basic`) — it was a standalone-snippet artifact of the smoke test.

  Remaining sub-item (tracked with N3): the _instance-method sugar_ `u1.equals(u2)`
  (extension-method rewrite to `Type.Eq.equals(u1,u2)`) — same receiver-resolution
  machinery as N3.

- **N3 — `Option`/`Either` `.map()` dot-syntax doesn't expand** via CLI
  (`expand`/`run`/`build`): receiver type "could not be resolved", so `x.map` is left
  verbatim → `TypeError`/`TS2339`. (2H is a sub-case of the match side of this.)
- **N4 — `@contract` `old()` ✅ FIXED (2026-06-28).** The `@contract`-form `old()` was
  always correct (snapshot hoisted); the smoke test had used the standalone
  `ensures(old(...))` call / bare-label form, which had no function-level orchestration.
  Fix: (1) attribute macros can now declare `triggerLabels`, and the transformer
  applies them implicitly to functions containing matching labeled blocks — so the
  documented `requires:`/`ensures:` block form works end-to-end **without** an explicit
  `@contract` decorator, hoisting `old()` correctly; (2) `old()` reached outside a
  contract context now reports a clear diagnostic instead of silently returning the
  current value; (3) the result-capturing IIFE now carries the function's return type
  (tuples no longer widen to arrays). Tests: `transformer/tests/contract-old.test.ts`,
  `contracts/tests/contracts.test.ts`.
- **N5 — `typesugar build` diagnostic gating ✅ ADDRESSED (2026-06-28).** `build`/`check`
  already `process.exit(1)` on diagnostics (verified: a real type error → exit 1; clean
  → exit 0). Hardened `--strict` (the expanded-output validator) so it transforms a
  fresh copy of each source file (no longer pollutes the program / crashes with
  `start < 0`) and degrades gracefully; documented the `check` vs `build` split in
  `--help` and getting-started.md. Regression test in `transformer/tests/build-emit.test.ts`.
- **N6 — dry-run scenarios ✅ REPAIRED (2026-06-28).** All 6 dirs now exist and run.
  Fixed: stale `file:/Users/deapovey/src/typesugar/...` deps → `workspace:*`; `main.ts`
  moved to `src/`; package names normalised to `typesugar-example-dry-run-*` (excluded
  from repo build/typecheck); added `examples/dry-runs/*` to `pnpm-workspace.yaml`; added
  a runner `README.md`; created the 2 missing scenarios `scientific-computing`
  (`@typesugar/units`) and `parser-compiler` (`@typesugar/parser`). Verified: all 6
  `typesugar run src/main.ts` exit 0. (Repairing the data-pipeline run surfaced and fixed
  a real transformer bug — see Success Criteria.)

## Success Criteria

Final verdict (2026-06-28, after resolving N1–N6): blockers cleared. The headline
features (`comptime`, `@derive`, `match`, `pipe`, `Option`/`Either`, `sql`,
`fieldNames`, contracts, units, parser) work end-to-end through the CLI.

Bug found+fixed while repairing N6: the transformer stripped a macro import even when
the macro was a pass-through that left the call in place relying on a runtime export of
the same name (e.g. `@typesugar/fusion`'s `lazy`), producing a `ReferenceError`. The
import-cleanup now keeps any imported name still referenced in the transformed output
(also drops genuinely-consumed leftovers like `old`). Fix in
`transformer/src/index.ts` (`cleanupMacroImports` + `collectUsedImportNames`); full
transformer + fusion suites stay green (402 tests).

- [x] All 6 dry-run scenarios run via `typesugar run` without workarounds (each exits 0:
      `rest-api`, `data-pipeline`, `scientific-computing`, `parser-compiler`,
      `effect-service`, `fp-domain`)
- [x] `typesugar build`/`check` exit non-zero on diagnostics, zero on clean input (N5)
- [x] A new user following getting-started.md can use `comptime`, `@derive`, `match`,
      `pipe`, `Option`/`Either`, `sql`, `fieldNames` — N1/N2/N3 resolved
- [x] No undocumented required dependencies (getting-started.md lists `typescript`;
      `skipLibCheck` no longer required — 4C)
- [x] Expanded output passes `tsc --noEmit` — the strict-output suite (32 examples,
      incl. `contracts/design-by-contract.ts`) reports zero warnings
- [x] `typesugar check` reports 0 false errors on valid typesugar code (N1/N2 SFINAE)

## Remaining Work (post-reconciliation)

Highest-leverage first (these block the Success Criteria):

1. ✅ **N1 `@derive` companion emit — DONE (2026-06-28)** — companion form chosen;
   removed the conflicting companion const so `Type.Eq.equals` type-checks + runs for
   interface/class/type-alias.
2. ✅ **N2 `match()` — MOSTLY DONE (2026-06-28)** — fluent `.then` was a docs bug
   (expression-based API); TS18004 pattern-binding fixed via SFINAE; TS2769 didn't
   reproduce; 2H (MatchError import) done. Leftover folded into N3.
3. **N3 — extension-method receiver resolution.** Split into two:
   - ✅ **N3a `u1.equals(u2)` instance-method sugar — DONE (2026-06-28).** Wired the
     typeclass **instance registry** into the method-call rewrite
     (`tryRewriteExtensionMethod` → new `tryResolveTypeclassMethod`, transformer
     `index.ts`), mirroring the operator path: map method name → typeclass(es) via the
     new `getTypeclassesForMethod`, `findInstance` for the receiver type, emit
     `Type.TC.method(recv, ...args)`. Scope gate relaxed for method sugar (instance is
     uniquely keyed by (tc,type); unscoped fallback + import injection for cross-module).
     Pre-transform `TS2339` suppressed via the SFINAE `ExtensionMethodCall` rule, made
     **AST-based** (reads the `@derive`/`@deriving` decorator or JSDoc tag on the
     receiver's declaration) because `check` runs `noEmit` so the instance registry is
     empty at filter time. Works for both decorator and JSDoc derive; verified
     expand+check+runtime (`true false`); control (non-deriving type) still errors.
     Tests: `derive-advanced.test.ts`, `sfinae-rules.test.ts`. Also found+noted a
     test-infra gap: `clearRegistries()` wipes standard typeclass defs;
     `registerStandardTypeclasses()` restores them.
   - **N3b `Option`/`Either` `.map()` — ✅ DONE (2026-06-28) via PEP-050.** fp's
     `.d.ts` de-bundled (per-module, stable names), per-module JS + `./*` subpath
     exports, `.js` import extensions fixed, discovery follows re-exports by file path
     and targets the companion's subpath, and `VirtualCompilerHost` now prefers `.d.ts`
     over the emitted `.js`. End-to-end: `o.map(f)` → `map(o, f)` (imported from
     `@typesugar/fp/data/option`), `check` clean, `run` prints `142`; standalone
     consumers can call the companions directly. See PEP-050 Wave 1. Original note for
     context follows:

     **(historical) partially fixed; fp blocked on 4C.** The
     mechanism is consumer-side `@opaque` discovery from imported `.d.ts`
     (`dts-opaque-discovery.ts` → `registerTypeRewrite`, which makes `opt.map(f)`
     rewrite to `map(opt, f)`). Two findings:
     - **Fixed (general):** discovery only scanned `@opaque` **type aliases**, but
       fp publishes `Option`/`Either` as `@opaque` **interfaces** (so they can declare
       their dot-syntax method surface). Extended discovery to scan interfaces too.
       Verified against a clean library `.d.ts` (unit test in
       `dts-opaque-discovery.test.ts`).
     - **Still blocked for fp (= 4C):** fp's bundled `.d.ts` defeats discovery two
       ways — (1) the entry `index.d.ts` only _re-exports_ `Option` from a chunk file
       (`either-*.d.ts`), and discovery scans only the resolved entry file, not through
       re-exports; (2) the companion functions are bundle-renamed (`map` → `map$1`), so
       even the method-name mapping would be wrong. Both are fp `.d.ts` packaging
       problems. So **N3b for fp is gated on 4C** (fp ships a clean, single-file or
       non-renaming `.d.ts`), not on more transformer logic. (A future general
       enhancement — following `.d.ts` re-exports transitively — would help other
       multi-file libs but still can't fix the `map$1` rename.)

4. ✅ **N4 `@contract` `old()` — DONE (2026-06-28)** — `triggerLabels` make the
   `requires:`/`ensures:` block form auto-apply `@contract` (correct `old()` snapshot
   without a decorator); standalone misuse now diagnosed; IIFE carries the return type.
5. ✅ **N5 build diagnostic gating — DONE (2026-06-28)** — `build`/`check` exit non-zero
   on diagnostics (verified); `--strict` hardened (no `start < 0` crash) and the
   `check` vs `build` split documented.
6. ✅ **N6 dry-runs — DONE (2026-06-28)** — all 6 scenarios install via `workspace:*` and
   run (exit 0); 2 missing scenarios authored; surfaced+fixed the pass-through macro
   import-stripping bug.
7. ✅ Partials done: **4A** (overloaded public `pipe`), **4C** (fp `.d.ts` clean →
   `skipLibCheck` dropped from docs), **4D** (macro/runtime split complete for all
   packages; runtime-purity CI gate green).

### Decision (2026-06-28): support both JSDoc and decorator syntax on interfaces

The interface-surface question is resolved as **support both forms**, because the
transformer already accepts both and the obstacles are smaller than they first looked:

- **TS1206 is semantic, not syntactic.** Verified: `@derive(...) interface User {}`
  parses cleanly — `parseDiagnostics` = 0, `getSyntacticDiagnostics` = empty; the
  decorator attaches to the `InterfaceDeclaration` (in its `modifiers` array, since
  TS 4.8+ merged decorators into `modifiers`). TS1206 "Decorators are not valid here"
  is a **grammar check the checker emits via `getSemanticDiagnostics`**, _not_ a parser
  error. So it is suppressible (PEP-033 1D's MacroDecorator SFINAE rule already does
  this for `typesugar check` + LSP) and the transformer can still read and act on the
  decorator. The only place it still surfaces is plain `tsc` run _without_ typesugar's
  diagnostic filter (CI, a plugin-less editor; note `typesugar build` doesn't gate
  diagnostics per N5).
- **Both triggers are already wired.** `isJSDocMacroTargetNode` includes
  `InterfaceDeclaration` (transformer-core `macro-helpers.ts:47,53`) so
  `/** @derive(...) */ interface User {}` works; and the decorator reader in
  `transformer/src/index.ts` pulls decorators from the `modifiers` array (not just
  `getDecorators`, which returns nothing for interfaces) and strips them on output.

So "support both" is not new feature work — it is (a) fix the shared **N1** codegen bug
(affects both forms equally), and (b) the **3F** documentation: present both, recommend
**JSDoc** as the portable/`tsc`-safe form and **decorator** as the nicer form that
relies on typesugar's TS1206 suppression. The remaining caveat to document: the
decorator form is only clean when every consumer runs typesugar's diagnostic filter;
plain `tsc`/CI will still report TS1206.
