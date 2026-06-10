# PEP-049: Cruft Cleanup — Stale Plans, Docs Drift, Test Debt, Security Backlog

**Status:** Draft
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

- [ ] Fix root `tsconfig.json` references (still points at deleted `src/`)
- [ ] Remove legacy test exclusions in the vitest workspace config
- [ ] Fix vitest coverage paths
- [ ] Replace transformer's hardcoded path mappings with the generic pattern

Then delete the PLAN file (its content moves into the commit message).

## Wave 2 — Docs hygiene

- [ ] **Rename `docs/completed/` → `docs/plans/`** — it contains forward-looking
      feature plans, not completed work. Audit each file: plans superseded by
      shipped PEPs get a one-line header pointing at the PEP; plans superseded
      by PEP-042/043/046 likewise (expression-templates → PEP-042, spirit-parsers
      → PEP-043 Wave 3 note, graph → PEP-046).
- [ ] **Refresh ROADMAP.md** (last updated 2026-03-16): mark shipped items
      (PEP-039 hardening), fold the P1/P4/P5 items now owned by PEP-040…046 into
      references, remove `.sts`-dependent items per PEP-047, restate the P6 taint
      row as "superseded by PEP-045".
- [ ] **Refresh TODO.md**: delete entries that are now PEPs (state machines,
      taint, validate+refined wiring), delete `.sts`-obsoleted entries
      (phase-separation item shrinks to the HKT-rewriter note per PEP-047).
- [ ] **README accuracy pass**: package table per PEP-048 tiers; remove the
      `.sts` comparison table; do not advertise `transformInto` until it works.
- [ ] Add a `peps/README.md` index (number, title, status, one-liner) — 39+ PEPs
      with no index is real friction.

## Wave 3 — Security backlog

`docs/SECURITY-REVIEW.md` (2026-02-21, carries its own stale notice) has two
CRITICALs with no evidence of remediation in the log:

- [ ] **F2 (CRITICAL, ~1 day): path traversal in `includeStr`/include macros** —
      boundary-check resolved paths against the project root; add red-team tests
      (`includeStr("../../../.env")` must fail with a diagnostic).
- [ ] **F1 (CRITICAL, decision + docs): unrestricted macro registration** — full
      allowlisting is a project of its own; the Wave-3 deliverable is (a) a
      `macros.allow` config option gating which modules may register macros when
      set, default permissive, and (b) an honest `docs/SECURITY.md` trust-model
      statement: _compiling untrusted code with typesugar executes that code's
      macros; treat macro-bearing dependencies like build scripts._
- [ ] Re-date the review; downgrade/close findings that PEP-039 or config
      changes already addressed; file issues for remaining HIGHs (F3–F5) so they
      live in the tracker, not only in a stale doc.

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
