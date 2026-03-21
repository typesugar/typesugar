# PEP-025: Match API Consolidation — Deprecate Legacy, Unify Implementation

**Status:** Draft
**Date:** 2026-03-21
**Author:** Claude (with Dean Povey)

## Context

The `@typesugar/std` package currently ships two pattern matching implementations:

- **`match.ts`** (1,449 lines): The original API using `when()`, `otherwise()`, and `P.*` pattern helpers. Marked `@deprecated` throughout but still fully exported and tested.
- **`match-v2.ts`** (2,365 lines): The fluent API introduced by PEP-008. This is the recommended API and handles all match functionality including guards, extractors, switch emission, and optimized codegen (PEP-019 Waves 2–5).

Both are exported from `packages/std/src/macros/index.ts`. The old API works at runtime but receives no new features or optimizations. It exists solely for backward compatibility.

### Why this matters

- **3,814 lines** of match code when ~2,400 would suffice
- The old API confuses new users who find two ways to do the same thing
- `P.*` exports (11 helper functions) pollute the namespace
- Test maintenance burden: old API tests must keep passing even though the API is deprecated
- The transformer has special-case handling for both API shapes

### Risk

This is a **breaking change** for any user importing `when`, `otherwise`, `P`, `isType`, or the object-handler form of `match()`. A deprecation period and migration guide are required.

## Waves

### Wave 1: Audit and Measure

**Tasks:**

- [ ] Search all `packages/*/examples/`, `docs/examples/`, and `tests/` for usage of old API (`when(`, `otherwise(`, `P.`, `isType(`)
- [ ] Search external examples, README snippets, and playground examples for old API references
- [ ] Quantify: how many call sites use old vs new API?
- [ ] Identify any old API features that match-v2 does not yet support
- [ ] Document the migration path for each old API pattern → fluent equivalent

**Gate:**

- [ ] Complete inventory of old API usage (internal + docs)
- [ ] Migration guide written covering every `when`/`otherwise`/`P.*` pattern
- [ ] Confirmed: match-v2 is feature-complete relative to match.ts (or gaps identified)

### Wave 2: Console Deprecation Warnings

**Tasks:**

- [ ] Add runtime `console.warn` (once per session) when old API entry points are called: `when()`, `otherwise()`, `P.*` constructors
- [ ] Warning message should reference the migration guide and the fluent API equivalent
- [ ] Gate the warning behind a counter so it fires at most once per function per process
- [ ] Update all internal examples and tests to use fluent API exclusively

**Gate:**

- [ ] Calling `when()` in a fresh process emits a deprecation warning exactly once
- [ ] All internal code uses fluent API — `grep -r "when(" packages/std/examples/` returns nothing
- [ ] `pnpm test` passes (warnings don't break tests)

### Wave 3: Remove Old API Exports

**Tasks:**

- [ ] Remove `when`, `otherwise`, `isType`, and all `P.*` exports from `packages/std/src/macros/index.ts`
- [ ] Remove `match.ts` entirely (or reduce to a thin shim that throws a helpful error)
- [ ] Remove old API tests
- [ ] Remove transformer special-case handling for object-handler match form (if any)
- [ ] Update `packages/std/README.md` to remove deprecated API documentation section

**Gate:**

- [ ] `packages/std` exports no `when`, `otherwise`, `P`, or `isType` symbols
- [ ] `match.ts` is deleted or reduced to <20 lines (error shim)
- [ ] `pnpm build` succeeds
- [ ] `pnpm test` passes
- [ ] Match-related code is ~2,400 lines total (down from ~3,800)
