# PEP-051: README → Guide Consolidation (one set of docs)

**Status:** In Progress (2026-06-29)
**Date:** 2026-06-29
**Author:** Claude (with Dean Povey)
**Follows:** the docs overhaul series (PRs #23 SSOT, #24 onboarding, #25 examples)

## Context

The docs overhaul established the microsite ([typesugar.org](https://typesugar.org))
as the single source of truth: every package README now carries a canonical-docs
banner, the root README points to the microsite, and onboarding + the flagship
"Zero-Cost, Seen" page live there.

But the consolidation is only half done. An audit found that **17 feature-package
READMEs are _richer_ than their microsite guide** — the README is the de-facto
canonical source, sometimes by 9×:

| Package     | README | guide |     | Package           | README | guide |
| ----------- | ------ | ----- | --- | ----------------- | ------ | ----- |
| sql         | 1058   | 120   |     | testing           | 256    | 105   |
| math        | 552    | 101   |     | units             | 252    | 98    |
| effect      | 540    | 258   |     | erased            | 243    | 187   |
| mapper      | 446    | 61    |     | reflect           | 190    | 82    |
| contracts   | 382    | 260   |     | fusion            | 172    | 162   |
| type-system | 375    | 93    |     | codec             | 169    | 152   |
| graph       | 327    | 199   |     | specialize        | 125    | 122   |
| validate    | 266    | 103   |     | strings           | 108    | 53    |
|             |        |       |     | contracts-refined | 102    | 66    |

"Thin the READMEs to pointers" (the agreed end state) therefore can't be
mechanical — the guide must absorb the README's content first, or we lose it.
This PEP does that **migrate-then-thin** for those 17 packages so there is truly
one set of docs.

Package READMEs are **not published to npm** (none list README in `files`), so
they are GitHub-discovery only — making the microsite the safe canonical home.

## Goals

- Microsite guide = the canonical, complete reference for each package.
- Package README = a thin pointer: one-line description, install, **one** minimal
  example, and links to the guide. (~25–40 lines; same shape as the already-thinned
  `fp`/`derive`/`typeclass` READMEs.)
- **No content lost** in the move.

## Non-goals

- The no-guide infra/tooling packages (`core`, `transformer`, `transformer-core`,
  `macros`, `unplugin-typesugar`, `ts-plugin`, `lsp-server`, `vscode`,
  `eslint-plugin`, `playground`, `collections`, `typesugar`) — they carry the
  banner already and point to reference/getting-started. Creating a `collections`
  guide is a small separate item, tracked but not in scope here.
- The 3-tier `docs/examples/` duplication collapse (separate follow-up).
- The `typesugar.dev` → `.org` URL canonicalization (separate).

## Approach (per package)

1. **Audit** — diff the README against its guide; identify README-only content.
2. **Migrate** — move (cut, not copy) the README-only content into the guide,
   organized under the guide's existing structure. Keep examples accurate to
   current APIs.
3. **Verify the guide** — `pnpm docs:build` clean; the guide now covers everything
   the README did.
4. **Thin the README** — reduce to the standard template (banner + description +
   install + one example + "## Documentation" links).
5. **No-loss check** — confirm every README section is represented in the guide
   (or intentionally dropped as stale, noted in the PR).

## Waves (by size / blast radius)

Each wave is one reviewable PR.

### Wave 1 — small (≤ ~190 lines)

`strings`, `contracts-refined`, `specialize`, `codec`, `fusion`, `reflect`

### Wave 2 — medium (~190–330 lines)

`erased`, `units`, `testing`, `validate`, `type-system`, `graph`

### Wave 3 — large (~380–1058 lines)

`contracts`, `mapper`, `effect`, `math`, `sql`

## Done criteria

- All 17 feature-package READMEs are thin pointers (~≤ 40 lines): description +
  install + one example + doc links.
- Each corresponding guide is the complete canonical reference (no information
  only in the README).
- `pnpm docs:build` passes; no dead links introduced.
- A spot-check confirms no API/feature documented in the old README is missing
  from the guide.
