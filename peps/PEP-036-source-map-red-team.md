# PEP-036: Source Map Red Team — Error Positioning Accuracy

**Status:** Done
**Date:** 2026-04-04
**Author:** Claude (with Dean Povey)

## Problem

The typesugar source map pipeline maps diagnostic positions from transformed code back to original source so that editors display red squigglies in the right place. This mapping is load-bearing for every user interaction — a wrong squiggly erodes trust in the tool.

The existing test suite (`diagnostic-positioning.test.ts`, `position-mapper.test.ts`, `source-map-utils.test.ts`) covers basic single-macro expansions and simple TS type errors. But there are categories of failure that aren't tested:

1. **Expansion size changes** — when expanded code is much longer or shorter than the original, do subsequent error positions drift?
2. **Multi-byte / Unicode** — byte offsets vs character offsets diverge for emoji, CJK, combining characters
3. **Column accuracy in the LSP layer** — `offsetToPosition()` is tested at the transformer level but not through the full LSP→editor path
4. **Composed source maps** — the preprocess→expand chain is composed via `@ampproject/remapping`; are position lookups accurate after composition?
5. **@derive and namespace companions** — the largest code-generating macro; positions in code after a `@derive` expansion are untested
6. **Edge geometry** — errors at offset 0, at EOF, on blank lines, inside macro arguments, immediately adjacent to expansion boundaries
7. **LSP protocol fidelity** — the LSP server converts byte offsets to LSP `Position` (line/character); does this match what VS Code and Zed expect for the same file content?
8. **Source map roundtrip** — no test generates a source map, decodes it, and verifies every mapping entry resolves back correctly

## Scope

This PEP covers **testing only** — no production code changes unless a test exposes a real bug (which it likely will). The goal is to build a comprehensive, regression-proof test suite that makes source map breakage immediately visible.

Out of scope: source map v4, multi-file cross-reference positioning, debugger step-through mapping.

## Architecture

### Test Layers

```
Layer 1: Roundtrip unit tests        (source-map-utils, position-mapper)
Layer 2: Transform→map→verify        (diagnostic-positioning, new)
Layer 3: LSP protocol integration     (lsp-integration, new)
Layer 4: Adversarial / red-team       (new file)
```

Each layer builds on the one below. A failure in Layer 1 means Layer 2+ will also fail, so debugging starts at the bottom.

### Test Fixture Strategy

Rather than constructing source strings inline (error-prone and hard to read at scale), introduce a **fixture helper** that:

1. Takes an annotated source string with `/*ERR*/` markers at expected error locations
2. Transforms it
3. Verifies every diagnostic's mapped position lands within N characters of the marker

This enables high-density test authoring without boilerplate.

```typescript
// Example usage
assertErrorsAt(`
import { pipe, staticAssert } from "typesugar";

const r = pipe(42, (n: number) => n + 1);
/*ERR:not-tail*/staticAssert(false, "boom");
const x: number = /*ERR:type*/"oops";
`);
```

## Waves

### Wave 1: Roundtrip & Composition Accuracy

Extend `packages/transformer-core/test/source-map-utils.test.ts` and `packages/transformer-core/test/position-mapper.test.ts`.

**Tasks:**

- [ ] Add source map roundtrip test: generate map via `ExpansionTracker`, decode via `decodeMappings`, verify every decoded segment resolves back to the correct original offset via `findOriginalPosition`
- [ ] Add composition roundtrip: compose two known maps via `composeSourceMaps`, verify positions through the composed result match direct lookup
- [ ] Test `findOriginalPosition` with generated column at exact segment boundary, one before, one after
- [ ] Test `findGeneratedPosition` → `findOriginalPosition` roundtrip (forward then reverse)
- [ ] Test identity: when expansion text equals original text (same length), source map should be identity-like
- [ ] Test expansion that grows significantly (1 char → 200 chars): verify positions after expansion are correct
- [ ] Test expansion that shrinks significantly (200 chars → 1 char): verify positions after expansion are correct

**Gate:** All roundtrip assertions pass. Any existing tests still pass.

### Wave 2: Diagnostic Positioning — Expanded Coverage

Extend `tests/diagnostic-positioning.test.ts` with new test sections.

**Tasks:**

- [ ] Add `@derive` positioning tests:
  - Type error BEFORE `@derive` expansion maps correctly
  - Type error AFTER `@derive` expansion (which generates companion namespace + registry) maps correctly
  - `@derive` diagnostic itself (e.g., missing `Eq` for a field) points to the `@derive` decorator
  - Column-level accuracy for `@derive` error
- [ ] Add HKT syntax (`F<_>`, `Kind<F, A>`) positioning tests:
  - Type error after HKT preprocess + macro expansion (two-stage source map composition)
  - Position accuracy when preprocess changes line count (e.g., multi-line HKT generics)
- [ ] Add pipe operator (`|>`) positioning tests:
  - Long pipe chain (10+ stages) — error at end of chain maps correctly
  - Error in the middle of a pipe chain argument
- [ ] Add extension method (`::`) positioning tests:
  - Error after `::` desugar maps correctly
- [ ] Add mixed-macro positioning test:
  - File with `@derive` + `@typeclass` + `pipe` + `|>` + `::` — verify all error positions
- [ ] Implement the `/*ERR*/` fixture helper described above and convert Tier 3–6 tests to use it

**Gate:** All new tests pass. Coverage includes every macro type that changes code size.

### Wave 3: Unicode & Multi-byte Edge Cases

New test section in `tests/diagnostic-positioning.test.ts` or new file `tests/source-map-unicode.test.ts`.

**Tasks:**

- [ ] Test with identifiers containing multi-byte characters (emoji variable names: `const 🎉 = 1`)
  - Verify byte offset vs character offset distinction is handled correctly
  - Error after emoji identifier maps to correct line/column
- [ ] Test with CJK identifiers (`const 変数 = 1`)
- [ ] Test with combining characters (e.g., `é` as `e` + combining acute)
- [ ] Test with template literals containing multi-byte characters before/after macro expansion
- [ ] Test with comments containing multi-byte characters between macro calls
- [ ] Test the LSP `offsetToPosition()` function with multi-byte content:
  - Verify it returns the correct `character` offset (LSP spec says UTF-16 code units)
  - Compare its output for a known string against manually computed positions

**Gate:** All tests pass. If bugs are found, file them as separate issues (fixes are out of scope for this PEP unless trivial).

### Wave 4: LSP Protocol Integration Tests

Extend `packages/lsp-server/tests/lsp-integration.test.ts`.

**Tasks:**

- [ ] Add test: file with `pipe()` expansion → verify `publishDiagnostics` notification contains correct `range.start.line` / `range.start.character` for a type error after the expansion
- [ ] Add test: file with `@derive` expansion → verify diagnostic range points to original source line
- [ ] Add test: file with multiple macros → verify diagnostic ranges are in ascending line order (no overlapping / inverted ranges)
- [ ] Add test: introduce a type error, verify diagnostic range, then "fix" the error, verify diagnostics are cleared
- [ ] Add test: verify diagnostic `range.end` (not just `range.start`) is accurate — the squiggly should underline the right span, not just start at the right place
- [ ] Add test: verify macro diagnostics and TS diagnostics in the same file have non-overlapping, correctly ordered ranges
- [ ] Add test: verify that `mapTsDiagnostic` returns `null` for diagnostics inside purely generated code (e.g., companion namespace internals), and that these are excluded from `publishDiagnostics`

**Gate:** All LSP tests pass. Diagnostic ranges are verified at both start and end.

### Wave 5: Adversarial Red-Team Tests

New file: `tests/red-team-source-map.test.ts`.

These tests are designed to break things. Each represents a plausible user scenario that exercises dark corners of the source map pipeline.

**Tasks:**

- [ ] **Expansion at offset 0**: macro call is the very first token in the file, no imports
- [ ] **Expansion at EOF**: macro call is the last token, no trailing newline
- [ ] **Adjacent expansions**: two macro calls on the same line with no space between closing `)` and next macro name
- [ ] **Nested expansion site**: `pipe(comptime(() => 42), (n: number) => n + 1)` — inner and outer both expand; verify positions of code after both
- [ ] **Empty expansion**: macro that expands to empty string — verify positions of subsequent code
- [ ] **Expansion that introduces newlines**: macro expands to multi-line output when original was single-line — verify line numbers after
- [ ] **Expansion that removes newlines**: multi-line macro call expands to single-line output — verify line numbers after
- [ ] **100+ lines after expansion**: a macro at line 5, then 200 lines of code — verify error at line 205 maps correctly (tests for offset accumulation errors)
- [ ] **Many small expansions**: 20 `pipe()` calls in one file — verify error at the bottom maps correctly (tests for accumulated rounding)
- [ ] **Identical code before and after expansion**: `const x = identity(42)` expanding to `const x = 42` — verify the surrounding `const x = ` positions are preserved exactly
- [ ] **Diagnostic exactly at expansion boundary**: error on the token immediately following an expansion (no gap)
- [ ] **Source map with no mappings string**: degenerate case — verify graceful handling
- [ ] **Extremely long single line** (10KB): macro expansion on a single very long line — verify column accuracy

**Gate:** All adversarial tests pass or are annotated with `it.fails` + a filed bug number.

### Wave 6: VS Code Extension Diagnostic Mapping

Extend `packages/vscode/test/error-scenarios.test.ts`.

**Tasks:**

- [ ] Add test: `ExpansionService.expandFile()` returns diagnostics with correct `startLine`/`startChar` for errors after macro expansion
- [ ] Add test: verify `MacroDiagnosticsManager` publishes `vscode.Diagnostic` with correct `range` (not just correct line, but correct column)
- [ ] Add test: verify `relatedInformation` in VS Code diagnostic points to the macro expansion site
- [ ] Add test: when transformer returns diagnostics for macro-generated code, they are filtered (not displayed at bogus positions)

**Gate:** All VS Code extension tests pass.

## Consequences

### Benefits

- Regression-proof source map pipeline — any future macro or preprocessor change that breaks positioning will be caught immediately
- The `/*ERR*/` fixture helper makes it trivial to add positioning tests for new macros
- Adversarial tests document the dark corners and known limitations

### Trade-offs

- Test suite grows by ~500–800 lines across 4 files
- Some adversarial tests may expose bugs that are hard to fix — these should be annotated with `it.fails` and tracked, not blocking

### Future work

- **Editor extension robustness PEP** — address non-source-map failures in both extensions:
  - _Zed:_ `.ts`/`.tsx` language registration (blocked on Zed API), WASM CI, npm install error handling, LSP crash recovery, integration test suite
  - _VS Code:_ `MacroDiagnosticsManager` crash resilience, transformer load failures, diagnostic staleness on rapid edits, extension activation/deactivation lifecycle, test coverage beyond error scenarios
- Debugger step-through mapping (source maps in emitted JS)
- Multi-file diagnostic chains (error in imported file maps to import site)
- VS Code / Zed manual QA checklist (not automatable, but the automated tests give confidence)

## Files Changed

| File                                                      | Change                                          |
| --------------------------------------------------------- | ----------------------------------------------- |
| `packages/transformer-core/test/source-map-utils.test.ts` | Wave 1: roundtrip & composition tests           |
| `packages/transformer-core/test/position-mapper.test.ts`  | Wave 1: boundary & size-change tests            |
| `tests/diagnostic-positioning.test.ts`                    | Wave 2–3: @derive, HKT, Unicode, fixture helper |
| `tests/source-map-unicode.test.ts`                        | Wave 3: multi-byte edge cases (new file)        |
| `packages/lsp-server/tests/lsp-integration.test.ts`       | Wave 4: LSP protocol range verification         |
| `tests/red-team-source-map.test.ts`                       | Wave 5: adversarial tests (new file)            |
| `packages/vscode/test/error-scenarios.test.ts`            | Wave 6: VS Code diagnostic range tests          |
| `tests/helpers/error-fixture.ts`                          | Wave 2: `/*ERR*/` fixture helper (new file)     |

## Design Decisions (Resolved)

**Q: Should we test against real editors or mock the LSP protocol?**
A: Mock the LSP protocol. Real editor tests are flaky, slow, and environment-dependent. The LSP integration tests verify the exact bytes sent over the wire, which is what determines squiggly placement. Manual QA is a complement, not a replacement.

**Q: Should failing adversarial tests block CI?**
A: No. Use `it.fails` for known bugs so CI stays green. The value of the adversarial tests is in documenting the edge cases and catching regressions when fixes land.

**Q: Test the Zed extension separately from the LSP server?**
A: For source map accuracy, no — the Zed extension (`lib.rs`) adds zero diagnostic logic, so LSP server tests cover its error-positioning behavior. However, the Zed extension has its own failure modes that are **out of scope for this PEP** but worth noting:

- It only registers the LSP for `.sts`/`.stsx` files, not `.ts`/`.tsx` — so regular TypeScript files with typesugar macros get no typesugar diagnostics in Zed at all (PEP-034 §4A, blocked on Zed API support for conditional registration)
- Zero automated integration tests — no CI verifies the WASM builds or that the extension starts the LSP server correctly
- `zed::npm_install_package()` can silently fail if npm is unavailable, leaving the user with no language features and no error message
- No crash detection — if the LSP server dies, Zed silently loses all features with no recovery path
- The `.wasm` binary is pre-built and committed; no CI rebuilds it when Rust dependencies change

These are real problems but they're infrastructure/lifecycle issues, not source map issues. A separate PEP should address Zed extension robustness. For this PEP, the LSP protocol integration tests (Wave 4) are the right layer — they verify the exact `publishDiagnostics` payloads that both VS Code and Zed receive.
