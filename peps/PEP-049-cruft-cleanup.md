# PEP-049: Cruft Cleanup — Stale Plans, Docs Drift, Test Debt, Security Backlog

**Status:** In Progress
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

- [ ] `packages/std/tests/extensions.test.ts` — excluded in `vitest.config.ts`
      "temporarily… needs transformer fix". Fix or delete; "temporarily" with no
      owner is how suites rot.
- [ ] `packages/contracts/tests/contracts.test.ts:174` — `requiresMacro.expand`
      returns wrong node type; pre-existing failure. Fix the macro or the test.
- [ ] `packages/macros/src/hkt.test.ts:620` (`it.todo`) —
      `countUnderscoreMarkers` misses PropertySignature inside TypeLiteral
      (TypeElement vs TypeNode in the recursion filter). Known bug with a known
      cause; fix it.
- [ ] `tests/source-map-unicode.test.ts:196` (`it.fails`) — position mapping
      returns null after emoji + pipe expansion. Note: if PEP-047 removes pipe
      syntax, re-test; the bug may evaporate or may reproduce with other
      expansions — keep the multi-byte regression test either way.
- [ ] `tests/jsdoc-macros.test.ts` — `@deriving` on type alias skipped with no
      reason recorded. Decide: support it (it's a natural ask) or document the
      limitation and delete the skip.
- [ ] Policy line for AGENTS.md: **every `.skip` must carry a reason comment and
      an issue/PEP reference**; CI greps for naked skips.

## Wave 5 — Benchmarks out of the dark

The benchmark suites are `skipIf(CI)` — they never run anywhere visible, yet
build-time overhead is the first adopter question.

- [ ] A scheduled (weekly) CI job running `tests/benchmark.test.ts` and
      `benchmark-e2e.test.ts` on a fixed runner class, publishing results to
      `docs/PERFORMANCE.md` (numbers section: cold build, warm cache, per-file
      transform overhead on a representative 50-file project).
- [ ] Add the headline number to the README once it exists.

## Done Criteria

- `git grep -l "PLAN-post-migration"` returns nothing.
- `docs/completed/` does not exist.
- ROADMAP/TODO contain no item owned by a PEP without naming it.
- Red-team include-path test passes; SECURITY doc dated 2026-06 or later.
- Zero `.skip` without reason+reference; std extensions test runs in CI.
- PERFORMANCE.md contains dated, machine-generated numbers.

## Suggested order of the whole program

PEP-049 Wave 1 (30 min) → PEP-047 Waves 1–4 (`.sts` out) → PEP-048 (triage,
now rebased on a smaller tree) → PEP-049 Waves 2–5 (docs/security/tests against
the final shape) → wedge PEPs (040 first) on the cleaned base.
