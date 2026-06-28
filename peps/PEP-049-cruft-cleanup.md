# PEP-049: Cruft Cleanup — Stale Plans, Docs Drift, Test Debt, Security Backlog

**Status:** Done (all 6 waves complete 2026-06-29)
**Date:** 2026-06-10
**Author:** Dean Povey

## Context

A June 2026 review of the repo surfaced accumulated cruft: a pending 30-minute
cleanup plan from the src→packages migration, a misleadingly named docs
directory, a stale security review with unaddressed CRITICAL findings, a stale
ROADMAP, known-broken skipped tests unrelated to any active PEP, and README
claims that outrun the code. None of these are individually large; together
they are exactly the "trust and debuggability" debt the ROADMAP says gates
adoption. This PEP collects them into one ordered cleanup with clear
done-criteria.

Related but **not** in scope here: `.sts` removal (PEP-047), package triage
(PEP-048), mapper `transformInto` implementation (tracked via PEP-048 Wave 3).

## Wave 1 — Execute PLAN-post-migration-cleanup (~30 min, pending since the migration)

Per `docs/PLAN-post-migration-cleanup.md`:

- [x] Fix root `tsconfig.json` references (still points at deleted `src/`) — was
      already free of `src/` refs; removed the stale `rootDir: "."` to match the
      PLAN's intended final shape.
- [x] Remove legacy test exclusions in the vitest workspace config — moot:
      `vitest.workspace.ts` no longer exists; projects moved into
      `vitest.config.ts` and the listed exclusions are gone.
- [x] Fix vitest coverage paths — already corrected to `packages/*/src/**/*.ts`.
- [x] Replace transformer's hardcoded path mappings with the generic pattern —
      `resolveModuleSpecifier()` already uses the generic `/packages/([a-z0-9-]+)/`
      regex; no legacy `/src/use-cases/` mappings remain.

Done (2026-06-17): the four substantive items had already drifted into their fixed
state in the tree, so Wave 1 reduced to the `rootDir` tidy plus deleting the PLAN
file and clearing the dangling reference in PEP-021. Note: relocating the root
`tests/contracts*.test.ts` files (PLAN Phase 2 detail) was **not** done — the
package already has a _different_ `packages/contracts/tests/contracts.test.ts`, so
that is a merge, not a move, and it overlaps Wave 4 test-debt territory.

## Wave 2 — Docs hygiene

- [x] **Rename `docs/completed/` → `docs/plans/`** — `git mv`'d; each of the 8
      plan files got a one-line PEP-pointer header (expression-templates → PEP-042,
      graph → PEP-046, spirit-parsers → PEP-043 Wave 3 / parser Frozen,
      implicit-operators → PEP-004, contracts → PEP-045, hlist-fusion → removed in
      PEP-048, existential-containers/versioned-codecs → erased/codec Frozen).
      Repointed the live `docs/completed/` reference in PEP-042.
- [x] **Refresh ROADMAP.md**: re-dated to 2026-06-17 with a "reconciled with
      PEPs 040–049" banner; Prettier-plugin section restated as Removed
      (PEP-047/048); Iterator Fusion → PEP-042, Parser Gen → PEP-043 Wave 3,
      State-Machine Verification → PEP-046, Validate+Refined → PEP-045; P6 taint
      row → superseded by PEP-045; `.sts`-dependent items (inline `:|` constraint
      syntax, `[for …]` comprehensions, phase-separation row) annotated/removed
      per PEP-047.
- [x] **Refresh TODO.md**: validate+refined and taint entries folded into PEP-045
      references; phase-separation item shrunk to the HKT-rewriter note (PEP-047);
      dropped the `===`-via-preprocessor aside.
- [x] **README accuracy pass**: the root README was already PEP-048-tier-accurate
      (Frozen section present, removed packages gone) and carries no `.sts`
      comparison table or `transformInto` advertising — no changes needed.
      (`transformInto` now generates code per PEP-048 Wave 3, so the mapper README
      advertising it is honest.)
- [x] Added [`peps/README.md`](README.md) index (number, title, status) covering
      all 48 PEPs.

Done (2026-06-17). Note: `docs/PLAN-language-service-v2.md` (a docs-root plan with
`.sts` mentions) was left in place — not in this wave's named scope; it is a
candidate for a future move to `docs/plans/`.

## Wave 3 — Security backlog

`docs/SECURITY-REVIEW.md` (2026-02-21, carries its own stale notice) has two
CRITICALs with no evidence of remediation in the log:

- [x] **F2 (CRITICAL): path traversal in `includeStr`/include macros** — was
      already fixed in the tree (`resolveRelativePath` rejects absolute paths and
      boundary-checks the normalized resolved path against the project root,
      throwing a `Security:` error that the transformer turns into a diagnostic).
      Added red-team tests (`tests/include.test.ts` → "security: path traversal
      (F2)"): escaping traversal, absolute paths, re-entrant traversal, a staged
      out-of-root secret, in-root positive control, and `includeBytes`/
      `includeJson` parity. Corrected the over-claiming "symlink escapes" comment
      (the check is lexical; symlink planting needs repo write access, outside the
      macro-argument threat model). **Resolved.**
- [x] **F1 (CRITICAL → documented limitation): unrestricted macro registration** —
      decision (2026-06-21, with Dean): ship docs only, do **not** build the
      `macros.allow` config. The registry keys on the self-declared `macro.module`
      field, so an allowlist on it is trivially bypassable (a hostile package just
      declares `module: "typesugar"`) — security theater, off by default. Shipped
      `docs/SECURITY.md` with the honest trust-model statement and a "Known
      limitations" section. Filed [#14](https://github.com/typesugar/typesugar/issues/14)
      for the real fix (derive registering-package identity from the module graph).
- [x] Re-dated `docs/SECURITY-REVIEW.md` (reconciled 2026-06-21): per-finding
      Status lines + a summary table; F2 marked Resolved; F3 (#15) and F4 (#16)
      noted as partially addressed (comptime fs path-validation done; capabilities
      now default `needsFileSystem:false`); F5 (#17) open with `typesugar expand`/
      `--strict` as partial detection. Noted that `typesugar expand` (the review's
      #1 item) shipped. Filed tracker issues for the open HIGHs:
      [#15](https://github.com/typesugar/typesugar/issues/15),
      [#16](https://github.com/typesugar/typesugar/issues/16),
      [#17](https://github.com/typesugar/typesugar/issues/17).

Done (2026-06-21). F2 had already drifted into its fixed state (consistent with
the repo's pattern of running ahead of its PEPs); Wave 3 reduced to red-team
tests, the honest-docs decision on F1, and getting the stale review reconciled
with the tree + open findings into the tracker.

## Wave 4 — Test debt (items not owned by another PEP)

- [x] `packages/std/tests/extensions.test.ts` — **not** a transformer issue.
      Real causes: (1) `boolean.ts` exported a function named `then`, which makes
      the ESM module namespace a thenable so `await import()` of it rejects with
      `undefined` (renamed → `andThen`, with a comment); (2) a wrong import path
      (`../extensions/…` → `../src/extensions/…`). Removed both vitest exclusions;
      96 runtime tests now pass in CI. Deleted the 7 "Global Augmentation
      type-check" tests — they used method syntax needing transformer rewriting
      that doesn't run in vitest, while `typecheck` is off and std's tsconfig
      excludes tests, so they asserted nothing; augmentation coverage already
      lives in `augmentation-consistency.test.ts` + `tsc` on `src/`.
- [x] `packages/contracts/tests/contracts.test.ts` — the "wrong node type" TODO
      was stale; `requiresMacro.expand` returns the right `BinaryExpression`
      now. Un-skipped; passes.
- [x] `packages/macros/src/hkt.test.ts` (`it.todo`) — fixed
      `countUnderscoreMarkers` to walk the full subtree (was gated on
      `ts.isTypeNode`, skipping `PropertySignature` members of a `TypeLiteral`).
      Replaced the todo with two real tests (`{ value: _ }` and a nested case).
- [x] `tests/source-map-unicode.test.ts` (`it.fails`) — bug did **not** evaporate
      and is **not** multi-byte: a `${…}` template-literal substitution (emoji or
      not) loses mapping after a macro expansion; a plain string maps fine. Filed
      #19, rewrote the test to state the true root cause, kept it as a live
      `it.fails` guard. Genuine multi-byte mapping is covered by the passing
      sibling tests.
- [x] `tests/jsdoc-macros.test.ts` — `@deriving` on type alias **is** supported
      now (`isJSDocMacroTargetNode` includes `TypeAliasDeclaration`); the skip was
      stale. Un-skipped; passes.
- [x] Root `tests/contracts.test.ts` was a pure duplicate of the package file
      (identical `it()` titles, differs only in harness setup) — deleted.
      `tests/contracts-coq.test.ts` (distinct dependent-types/decidability suite)
      `git mv`'d to `packages/contracts/tests/contracts-coq.test.ts` (kept as its
      own file by concern rather than crammed into `contracts.test.ts`). Both run
      in the package project; 84 tests pass.
- [x] AGENTS.md "Test Skips" policy added: every `.skip`/`.todo`/`.fails`/`xit`
      needs a reason + issue/PEP reference (same line or within 3 lines above).
      CI enforces it in **Lint & Typecheck** via `pnpm run check:skips`
      (`scripts/check-test-skips.mjs`); `skipIf` and empty-body placeholders are
      exempt. Collapsed the 11 `describe.skip` in `tests/red-team-mapper.test.ts`
      into one documented outer skip (blocked on #9).

Done (2026-06-21). Recurring theme: most "broken test" markers were stale (the
contracts and jsdoc skips, the source-map "multi-byte" framing) or mislabeled
(the std "transformer fix" was an ESM `then`-export footgun). Real fixes landed
for the hkt recursion bug, the `then`→`andThen` rename, and the import-path typo;
one genuine source-map generation bug (#19) was documented rather than fixed.

## Wave 5 — Benchmarks out of the dark

The benchmark suites are `skipIf(CI)` — they never run anywhere visible, yet
build-time overhead is the first adopter question.

- [x] A scheduled (weekly) CI job running `tests/benchmark.test.ts` and
      `benchmark-e2e.test.ts` on a fixed runner class, publishing results to
      `docs/PERFORMANCE.md` (numbers section: cold build, warm cache, per-file
      transform overhead on a representative 50-file project).
- [x] Add the headline number to the README once it exists.

Done (2026-06-29): added `pnpm bench` (prefixes `CI=` so the `skipIf(CI)` suites
un-skip even on a runner) and `.github/workflows/benchmark.yml` (weekly + manual;
report-only via `continue-on-error`, publishes to the job summary + a 30-day
artifact). Seeded `docs/PERFORMANCE.md` with a dated "Measured Numbers" section
(transform-only, cold-pipeline, comptime/hygiene throughput) from a local run, and
added the headline (~4 ms / 50-line, ~12 ms / 200-line, ~6M comptime expr/sec) to
the README. Note: the weekly job publishes to the run's job summary/artifact rather
than auto-committing `PERFORMANCE.md` (avoids bot-commit churn); regenerate the doc
locally with `pnpm bench`.

## Wave 6 — Residual `__binop__` text scrub (from PEP-020 withdrawal)

[PEP-020](PEP-020-replace-binop-with-named-macros.md) was withdrawn (superseded by
PEP-047, which deleted the `.sts` preprocessor and all `__binop__`/`__pipe__` operator
machinery). Stale text describing the removed `__binop__` dispatch still survives in a
few non-test files and should be scrubbed:

- [x] `packages/core/src/diagnostics.ts` (~L1236, L1246) — two diagnostic message
      strings still tell users to "implement a method that `__binop__` can dispatch
      to" / reference "the `__binop__` macro". Rewrite for the current `@op`
      typeclass-method operator path (no `__binop__`).
- [x] `docs/architecture.md` (~L373) — "Operator Resolution Order (for `__binop__`)"
      section describes a removed pipeline. Rewrite or delete.
- [x] `packages/unplugin-typesugar/examples/showcase.ts` (~L219),
      `packages/eslint-plugin/examples/showcase.ts` (~L109–110),
      `packages/transformer/examples/showcase.ts` (~L167, L172) — stale comments and
      one `__binop__(...)` code/assert string. Update to current output.

`packages/transformer/tests/language-service.test.ts` — PEP-047 called these "valid
post-removal coverage", but on inspection most are not. The LS-plugin mechanism they
exercise (wrapping `getScriptSnapshot` to serve transformed code) is **still live**
(`language-service.ts:348`), so the fix is to **rewrite them against real transformer
output**, not preserve a fabricated `__binop__` transform:

- [x] **"VS Code Simulation" ×2 + "Transform-First Analysis"** (~L461, L502–561, L670)
      hand-roll `declare function __binop__` + a regex `|> → __binop__(…)` to fake a
      transform that no longer exists. Rewrite the mock host to emit a **real** macro
      the transformer still produces (e.g. a `match()`/`pipe()`/`@derive` snippet) so
      they test the live snapshot-wrapping path against real output.
- [x] **`not.toContain("__binop__")`** (~L160–173) is now a tautology (`__binop__`
      can never be emitted). Rewrite to assert the actual intent — a plain `.ts` file
      is served unchanged (preprocessing skipped) — or delete.
- [x] **"suppresses diagnostics that cannot be mapped"** (~L425) is the one keeper;
      only its comment references `__binop__`. Drop the stale comment.

The `number::__binop__(Show` regression guard in `packages/macros/src/coverage.test.ts`
is a registry-key string literal, not a feature reference — leave it.

**Gate:** `rg '__binop__' --type ts --type md` returns only the `coverage.test.ts`
registry-key guard (plus historical PEP markdown).

Done (2026-06-29): rewrote the two `diagnostics.ts` operator messages for the `@op`
typeclass path; rewrote the `architecture.md` operator section; updated the
transformer/unplugin/eslint showcase comments + the transformer showcase
`PreprocessedFile` example (now HKT `F<A>`→`Kind<F, A>`). In
`language-service.test.ts`: deleted the redundant tautology test and the entire
fabricated-transform "VS Code Simulation" block (the live snapshot-wrapping path is
covered by the real-plugin tests + "verifies LS uses modified host"), and rewrote
"Transform-First Analysis" to drive a real `pipe()` macro. Gate holds.

## Done Criteria

- `git grep -l "PLAN-post-migration"` returns nothing.
- `docs/completed/` does not exist.
- ROADMAP/TODO contain no item owned by a PEP without naming it.
- Red-team include-path test passes; SECURITY doc dated 2026-06 or later.
- Zero `.skip` without reason+reference; std extensions test runs in CI.
- PERFORMANCE.md contains dated, machine-generated numbers.
- `rg '__binop__' --type ts --type md` returns only the `coverage.test.ts`
  registry-key guard and historical PEP markdown.

## Suggested order of the whole program

PEP-049 Wave 1 (30 min) → PEP-047 Waves 1–4 (`.sts` out) → PEP-048 (triage,
now rebased on a smaller tree) → PEP-049 Waves 2–5 (docs/security/tests against
the final shape) → wedge PEPs (040 first) on the cleaned base.
