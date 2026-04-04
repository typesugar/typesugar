# PEP-033: Production Readiness — CLI, Macro Registration, and Documentation

**Status:** In Progress
**Date:** 2026-04-03 (updated 2026-04-04)
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

| Item                                | Status                                     | Commit    |
| ----------------------------------- | ------------------------------------------ | --------- |
| 1A. Build crash                     | ✅ Done                                    | `7d96691` |
| 1B. Run ERR_MODULE_NOT_FOUND        | ✅ Partial (esbuild compat blocks @derive) | `7d96691` |
| 1C. ESM/CJS macro registration      | ❌ Open                                    | —         |
| 1D. SFINAE rules                    | ✅ Done                                    | `b435838` |
| 1E. LSP stability                   | ✅ Done                                    | `7d96691` |
| 1F. Zed extension                   | ✅ Done                                    | `b2399a4` |
| 1G. JSDoc @derive                   | ✅ Done                                    | `b435838` |
| 2A. === undefined guard             | ✅ Done                                    | `7d96691` |
| 2B. @derive methods                 | ✅ Done                                    | `7d96691` |
| 2C-2E, 2G-2H. Remaining correctness | ❌ Open                                    | —         |
| 2F. Namespace/esbuild               | ➡️ Moved to PEP-035                        | —         |
| 3A-3F. Documentation                | ❌ Open                                    | —         |
| 4A-4F. Polish                       | ❌ Open                                    | —         |

## Success Criteria

After all waves:

- [ ] All 6 dry-run scenarios compile and run via `typesugar run` without workarounds
- [ ] All 6 dry-run scenarios compile via `typesugar build` without errors
- [ ] A new user following getting-started.md can write, compile, and run code using `comptime`, `@derive`, `match`, `pipe`, `Option`, `Either`, `sql`, and `fieldNames` within 10 minutes
- [ ] No undocumented required dependencies
- [ ] Expanded output (`typesugar expand`) is valid TypeScript that passes `tsc --noEmit`
- [ ] `typesugar check` reports 0 false errors on valid typesugar code
