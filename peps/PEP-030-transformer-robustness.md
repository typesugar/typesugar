# PEP-030: Transformer & Macro Robustness

**Status:** Implemented
**Date:** 2026-03-29
**Author:** Claude (with Dean Povey)

## Context

A deep review of the transformer pipeline (transformer-core, transformer, macros) revealed systemic issues across five categories:

1. **Fragile regex-based parsing** — string matching where the TypeScript type system or AST should be used, causing silent failures on valid code (e.g., nested generics, presentation-dependent type strings).
2. **Code duplication** — identical patterns reimplemented 3-5 times across files (safe node text, set-or-create, function body resolution).
3. **Silent error swallowing** — bare `catch {}` blocks that hide real failures, making bugs invisible.
4. **String round-tripping** — AST → string → AST pipelines that lose type info and source positions.
5. **Hardcoded assumptions** — magic discriminant lists, string-based type identity, ad-hoc path handling.

These issues compound: a regex-parsed brand that silently fails in a bare catch block produces no error, no warning — just wrong output.

## Waves

### Wave 1: Fix Fragile Type Identity and Brand Extraction ✅

The highest-impact fixes — these cause silent wrong behavior on valid user code.

**Tasks:**

- [x] **`specialization.ts:211-216`** — Replaced regex `/<([^>]+)>/` fallback with shared `extractFirstTypeArgument()` that uses bracket-counting for nested generics. Also used in `extractBrandFromImpl`.

- [x] **`specialization.ts:63`** — Replaced `typeToString(returnType) === "void"` with `!!(returnType.flags & ts.TypeFlags.Void)`.

- [x] **`rewriting.ts:716-717`** — Added `resolveTypeRewriteName()` helper with 3-strategy normalization: direct typeToString, symbol name fallback, import prefix stripping. Applied to both transformer-core and transformer/index.ts.

- [x] **`dts-transform.ts:49`** — Replaced regex with two-tier approach: `ts.getJSDocTags()` primary, manual multi-line-aware extraction fallback.

**Gate:**

- [x] Add test: `Impl<Map<string, number>>` brand extracts as `Map<string, number>`, not `Map<string, number`
- [x] Add test: `Impl<Either<Option<A>, B>>` brand extracts correctly (3 levels of nesting)
- [x] Add test: void return type detected via flags on function with `void` return
- [x] Add test: type rewrite lookup works when `typeToString` emits `import("./foo").MyType` format
- [x] Add test: `@opaque` tag with multi-line underlying type parses correctly
- [x] Run full test suite — no regressions (363 pass, 4 skipped)
- [x] Code review: all diffs reviewed for correctness before merge

### Wave 2: Eliminate Code Duplication ✅

**Tasks:**

- [x] **`specialization.ts:252-297`** — Extracted `resolveBodyFromSymbol()` private helper. `resolveAutoSpecFunctionBody` reduced from ~50 to ~10 lines.

- [x] **`import-resolution.ts:38-79`** — Extracted `trackMacroImport()` helper. `recordMacroImport` reduced from ~42 to ~24 lines.

- [ ] **safeGetNodeText** — Deferred. Multiple implementations exist but they have subtle differences (some use sourceFile param, some don't). Needs careful analysis to unify without breaking behavior.

- [x] **`hasExportModifier`** — Found 5 copies (not just 2!). Consolidated all into `@typesugar/core/ast-utils.ts`. Removed copies from `dts-transform.ts`, `dts-opaque-discovery.ts`, `extension.ts`, `module-graph.ts`, `opaque.ts`.

**Gate:**

- [x] Grep confirms: only one implementation of `hasExportModifier` exists (in core/ast-utils.ts)
- [x] `resolveAutoSpecFunctionBody` is under 20 lines ✅
- [x] `recordMacroImport` is under 25 lines ✅
- [x] Run full test suite — no regressions (363 pass, 4 skipped)
- [x] Code review: all diffs reviewed for identical behavior

### Wave 3: Replace Silent Error Swallowing with Diagnostic Comments ✅

**Tasks:**

- [x] **Audited all bare `catch {}` blocks** in transformer-core (27 blocks across 7 files). Every block categorized:
  - **Category A (expected):** getText()/getStart() on synthetic nodes — added explanatory comments
  - **Category B (TypeChecker):** getSymbolAtLocation, getTypeAtLocation, etc. — added comments identifying the specific API and fallback behavior
  - **No Category C (bugs) found** — all catch blocks have legitimate fallback behavior

- [x] **`specialization.ts`** — All 12 catch blocks now have descriptive comments explaining what TypeChecker API may throw and why the fallback is safe.

- [x] **`rewriting.ts:711`** — Comment added explaining getTypeAtLocation failure scenario.

**Gate:**

- [x] Every bare `catch {}` in transformer-core has an explanatory comment
- [x] No catch block was changed to re-throw (fallback chains preserved)
- [x] Run full test suite — no regressions (363 pass, 4 skipped)
- [x] Code review: comments-only changes verified

### Wave 4: Improve Syntax Macro Robustness ✅

Adopted pragmatic approach: `quote.ts` also uses string round-tripping internally, so a full AST-splice rewrite would require deeper infrastructure changes. Applied targeted improvements instead.

**Tasks:**

- [x] **`syntax-macro.ts` capture kinds** — `stmts` now rejects matches (returns null) instead of silently accepting. `type` has documentation explaining its behavior.

- [x] **`syntax-macro.ts` expandTemplate** — Added single-capture optimization: when template is exactly `$name`, returns captured node directly (no string round-trip). Extracted `nodeToText()` helper. Added JSDoc documenting known limitations of the string approach.

**Gate:**

- [x] A capture containing `a > b ? c : d` expands correctly — test added
- [x] `stmts` capture kind produces clear error (rejected match) — test added
- [x] Single-capture direct return optimization works — test added
- [x] Run full test suite — no regressions (363 + 7 syntax-macro tests pass)
- [x] Code review: verified `quote.ts` also uses string assembly, confirming pragmatic approach was correct

### Wave 5: Remove Hardcoded Assumptions ✅

Adopted documentation approach over configuration — these assumptions haven't caused reported issues yet.

**Tasks:**

- [x] **Discriminant field names** — Added comprehensive JSDoc to `KNOWN_DISCRIMINANTS` lists in `typeclass.ts` (2 occurrences) and `std/src/macros/match.ts` documenting each field, rationale, and user workaround (manual instance definition).

- [x] **`rewriting.ts:680`** — Extracted `isAbsolutePath()` browser-safe helper. Improved regex to also handle Windows backslash paths (`C:\`).

- [x] **Module path detection regex** — Added documentation comment to monorepo `packages/<name>/` regex in `import-resolution.ts`.

**Gate:**

- [x] `isAbsolutePath` handles Unix, Windows forward-slash, and Windows backslash paths
- [x] All documentation additions are accurate and helpful
- [x] Run full test suite — no regressions (363 pass, 4 skipped)
- [x] Code review: no behavioral changes, defaults match exactly

## Files Changed

| Package            | Files                                                                                                             | Waves      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- | ---------- |
| `transformer-core` | `specialization.ts`, `rewriting.ts`, `import-resolution.ts`, `macro-helpers.ts`, `transform.ts`, `transformer.ts` | 1, 2, 3, 5 |
| `transformer`      | `dts-transform.ts`, `dts-opaque-discovery.ts`, `index.ts`                                                         | 1, 2       |
| `macros`           | `typeclass.ts`, `extension.ts`, `module-graph.ts`, `opaque.ts`, `syntax-macro.ts`                                 | 2, 4, 5    |
| `core`             | `ast-utils.ts`, `index.ts`                                                                                        | 2          |
| `std`              | `src/macros/match.ts`                                                                                             | 5          |
| Tests              | `auto-specialize.test.ts`, `type-rewrite-erasure.test.ts`, `dts-transform.test.ts`, `syntax-macro.test.ts`        | 1, 4       |

## Consequences

### Benefits

- Nested generics in `@impl` annotations work correctly (was silently broken)
- Type identity uses symbol-based fallback, not just presentation-dependent strings
- Every catch block in transformer-core is documented with what it catches and why
- One canonical `hasExportModifier` (was 5 copies)
- Syntax macros reject invalid `stmts` captures and optimize single-capture templates
- All hardcoded assumptions documented with rationale and workarounds

### Trade-offs

- `safeGetNodeText` consolidation deferred — the implementations have subtle differences that need careful analysis
- Syntax macro string round-trip preserved (pragmatic) — `quote.ts` uses the same approach, so infrastructure doesn't support AST splicing yet
- Wave 5 documented rather than made configurable — avoids API surface growth for issues not yet reported

### Non-Goals

- Refactoring the 6,400-line `transformer/index.ts` — tracked by PEP-026
- HKT heuristic false positives — cost is an extra AST walk, not wrong output
- Macros package catch block audit — deferred to a future pass (37 blocks, similar patterns)
