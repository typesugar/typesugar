# PEP-047: Remove the `.sts` Extension and Custom Surface Syntax

**Status:** Done
**Date:** 2026-06-10
**Author:** Dean Povey

## Context

PEP-001 introduced `.sts`/`.stsx` files: an opt-in extension whose files pass
through the lexical preprocessor, enabling syntax that is not valid TypeScript —
`|>` pipe, `::` cons, `F<_>` HKT sugar, Scala-style `| pattern =>` match arms,
and decorators on interfaces. It was fully built: routing in the virtual
compiler host, module resolution, LSP discovery, VS Code/Zed grammars, Prettier
and ESLint integration, a migration guide.

The cost has proven larger than the benefit:

- **It doubles the support matrix.** Every tool in the chain (language service,
  LSP, bundlers, CLI, Prettier, ESLint, two editors) must know about two file
  types with different pipelines. PEP-031, PEP-034, PEP-037, and PEP-038 all
  exist substantially because `.sts` makes editor integration hard.
- **It is the source of the phase-separation soundness gap** (Analysis §4.4):
  the type checker sees different text than the original source, and keeping the
  two aligned consumes source-map and position-mapping effort (PEP-036) that
  plain `.ts` doesn't need.
- **It is unfinished debt.** "Wave 2" (.sts in the TS language service proper)
  has 4 skipped tests in `packages/transformer/tests/language-service.test.ts`,
  plus skips in `tests/sts-extension.test.ts` blocked on ts-patch registration.
- **Nobody is using it.** Zero external users (ROADMAP); the syntax features it
  gates all have TS-compatible equivalents already shipped.
- **TypeScript 7 makes it worse.** Whatever survival path exists for typesugar
  on the Go-based compiler, "we also have our own file extension with non-TS
  syntax" is the hardest part to carry. Shrinking to TS-compatible surface
  syntax now keeps options open.

Removal is cheap to reverse: PEP-001 remains as the spec, the code is in git
history, and the preprocessor architecture is documented. "For now" is the
operative phrase — if adoption ever demands real custom syntax, the right
vehicle is the oxc-based parser (PEP-003), not the current text-rewriting layer.

## What is removed

**Routing & pipeline**

- `VirtualCompilerHost.shouldPreprocess()` / preprocessed-snapshot serving for
  `.sts` (`packages/transformer/src/virtual-host.ts`) — note the **HKT rewriter
  call path stays** (see "What is kept").
- `isSugaredTypeScriptFile()` / `maybePreprocess()` (`packages/transformer/src/index.ts`).
- `.sts`/`.stsx` in `shouldTransform()` and `resolveModulePath()` extension lists
  (`packages/transformer/src/pipeline.ts`).
- `getExternalFiles()` `.sts` discovery (`packages/transformer/src/language-service.ts`).
- CLI `onLoad` filters and directory scanning (`packages/transformer/src/cli.ts`).
- unplugin `resolveId` `.sts` fallback and transform filters
  (`packages/unplugin-typesugar/src/unplugin.ts`).

**Preprocessor extensions** (the `.sts`-only syntaxes)

- `pipeline` (`|>`), `cons` (`::`), `match-syntax`, `decorator-rewrite`, and the
  preprocessor's `F<_>` extension, plus the `.sts` language-variant logic in
  `scanner.ts`. See Open Question 1 for the fate of the package shell and the
  comprehension extension (PEP-039 Wave 6).

**Editor & tooling surface**

- `packages/zed` — delete entirely (it exists only for `.sts`; it was a skeleton).
- VS Code: `sugared-typescript`/`sugared-typescriptreact` language registration,
  `sts.tmLanguage.json`, `stsx.tmLanguage.json`, `sts-sugared.tmLanguage.json`,
  `.sts` selectors in `typesugar.tmLanguage.json`, file icons.
- LSP server: `.sts` discovery, preprocessed snapshots, `.sts` module
  resolution, preprocessor extension wiring (`packages/lsp-server/src/server.ts`).
- Prettier plugin: `.sts`/`.stsx` extensions and the pre/post-format custom-syntax
  pipeline. **Post-removal the plugin has no remaining purpose** — stock Prettier
  formats plain `.ts`. Fold its removal decision into PEP-048.
- ESLint plugin: `full-processor.ts` (`.sts` preprocessing); keep the rules.

**Tests & fixtures**

- `tests/sts-extension.test.ts` (incl. its skipped ts-patch cases),
  `integration/tests/sts-features.test.ts`, `integration/fixtures/sts-project/`,
  the 4 skipped Wave-2 cases in `packages/transformer/tests/language-service.test.ts`,
  `packages/lsp-server/tests/zed-extension.test.ts`, preprocessor extension tests
  (`pipeline`, `cons`, `match-syntax`, `decorator-rewrite`, `mixed`, `.sts` scanner
  cases), `docs/examples/preprocessor/*.sts`.

**Docs**

- `docs/migration/sts-migration.md`; `.sts` sections in `README.md`, `AGENTS.md`,
  `PHILOSOPHY.md`, `docs/architecture.md`, `docs/editor-setup.md`,
  `docs/getting-started/`, `docs/guides/operators.md`,
  `docs/guides/pattern-matching.md` ("Preprocessor Syntax" section),
  `docs/guides/playground.md` (mode toggle).
- PEP status updates: PEP-001 → **Superseded by PEP-047**; PEP-003 → **Withdrawn**
  (revisit only with the oxc strategy); PEP-031/PEP-037 → annotate scope reduction.

## What is kept

- **The `.ts` HKT rewriter** (`packages/transformer/src/hkt-rewriter.ts`):
  `F<A>` → `Kind<F, A>` for type parameters in plain `.ts`. It is independent of
  `.sts`, and it is how std/fp HKT code works today. (Note: it shares the
  "checker sees rewritten text" property at a much smaller blast radius — single
  identifier substitution, no operators. Documented as a known scope.)
- **`Kind<F, A>`** encoding, JSDoc macro forms (`/** @typeclass */` etc.), the
  fluent `match().case().then()` API — the TS-compatible equivalents of
  everything `.sts` offered.
- `__pipe__` as a callable macro/function if anything depends on it (audit; if
  it was syntax-only, remove it too).

## Implementation Plan

- **Wave 1 — pipeline & build**: remove routing from virtual-host, index,
  pipeline, CLI, unplugin; delete preprocessor extensions and `.sts` scanner
  variants; green build with `.ts`-only path.
- **Wave 2 — editors & tooling**: vscode grammars/registration, zed package
  deletion, lsp-server simplification, eslint full-processor removal.
- **Wave 3 — tests & fixtures**: delete the inventory above; confirm skipped-test
  count drops by ≥11; run full suite.
- **Wave 4 — docs**: prune all `.sts` references (grep `\.sts\b|stsx|sugared`),
  update PEP statuses, update README/AGENTS pipeline diagrams.

Each wave is independently land-able; Wave 1 must land first.

## Open Questions

1. **Preprocessor package fate.** PEP-039 Wave 6 added a comprehension
   preprocessor (roadmapped `[for (x of items) ...]` syntax — also not valid TS).
   Options: (a) delete `@typesugar/preprocessor` and the comprehension syntax
   with it (comprehensions return as a macro on valid syntax later), (b) keep
   the package as a **playground-internal** demo dependency only, out of the
   supported build path. Recommendation: (b) if the playground currently demos
   comprehensions, (a) otherwise — decide during Wave 1 audit.
   **Resolved (a): full delete.** No comprehension extension was ever present in
   the package (its only source extension was `hkt`), so the (b) condition never
   held. See Resolution below.
2. **Prettier plugin**: delete now (this PEP) or freeze (PEP-048)?
   Recommendation: delete here — its entire purpose was custom syntax.
   **Resolved:** removed in PEP-048 (Remove set) rather than here.
3. Keep reserving the `.sts` extension name (npm org, docs note) for a possible
   PEP-003 revival? Costless: add one line to PEP-001's superseded notice.

## Resolution (2026-06-13)

The `.sts` extension routing, editors/tooling, and docs (Waves 1–4) shipped in
PR #8. This follow-up finished the job by **deleting `@typesugar/preprocessor`
entirely**:

- **Kept HKT path is the AST rewriter.** `F<A>` → `Kind<F, A>` for type
  parameters on plain `.ts` is handled by
  `packages/transformer/src/hkt-rewriter.ts` (`rewriteHKTTypeReferences`), which
  the type-checker path (`virtual-host.ts`) already used. The three remaining
  runtime callers of the lexical `preprocess()` (CLI build/run/preprocess,
  eslint-plugin processor) were switched to it; the playground's redundant
  `preprocess`/`preprocessOnly` public API was dropped.
- **`RawSourceMap` moved to `@typesugar/core`** (it already lived there); all
  type-only imports were repointed.
- **Behavior drop (accepted):** the lexical preprocessor's "Phase 4" resolution
  of `Kind<OptionF, A>` → concrete `Option<A>` (via the HKT registry) is gone. It
  was used nowhere on the kept `.ts` path — the type-checker, pipeline, and
  playground already ran without it — so no code was ported; `Kind<…>` now relies
  on the `Kind` type's own instantiation, exactly as the kept path already did.
- **Removed the lexical `F<_>` declaration form** and the dead `|>`/`::`/cons
  operator tests; the kept `pipe()`/`match()` macros are unaffected.
