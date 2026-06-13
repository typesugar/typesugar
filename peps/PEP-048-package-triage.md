# PEP-048: Package Triage — Keep, Freeze, or Remove

**Status:** Done
**Date:** 2026-06-10
**Author:** Dean Povey

## Context

The monorepo has 42 packages (~160k LoC) and one maintainer. The ROADMAP's own
diagnosis — zero external users; more features won't fix that — implies a
corollary it never states: **less surface area would help.** Every published
package is an implicit promise of maintenance, docs, and compatibility. Several
packages are off-mission showcases (symbolic calculus), several are niche
experiments (hlist, erased), and several exist only to support `.sts`
(PEP-047). Meanwhile the packages that carry the adoption strategy (validate,
mapper, tool) are under-invested — mapper's flagship macro still throws at
runtime.

This PEP defines triage criteria, assigns every package a tier, and specifies
the mechanics of freezing/removing.

## Criteria

A package earns **Keep** by satisfying at least one of:

1. **Core** — the transformer pipeline or macro infrastructure depends on it.
2. **Wedge** — it is (or directly supports) a standalone-adoptable feature with
   a named PEP and a real audience (PEP-040…046).
3. **Cheap** — facade/re-export packages with near-zero maintenance cost.

Everything else is **Freeze** (stays in repo, excluded from README claims, no
active work, issues auto-tagged `frozen`) or **Remove** (deleted from the repo;
git tag `pre-triage-2026-06` preserves recovery).

## Triage Table

### Keep — Core (12)

| Package                                   | Note                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| core                                      | registry, diagnostics, context                                         |
| transformer                               | main pipeline                                                          |
| transformer-core                          | browser-safe engine; playground depends on it                          |
| macros                                    | all built-in macros                                                    |
| std                                       | flagship typeclasses + match                                           |
| type-system                               | refined types — **zero tests today; add tests as a condition of Keep** |
| typesugar                                 | umbrella                                                               |
| unplugin-typesugar                        | the supported integration path                                         |
| ts-plugin                                 | editor story for `.ts`                                                 |
| vscode                                    | expansion preview, diagnostics (post-PEP-047 slimming)                 |
| playground                                | the marketing surface                                                  |
| derive / reflect / typeclass / specialize | facades; cheap (counted as one line item)                              |

### Keep — Wedge (10)

| Package                      | Justification                                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| validate                     | wedge in its own right + dependency of PEP-040/045                                                                                 |
| mapper                       | **condition: implement `transformInto` (TODO #5/#6) or demote to Freeze** — the README must not advertise a runtime-throwing macro |
| contracts, contracts-refined | contracts prover backs PEP-045; refined integration is ROADMAP P4                                                                  |
| testing                      | property tests back verify-laws; ROADMAP P4 shrinking                                                                              |
| fp                           | typeclass showcase; **only 2 test files for 19k LoC — add coverage or shrink scope**                                               |
| effect                       | Effect-TS interop is an adoption bridge, not a competitor play                                                                     |
| sql                          | PEP-043                                                                                                                            |
| graph                        | PEP-046                                                                                                                            |
| fusion                       | PEP-042                                                                                                                            |
| tool _(new)_                 | PEP-040                                                                                                                            |

### Freeze (8)

| Package                 | Why frozen, not removed                                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| parser                  | PEG machinery is reused by PEP-043 Wave 3 (SQL subset parser); no standalone roadmap                                                                            |
| collections             | small, harmless; verify nothing in std imports it before freezing                                                                                               |
| codec                   | versioned codecs are coherent but audience-less today                                                                                                           |
| units                   | good demo, tiny; revisit if implicit conversion (P4) ever schedules                                                                                             |
| math                    | standalone numerics; PEP-042 Phase 3 may revive parts (typed-array vectors live in fusion, not here)                                                            |
| strings                 | tiny; keep published, no work planned                                                                                                                           |
| erased                  | Phase 2 unstarted; niche                                                                                                                                        |
| lsp-server + lsp-common | post-PEP-047 the `.ts`-only story is ts-plugin; standalone LSP mattered mostly for `.sts`/Zed. Freeze rather than remove: non-VS Code editors may still want it |

### Remove (4)

| Package         | Why                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| zed             | `.sts`-only, empty skeleton (via PEP-047)                                                                                   |
| prettier-plugin | purpose was custom syntax; stock Prettier handles `.ts` (via PEP-047)                                                       |
| symbolic        | 6k LoC of symbolic calculus — impressive, wholly off-mission, drags math with it. Extract to a personal repo if sentimental |
| hlist           | TS tuple recursion limits cap it (~20 elements, ROADMAP P6); Boost.Fusion homage with no path to an audience                |

Net effect: 42 → ~36 in-repo, **22 actively claimed** packages, and a README
table that matches reality.

## Wave 0 Findings (2026-06-10) — tier + mechanic adjustments

The dependency-graph pass surfaced more entanglement than the draft tiers
assumed. Adjustments made before execution:

- **`lsp-common` → Keep (Core), not Freeze.** `@typesugar/transformer` (core,
  published) runtime-depends on it. It is load-bearing infrastructure, not a
  standalone-LSP leaf; freezing/excluding it would break the published
  transformer.
- **`playground` → `private: true`.** It is published today but is a
  bundled docs-site app that runtime-`dependencies` ~20 workspace packages
  (incl. `symbolic`, `math`, `units`, `parser`, `codec`, `collections`).
  Publishing it forces all of those to stay published. Marking it private
  (correct for a bundled app — the docs site consumes it via workspace, not
  npm) unblocks release-excluding the freeze packages it bundles.
- **Changeset release-exclusion is applied only where safe.** A package may be
  changeset-`ignore`d only if no _published_ Keep package runtime-depends on
  it. After the two changes above, the safe set is `strings`, `erased`,
  `lsp-server` (only `vscode`, which is private, bundles it), and
  `math`/`units`/`parser`/`codec` (only `playground`, now private). **`collections`
  stays released** — `@typesugar/graph` (published Wedge, PEP-046) runtime-depends
  on its `HashSet`/`HashMap`. All frozen packages still get README-demotion +
  a status banner regardless.
- **Remove set unblocking:** `playground` is the only non-test consumer of a
  Remove-set package (`symbolic`); its import/dep/bundle entries are removed.
  `hlist` and `prettier-plugin` have only test/example/docs consumers.

## Mechanics

1. **Verification pass first** (Wave 0): `pnpm why` / grep import graph to
   confirm no Keep package depends on a Freeze/Remove package. Known risks:
   does symbolic depend on math (fine — both leave active status together)?
   does std import collections? Adjust tiers on findings, not aspirations.
2. **Freeze** = README table moves the package to a "Frozen" section with one
   honest line; package README gets a status banner; excluded from changesets
   release; vitest still runs their tests (they're cheap insurance).
3. **Remove** = git tag `pre-triage-2026-06`, then delete directory, purge from
   pnpm-workspace/tsconfig refs/docs tables, deprecate on npm if ever published
   (`npm deprecate`, do not unpublish).
4. **README/docs rewrite** is part of this PEP, not a follow-up: the package
   table is the project's shop window and currently oversells.

## Implementation Plan

- **Wave 0 — dependency verification** (above), finalize tiers.
- **Wave 1 — removals** (after PEP-047 Waves 1–2 land, to avoid rebasing
  through the `.sts` deletions).
- **Wave 2 — freeze markers** (README sections, banners, changeset config).
- **Wave 3 — keep-conditions**: file issues for mapper `transformInto`,
  type-system tests, fp coverage; each gets an owner-PEP or a demotion date
  (suggest: re-triage in 6 months, 2026-12).

## Open Questions

1. Is `effect` Keep or Freeze? It's the interop bridge argument vs. 19 source
   files of maintenance against a fast-moving upstream. Recommendation: Keep,
   but pin the supported Effect version range explicitly.
   **Resolved: Keep.** Pinned the peer range to `effect: ">=3.0.0 <4.0.0"` in
   `packages/effect/package.json` so support is an explicit Effect-3.x claim, not
   open-ended.
2. Should facades (derive/reflect/typeclass/specialize) collapse into the
   umbrella package's subpath exports (`typesugar/derive`)? Cleaner long-term;
   churn now. Recommendation: defer to a publishing-focused PEP.
   **Resolved: defer.** Facades stay as-is; revisit in a future publishing PEP.

## Wave 3 — Keep-conditions (resolved 2026-06-13)

Each conditional Keep gets an owner or a **re-triage date of 2026-12-10** (6 months
from the PEP date); if the condition is unmet by then, the package demotes to Freeze.

| Package         | Condition                                  | State (2026-06-13)                                                              | Resolution                                                    |
| --------------- | ------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| **mapper**      | implement `transformInto` (TODO #5/#6)     | **Met** — `transformInto`/`transformArrayInto` macros generate code (`buildMappingExpression`); the runtime `throw` is the standard transformer-not-configured guard; tests pass | Keep confirmed; README claim is accurate. No demotion. |
| **type-system** | add tests (zero today)                     | **Unmet** — 0 test files                                                       | Re-triage 2026-12-10; demote to Freeze if still untested.     |
| **fp**          | add coverage or shrink scope (2 files/19k) | **Unmet** — 2 test files                                                       | Re-triage 2026-12-10; add coverage or shrink scope.           |

## Completion (2026-06-13)

All waves landed:

- **Wave 1 — Remove:** `zed`, `prettier-plugin`, `symbolic`, `hlist` deleted (git
  tag `pre-triage-2026-06` preserves recovery); leftover build-artifact dirs cleared.
- **Wave 2 — Freeze:** the 8 frozen packages (`parser`, `collections`, `codec`,
  `units`, `math`, `strings`, `erased`, `lsp-server`) carry README status banners
  and a README "Frozen" section; `playground` is `private: true`; changeset `ignore`
  covers the safe release-exclusion set (`strings`, `erased`, `lsp-server`, `math`,
  `units`, `parser`, `codec`).
- **Wave 3 — Keep-conditions:** tracked above with a 2026-12-10 re-triage date.
- **Open Questions:** both resolved (effect Keep + pinned; facades deferred).
