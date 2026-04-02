# PEP-033: Production Readiness — CLI, Macro Registration, and Documentation

**Status:** Proposed
**Date:** 2026-04-03
**Author:** Claude (with Dean Povey)

## Context

Six dry-run scenarios simulated new users following the getting-started docs to build real applications (REST API, data pipeline, scientific computing, parser/compiler, Effect-TS service, FP domain modeling). Each installed packages from scratch, wrote 200-450 lines of realistic code, and attempted to compile and run.

**Average rating: 4/10.** The macro expansion engine produces correct output, but the two primary CLI execution paths (`build` and `run`) are broken, and several headline features (pattern matching, Option dot-syntax, @service) silently fail due to a macro registration bug. A new user following the docs hits a wall within minutes.

The fixes below are organized into four waves by dependency order and blast radius: infrastructure first (unblocks everything), then correctness, then documentation, then polish.

## Wave 1: CLI Infrastructure (unblocks all workflows)

The three bugs that block every user. Fixing these alone would raise the average rating from 4/10 to ~7/10.

### 1A. Fix `typesugar build` crash: synthetic AST node positions

**Bug:** `@derive` generates namespace companion AST nodes with `pos = -1`. TypeScript's `createTextSpan` throws `Error: start < 0` when the emitter tries to create diagnostics for these nodes. `typesugar build` is broken for any file using `@derive`.

**Root cause:** The transformer creates synthetic nodes via `ts.factory.create*()` without setting valid source positions. The `check` command works because `--noEmit` skips the emit phase where positions are validated.

**Tasks:**

- [ ] **Audit all synthetic node creation in `@derive` expansion** — find every `ts.factory.create*()` call in the derive macro and ensure the resulting nodes have `pos >= 0` and `end >= pos`. Use `ts.setTextRange(node, originalNode)` to copy positions from the decorated node.
- [ ] **Add a safety net in the transformer's post-transform pass** — walk all emitted nodes and clamp any negative positions to 0 (defensive, catches future macros too).
- [ ] **Regression test** — `typesugar build` on a file with `@derive(Eq, Clone, Debug, Json)` on an interface and a class must succeed without error.

**Gate:**

- [ ] `typesugar build` succeeds on `examples/basic/`
- [ ] Full test suite passes

### 1B. Fix `typesugar run`: `Cannot find package 'typescript'`

**Bug:** The `run` command bundles with esbuild, marks `typescript` as external (`cli.ts:899`), and writes output to `/tmp/typesugar-*.mjs`. Node ESM resolution from `/tmp/` can't find `typescript`. This breaks `typesugar run` for any project using TypeSugar packages, because macro code (which imports `typescript`) is bundled alongside runtime code.

**Root cause:** Two interacting issues: (1) temp file written outside the project tree, (2) runtime packages ship macro code that imports `typescript`.

**Tasks:**

- [ ] **Write the bundled temp file to the project directory** (e.g. `.typesugar-cache/run.mjs`) instead of `os.tmpdir()`. This ensures Node's resolution algorithm can find `typescript` in the project's `node_modules`.
- [ ] **Alternative: bundle `typescript` into the output** instead of externalizing it. This is slower but eliminates the resolution issue entirely. Evaluate bundle size impact.
- [ ] **Regression test** — `typesugar run src/main.ts` on a file importing `@typesugar/fp`, `@typesugar/std`, and `@typesugar/sql` must execute successfully.

**Gate:**

- [ ] `typesugar run` works on all 6 dry-run projects
- [ ] No `ERR_MODULE_NOT_FOUND` errors

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

---

## Wave 2: Macro Correctness (fix wrong behavior)

With the CLI working, these fix cases where macros expand but produce incorrect output.

### 2A. Fix `@derive(Eq)` rewriting `=== undefined` / `=== null`

**Bug:** The `===` operator rewrite for derived Eq fires even when one operand is `undefined` or `null`. `product === undefined` becomes `Product.Eq.equals(product, undefined)`, which crashes with `TypeError: Cannot read properties of undefined`.

**Tasks:**

- [ ] **Guard the `===` rewrite** — only fire when both operands are statically typed as the derived type (or a subtype). If either operand is `undefined`, `null`, or a union containing them, emit the original `===`.
- [ ] **Regression test** — `x === undefined`, `x === null`, `x == null` must NOT be rewritten for a derived Eq type.

**Gate:**

- [ ] Existing Eq rewrite tests still pass
- [ ] New test: `@derive(Eq) class Foo { ... }; const f: Foo | undefined = ...; f === undefined` emits `f === undefined` (not `Foo.Eq.equals`)

### 2B. Fix `@derive` treating class methods as structural fields

**Bug:** `@derive(Eq, Clone, Debug)` on a class with methods (e.g., `toString()`) attempts to derive Eq for the method type `() => string`, producing `Cannot auto-derive Eq: field 'toString' has type '() => string' which lacks Eq`.

**Tasks:**

- [ ] **Filter out method declarations and function-typed properties** from the derive field list. Only include data properties (those with non-callable types).
- [ ] **Regression test** — `@derive(Eq, Clone, Debug)` on a class with `toString()`, `toJSON()`, and data fields must succeed, deriving only for data fields.

**Gate:**

- [ ] Classes with methods can use `@derive` without error
- [ ] Methods are excluded from `equals()`, `clone()`, and `debug()` output

### 2C. Fix `@contract` JSDoc macro not expanding

**Bug:** `/** @contract */` annotation on functions does not transform `requires:` and `ensures:` labeled blocks into runtime checks. They pass through as JavaScript label statements (no-ops).

**Tasks:**

- [ ] **Investigate whether this is a registration issue** (same root cause as 1C) or a separate expansion bug. If registration: will be fixed by 1C.
- [ ] **If separate:** fix the macro expansion to detect `requires:` / `ensures:` labeled statements and rewrite to assertion calls.
- [ ] **Regression test** — `@contract` function with `requires: x > 0` must throw when called with `x = -1`.

**Gate:**

- [ ] `typesugar expand` shows `requires:` blocks rewritten to runtime assertions
- [ ] Runtime behavior matches documentation

### 2D. Fix operator overloading not expanding via `expand` command

**Bug:** `a + b` for types with `@typeclass` `@op +` annotations is not rewritten by `typesugar expand`. Works with the full transformer pipeline but not the expand-only path.

**Tasks:**

- [ ] **Investigate whether `expand` runs all transformer phases** — specifically, does it run the operator rewriting pass? If not, enable it.
- [ ] **Regression test** — `typesugar expand` on a file with `@typeclass` + `@op +` + `a + b` must show `instance.add(a, b)`.

**Gate:**

- [ ] `typesugar expand` output includes operator rewrites
- [ ] Math/scientific dry run works via expand + tsx

### 2E. Fix expanded output type errors (namespace companion)

**Bug:** `@derive(Eq)` expanded output contains `as Eq<T>` where `Eq` was imported as a value (derive name symbol), not a type. Running `tsc` on expanded output produces `TS2749: 'Eq' refers to a value, but is being used as a type here`.

**Tasks:**

- [ ] **Emit a type import** for `Eq` alongside the value import, or use `typeof` in the cast expression.
- [ ] **Regression test** — `typesugar expand` output must pass `tsc --noEmit` without errors.

**Gate:**

- [ ] Expanded output is valid TypeScript that typechecks standalone

---

## Wave 3: Documentation (unblock new users)

These can proceed in parallel with Wave 2 since they're pure doc changes.

### 3A. Document CLI commands in getting-started.md

**Gap:** The getting-started docs only cover Vite/esbuild/Webpack/ts-patch. The CLI commands (`typesugar run`, `build`, `check`, `expand`) are undiscoverable.

**Tasks:**

- [ ] **Add a "Quick Start with the CLI" section** to getting-started.md, before the build tool sections. Show:
  ```bash
  npx typesugar run src/main.ts    # compile + execute
  npx typesugar check              # typecheck with macro expansion
  npx typesugar build              # compile to dist/
  npx typesugar expand src/main.ts # show expanded output
  ```
- [ ] **Add `typesugar init` mention** — the interactive setup wizard.

### 3B. Document required dependencies

**Gap:** `typescript` is required but not listed. `skipLibCheck: true` is needed for `@typesugar/fp` but not mentioned.

**Tasks:**

- [ ] **Add `typescript` to the install command** in getting-started.md:
  ```bash
  npm install typesugar @typesugar/transformer typescript
  ```
- [ ] **Add `skipLibCheck: true`** to the recommended tsconfig.json in getting-started.md with a brief explanation.

### 3C. Document `match()` runtime form

**Gap:** Only the fluent `.case().then().else()` form is documented. The working runtime form `match(value, { variant: handler })` is undiscoverable.

**Tasks:**

- [ ] **Add a "Pattern Matching" section** to getting-started.md showing both forms:
  - Fluent form (requires macro expansion): `match(x).case({...}).then(...)`
  - Object form (works at runtime): `match(x, { variant: handler })`
- [ ] **Update the std/pattern-matching.ts example** to show both forms.

### 3D. Document Option/Either zero-cost representation

**Gap:** Users don't know that `Some(x)` returns raw `x` and `.map()` requires macro expansion. When it doesn't expand, they get `TypeError: .map is not a function` with no guidance.

**Tasks:**

- [ ] **Add a note to the FP examples** explaining the zero-cost representation and that dot-syntax requires the TypeSugar transformer.
- [ ] **Document the manual fallback** — checking `x != null` instead of `isSome(x)` when not using the transformer.

### 3E. Fix `staticAssert` documentation

**Gap:** Docs imply single-argument `staticAssert(condition)` but the signature requires two arguments `staticAssert(condition, message)`.

**Tasks:**

- [ ] **Update all `staticAssert` examples** to include the message parameter.
- [ ] **Or: make the message optional** in the runtime stub if that's the intended API.

---

## Wave 4: Polish (improve developer experience)

Lower priority improvements that smooth rough edges.

### 4A. Fix `pipe()` return type inference

**Issue:** `pipe(value, fn1, fn2)` returns `unknown`, requiring explicit casts. The type should flow through the chain.

**Tasks:**

- [ ] **Add overloaded signatures** for `pipe` with 2-10 arguments, each correctly threading the return type. This is the standard approach (used by fp-ts, Effect, RxJS).

### 4B. Fix `isSome()` type guard

**Issue:** `isSome<A>(opt: Option<A>): boolean` returns plain `boolean`, not a type predicate. Users can't narrow `Option<T>` in `if` blocks.

**Tasks:**

- [ ] **Change signature** to `isSome<A>(opt: Option<A>): opt is NonNullable<A>` (or equivalent type predicate).

### 4C. Fix `@typesugar/fp` declaration errors

**Issue:** 16 declaration errors in `@typesugar/fp` .d.ts files (types used as values, missing `NodeJS` namespace). Forces `skipLibCheck: true`.

**Tasks:**

- [ ] **Audit and fix the .d.ts generation** — ensure type-only imports use `import type`, and remove the `NodeJS` dependency from declarations.

### 4D. Separate macro code from runtime code in packages

**Issue:** Packages like `@typesugar/std`, `@typesugar/contracts`, `@typesugar/units` bundle macro definitions (which import `typescript`) alongside runtime code. This causes 10MB+ bundle sizes and runtime resolution failures.

**Tasks:**

- [ ] **Split each affected package** into `pkg/runtime` and `pkg/macros` entry points (or use conditional exports). Runtime entry must not import `typescript`.
- [ ] **Update the macro-loader** to load from `/macros` entry point specifically.

### 4E. Add `typesugar doctor` guidance for common issues

**Tasks:**

- [ ] **Enhance `typesugar doctor`** to detect: missing `typescript` dep, missing `skipLibCheck`, broken macro registration (0 macros loaded), invalid tsconfig plugin config.

---

## Success Criteria

After all waves:

- [ ] All 6 dry-run scenarios compile and run via `typesugar run` without workarounds
- [ ] All 6 dry-run scenarios compile via `typesugar build` without errors
- [ ] A new user following getting-started.md can write, compile, and run code using `comptime`, `@derive`, `match`, `pipe`, `Option`, `Either`, `sql`, and `fieldNames` within 10 minutes
- [ ] No undocumented required dependencies
- [ ] Expanded output (`typesugar expand`) is valid TypeScript that passes `tsc --noEmit`
