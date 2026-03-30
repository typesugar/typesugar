# PEP-025: Match API Consolidation — Deprecate Legacy, Unify Implementation

**Status:** Implemented
**Date:** 2026-03-21
**Author:** Claude (with Dean Povey)
**Implemented:** 2026-03-30

## Context

The `@typesugar/std` package previously shipped two pattern matching implementations:

- **`match.ts`** (1,449 lines): The original API using `when()`, `otherwise()`, and `P.*` pattern helpers. Marked `@deprecated` throughout but still fully exported and tested.
- **`match-v2.ts`** (2,365 lines): The fluent API introduced by PEP-008. This is the recommended API and handles all match functionality including guards, extractors, switch emission, and optimized codegen (PEP-019 Waves 2–5).

Both were exported from `packages/std/src/macros/index.ts`. The old API worked at runtime but received no new features or optimizations. It existed solely for backward compatibility.

### Why this matters

- **3,814 lines** of match code when ~2,700 would suffice
- The old API confuses new users who find two ways to do the same thing
- `P.*` exports (11 helper functions) pollute the namespace
- Test maintenance burden: old API tests must keep passing even though the API is deprecated
- The transformer has special-case handling for both API shapes

### Risk

This is a **breaking change** for any user importing `when`, `otherwise`, `P`, `isType`, or the guard-array form of `match()`. The object-handler form `match(value, { ... })` continues to work.

## Implementation Summary

### Wave 1: Audit and Measure — DONE

- [x] Searched all `packages/*/examples/`, `docs/examples/`, and `tests/` for usage of old API
- [x] Searched external examples, README snippets, and playground examples for old API references
- [x] Quantified: ~80 old API call sites across 3 test files, 1 example file, and 4 doc files
- [x] Confirmed: match-v2 is feature-complete relative to match.ts
- [x] Migration guide updated in `docs/guides/pattern-matching.md`

### Wave 2: Console Deprecation Warnings — DONE (then superseded by Wave 3)

- [x] Added runtime `console.warn` (once per session) to old API entry points
- [x] Updated all internal examples to use fluent API exclusively
- [x] Updated showcase.ts, README.md, and docs

### Wave 3: Remove Old API Exports — DONE

- [x] Removed `when`, `otherwise`, `isType`, and all `P.*` exports from `packages/std/src/macros/index.ts`
- [x] Reduced `match.ts` to 34-line error shim
- [x] Removed old API tests (`match.test.ts`, `red-team-std.test.ts`, match portions of `red-team-macros.test.ts`)
- [x] Moved macro registration and runtime `match()` to `match-v2.ts`
- [x] Added inline expansion for object-handler form in macro (ternary chain codegen)
- [x] Updated `packages/std/README.md`, `docs/guides/pattern-matching.md`, `docs/reference/packages.md`, `docs/getting-started/app-developer.md`

### Wave 4: Update Examples — DONE

- [x] Updated `docs/examples/std/pattern-matching.ts` to showcase all fluent API features:
      discriminated unions, literal dispatch, guards, type constructors, array patterns, OR patterns
- [x] Updated `packages/std/examples/showcase.ts` to use fluent API exclusively
- [x] All playground tests pass

## Results

| Metric               | Before          | After                       |
| -------------------- | --------------- | --------------------------- |
| match.ts             | 1,449 lines     | 34 lines (error shim)       |
| match-v2.ts          | 2,365 lines     | 2,690 lines                 |
| **Total match code** | **3,814 lines** | **2,724 lines**             |
| Old API exports      | 15 symbols      | 0 (removed from index)      |
| Old API test files   | 3               | 0                           |
| Test result          | 6,628 tests     | 6,628 tests (0 regressions) |

### Design Decision: Object-Handler Form Preserved

The 2-arg object-handler form `match(value, { variant: handler })` was preserved because:

1. The symbolic package uses it extensively at runtime (without the transformer)
2. It's a useful API shape for discriminated union matching
3. The macro now generates inline ternary chains for this form (self-contained, no import needed)

Only the `when()`/`otherwise()`/`P.*`/`isType()` guard helpers were removed.
