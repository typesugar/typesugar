# PEP-021: Codebase Hygiene — Artifact Cleanup, Doc Consistency, Slop Removal

**Status:** Draft
**Date:** 2026-03-21
**Author:** Claude (with Dean Povey)

## Context

A full codebase audit uncovered accumulated slop across every layer of the project: tracked build artifacts that `.gitignore` should prevent, temporary output files littering the repo root, PEP numbering collisions between `peps/` and `docs/`, deprecated exports that export `undefined`, duplicated code between transformer packages, and documentation that contradicts the code it describes.

None of these are correctness bugs. The transformer, macros, and runtime all work. But the accumulated mess:

- Makes the repo harder to navigate for new contributors
- Inflates `git status` noise (25+ temp files at root, 268+ `.transformed.js` artifacts)
- Creates confusion when docs say one thing and code does another
- Wastes bytes shipping deprecated `undefined` exports and committed `dist/` artifacts

### Scope

This PEP covers mechanical cleanup only — no feature changes, no API redesigns, no refactoring of working code. Every wave should be safe to land independently with no behavioral change.

## Waves

### Wave 1: Tracked Artifacts and .gitignore Gaps

**Problem:** `.gitignore` already has `*.transformed.js`, `dist/`, and `node_modules/`, but files committed before those rules were added are still tracked. Additionally, ~25 temp output files at root match no ignore pattern.

**Tasks:**

- [ ] `git rm --cached` all tracked `.transformed.js` files (268+ across packages)
- [ ] `git rm --cached` `packages/mapper/dist/` and `packages/mapper/node_modules/`
- [ ] Expand `.gitignore` "Build/test output captures" section to use glob patterns:
  ```
  *-output*.txt
  test-pipeline-gate.txt
  ```
- [ ] `git rm --cached` the root-level temp output files (`build-output-gate.txt`, `test-output-*.txt`, `lint-output-*.txt`, `format-output-*.txt`, `typecheck-output-*.txt`, `inspect-output.txt`, `test-pipeline-gate.txt`, etc.)
- [ ] Add `.pep-gate` to `.gitignore` (auto-generated tracking marker)
- [ ] Delete orphaned root-level screenshots (`file-based-examples.png`, `grouped-examples-dropdown.png`, `monaco-editor-test.png`, `playground-test.png`) — not referenced anywhere
- [ ] Verify `packages/mapper` still builds correctly after untracking its dist/

**Gate:**

- [ ] `git status` shows no tracked `.transformed.js` files
- [ ] `git status` shows no tracked `*-output*.txt` files
- [ ] `packages/mapper/dist/` and `packages/mapper/node_modules/` are untracked
- [ ] `pnpm build` still succeeds (mapper builds from source)

### Wave 2: PEP Numbering Collision Fix

**Problem:** PEPs 015, 016, 017 exist in both `peps/` and `docs/` with completely different topics:

- `peps/PEP-015` = browser-compatible transformer-core vs `docs/PEP-015` = tree-shaking annotations
- `peps/PEP-016` = server-backed playground vs `docs/PEP-016` = playground examples overhaul
- `peps/PEP-017` = derive unification vs `docs/PEP-017` = playground architecture consolidation

Additionally, `docs/PEP-014-adt-macro.md` and `docs/PEP-019-output-quality.md` are orphaned in `docs/` instead of `peps/`.

**Tasks:**

- [ ] Move `docs/PEP-014-adt-macro.md` → `peps/PEP-014-adt-macro.md`
- [ ] Renumber `docs/PEP-015-tree-shaking-pure-annotations.md` → `peps/PEP-022-tree-shaking-pure-annotations.md`
- [ ] Renumber `docs/PEP-016-playground-examples-overhaul.md` → `peps/PEP-023-playground-examples-overhaul.md`
- [ ] Renumber `docs/PEP-017-playground-architecture-consolidation.md` → `peps/PEP-024-playground-architecture-consolidation.md`
- [ ] Move `docs/PEP-019-output-quality.md` → `peps/PEP-019-output-quality.md`
- [ ] Grep for all internal references to the old PEP numbers and update them (`.pep-gate`, commit messages referencing PEP-016/017/019, PLAN files, cursor skills)
- [ ] Verify no docs or code reference the old `docs/PEP-*` paths

**Gate:**

- [ ] All PEPs live in `peps/` — zero PEP files in `docs/`
- [ ] No PEP number collisions
- [ ] `grep -r "PEP-015\|PEP-016\|PEP-017" docs/` returns nothing

### Wave 3: Dead Exports and Deprecated Stubs

**Problem:** Several packages export deprecated symbols that are literally `undefined`, no-op functions, or empty containers — kept for backward compatibility that may no longer be needed.

**Packages affected:**

**macros:**

- 9 derive macros exported as `undefined` (`EqDerive`, `OrdDerive`, `CloneDerive`, `DebugDerive`, `HashDerive`, `DefaultDerive`, `JsonDerive`, `BuilderDerive`, `TypeGuardDerive`)
- Empty `deriveMacros = {}` object
- Empty `syntaxRegistry = new Map()`
- No-op `clearSyntaxRegistry()` function
- Deprecated aliases: `instanceAttribute`, `instanceMacro`, `derivingAttribute`

**testing:**

- `Equals` (use `Equal`), `powerAssert` (use `assert`), `comptimeAssert` (use `staticAssert`)

**fp:**

- `OptionHKT`, `EitherHKT`, `ListHKT` (use `OptionF`, `EitherF<E>`, `ListF`)

**Tasks:**

- [ ] In `packages/macros/src/derive.ts`: remove the 9 `undefined` derive exports
- [ ] In `packages/macros/src/index.ts`: remove `deriveMacros`, `syntaxRegistry`, `clearSyntaxRegistry`, and the deprecated aliases (`instanceAttribute`, `instanceMacro`, `derivingAttribute`)
- [ ] In `packages/macros/src/index.ts`: remove `registerTypeclassSyntax()` (fully deprecated, only emits warning)
- [ ] In `packages/testing/src/index.ts`: remove `Equals`, `powerAssert`, `comptimeAssert` aliases
- [ ] In `packages/fp/src/hkt.ts`: remove `OptionHKT`, `EitherHKT`, `ListHKT`
- [ ] Search for any imports of removed symbols across the monorepo and update callers
- [ ] In `packages/macros/README.md`: update to show `@impl` as primary (not `@instance`)

**Gate:**

- [ ] `pnpm build` succeeds
- [ ] `pnpm test` passes (no imports of removed symbols)
- [ ] `grep -r "EqDerive\|OrdDerive\|CloneDerive\|instanceMacro\|instanceAttribute\|derivingAttribute\|clearSyntaxRegistry\|powerAssert\|comptimeAssert\|OptionHKT\|EitherHKT\|ListHKT" packages/*/src/` returns only this PEP

### Wave 4: Documentation Drift Fixes

**Problem:** Multiple READMEs, guides, and reference docs contradict the current code.

**Tasks:**

- [ ] `packages/hlist/README.md`: remove "No typeclass instances" claim — `HListEq` and `HListShow` exist and are exported. Note that `HListOrd` is genuinely missing.
- [ ] `packages/codec/README.md`: update Phase 2 status — decorators are implemented, not "planned". `field-decorators.test.ts` provides full coverage.
- [ ] `packages/macros/README.md`: change primary API from `@instance` to `@impl`
- [ ] `packages/std/src/index.ts`: update JSDoc header — remove references to non-existent typeclasses (Bounded, Enum, Integral, Fractional, etc.) and replace deprecated `extend()` example
- [ ] `packages/math/src/types/fixed-decimal.ts` and `money.ts`: remove unused local `interface Eq<A>` definitions
- [ ] `packages/math/src/types/complex.ts`: register `floatingComplex` with `registerInstanceWithMeta` (missing unlike sibling instances)
- [ ] `docs/SECURITY-REVIEW.md`: update with current status of the 8 identified vulnerabilities (or mark stale)
- [ ] `docs/examples/effect/service-layer.ts`: either restore the file or uncheck the PEP-016 (now PEP-023) checkbox
- [ ] `.cursor/skills/preprocessor-guidelines/SKILL.md`: replace `__binop__` references with `__pipe__`, `__cons__`, `__apply__` per PEP-020
- [ ] `packages/unplugin-typesugar/README.md`: remove reference to non-existent `/docs/PERFORMANCE.md`

**Gate:**

- [ ] No README claims a feature is "planned" when it's already implemented
- [ ] No README claims a feature exists when it doesn't
- [ ] `pnpm build` succeeds
- [ ] `pnpm test` passes

### Wave 5: Structural Consistency

**Problem:** Test file locations, example file duplication, and package.json metadata are inconsistent across packages.

**Tasks:**

- [ ] Standardize test location: packages that have tests in both `/tests/` and `/src/__tests__/` should consolidate to one location per package (prefer `/tests/` for packages that already have both)
  - `packages/std`: move `src/__tests__/extensions.test.ts` → `tests/`
  - `packages/math`: move `src/__tests__/*.test.ts` → `tests/`
  - `packages/units`: remove `src/__tests__/units.test.ts` if it duplicates `tests/units.test.ts`
  - Update vitest configs accordingly
- [ ] `packages/fp`: remove `/examples/` directory (keep `/src/examples/` which is more complete), or vice versa
- [ ] Remove duplicate example files where `showcase.ts` and `*-example.ts` overlap significantly:
  - `packages/units/examples/units-example.ts` (subset of showcase.ts)
  - `packages/strings/examples/string-macros-example.ts` (subset of showcase.ts)
- [ ] `packages/graph/package.json`: add `"license": "MIT"`
- [ ] `packages/fusion/package.json`: add `"license": "MIT"`
- [ ] `packages/symbolic/package.json`: add `repository` field matching sibling packages
- [ ] `packages/mapper/package.json`: switch from exact version pins (`5.9.3`, `3.2.4`) to caret ranges (`^5.5.0`, `^3.0.0`) matching sibling packages
- [ ] Commit untracked test files that appear intentional:
  - `packages/contracts-refined/tests/`
  - `packages/codec/src/__tests__/field-decorators.test.ts`
  - `packages/mapper/tests/mapper-expansion.test.ts`

**Gate:**

- [ ] Every package with tests has them in exactly one directory
- [ ] No duplicate `*-example.ts` + `showcase.ts` pairs with overlapping content
- [ ] All `package.json` files have `license` and `repository` fields
- [ ] `pnpm test` passes after all moves

### Wave 6: Transformer Code Deduplication

**Problem:** `position-mapper.ts` (~205 lines) and `source-map-utils.ts` (~304 lines) are nearly identical between `packages/transformer` and `packages/transformer-core`. The only differences are import paths and minor comments.

**Tasks:**

- [ ] Make `packages/transformer-core` the canonical owner of `position-mapper.ts` and `source-map-utils.ts`
- [ ] In `packages/transformer`, replace the local copies with re-exports from `@typesugar/transformer-core`
- [ ] Verify transformer-core's versions don't import anything outside its zero-dependency constraint
- [ ] Update any internal imports within transformer that reference the local files

**Gate:**

- [ ] `packages/transformer-core` exports position-mapper and source-map-utils
- [ ] `packages/transformer` has no local copies — only re-exports
- [ ] `pnpm build` succeeds
- [ ] `pnpm test` passes
- [ ] transformer-core remains zero-dependency (no new imports)

### Wave 7: Vitest Version Standardization

**Problem:** Vitest versions are inconsistent across packages: validate uses `^1.0.0`, strings uses `^2.0.0`, units/codec use `^3.0.0`, mapper pins exact `3.2.4`. This causes confusing behavior when test APIs differ between packages.

**Tasks:**

- [ ] Upgrade all packages to `vitest: "^3.0.0"` (current major):
  - `packages/validate/package.json`: `^1.0.0` → `^3.0.0`
  - `packages/strings/package.json`: `^2.0.0` → `^3.0.0`
  - `packages/mapper/package.json`: `3.2.4` → `^3.0.0`
- [ ] Fix any test breakage from the vitest upgrade (v1→v3 may have breaking API changes in validate)
- [ ] Run `pnpm install` to update lockfile
- [ ] Run each affected package's tests individually to catch regressions

**Gate:**

- [ ] `grep -r '"vitest"' packages/*/package.json` shows `^3.0.0` everywhere
- [ ] `pnpm test` passes

### Wave 8: PLAN File Archival and Range API Deprecation

**Problem:** 8 completed PLAN files in `docs/` clutter the active documentation. Additionally, the legacy function-based range API in std (`range()`, `rangeInclusive()`, `rangeBy()`, `rangeTo()`, `rangeUntil()`) overlaps with the extension method API (`.to()`, `.until()`, `.step()`).

**Tasks:**

- [ ] Create `docs/completed/` directory
- [ ] Move completed PLAN files to `docs/completed/`:
  - `PLAN-expression-templates.md` (Phase 1 implemented)
  - `PLAN-implicit-operators.md` (implemented, superseded by PEP-004)
  - `PLAN-contracts.md` (Phases 1-4 complete)
  - `PLAN-versioned-codecs.md` (Phase 1 implemented)
  - `PLAN-hlist-fusion.md` (Phase 1 implemented)
  - `PLAN-existential-containers.md` (Phase 1 implemented)
  - `PLAN-graph.md` (Phase 1 implemented)
  - `PLAN-spirit-parsers.md` (Phase 1 implemented)
- [ ] Keep active PLANs in `docs/`:
  - `PLAN-language-service-v2.md` (not yet started)
  - `PLAN-post-migration-cleanup.md` (pending critical items)
- [ ] In `packages/std/src/data/range.ts`: add `@deprecated` JSDoc to legacy function-based API (`range`, `rangeInclusive`, `rangeBy`, `rangeTo`, `rangeUntil`, `rangeToArray`) pointing users to `.to()` / `.until()` extension methods
- [ ] Update `packages/std/README.md` range section to lead with extension method API and show function API as deprecated
- [ ] Update stale TODO.md files in `packages/std/` and `packages/testing/` — remove items with passed dates (2026-02-21) or mark them as deferred

**Gate:**

- [ ] `docs/` contains only active PLANs (2 files)
- [ ] `docs/completed/` contains archived PLANs (8 files)
- [ ] Legacy range functions have `@deprecated` annotations
- [ ] `pnpm build` succeeds

## Out of Scope — Separate PEPs

These require design decisions and migration strategies beyond mechanical cleanup:

- **PEP-025: Match API Consolidation** — `match.ts` (1449 lines) and `match-v2.ts` (2365 lines) coexist in std. The old `when()`/`otherwise()`/`P.*` API is deprecated but still exported and tested. Removing it is a breaking change that needs a migration guide, deprecation period, and careful API surface audit.
- **PEP-026: Macro Module Decomposition** — `macros/typeclass.ts` (5,019 lines) and `macros/specialize.ts` (3,087 lines) contain multiple logically distinct concerns (registries, derivation, HKT, helpers). Splitting these into focused modules improves maintainability but risks subtle breakage in internal state sharing.
