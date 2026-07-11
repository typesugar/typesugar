# PEP-058: Production Release Readiness — Pipeline, AI Affordances, Onboarding

**Status:** In Progress (2026-07-11) — Wave 1 (pipeline repair) in flight
**Date:** 2026-07-11
**Author:** Claude (with Dean Povey)
**Depends on:** [PEP-033](PEP-033-production-readiness.md) (Done — functional correctness), [PEP-048](PEP-048-package-triage.md) (package triage), [PEP-050](PEP-050-shipping-typesugar-libraries.md) (shipping libraries), [PEP-051](PEP-051-readme-guide-consolidation.md) (docs consolidation)

## Context

PEP-033 closed out functional correctness: the headline features work
end-to-end through the CLI, the dry-run scenarios pass, and the docs site is
real and deployed (typesugar.org via Vercel, with a server-backed live
playground embedded and CI-tested). What remains between "correct" and
"released" is operational. A three-way audit (2026-07-11: docs/README ·
onboarding/examples/playground · AI-affordances/publish-pipeline) verified
exactly what's broken:

- **The release pipeline has been red since ~April 2026.** A changesets
  ignore-list validation failure blocks every release; npm is three months
  and ~20 PEPs stale at 0.1.1 (last publish 2026-04-03) with 16 changesets
  queued. The published packages predate most of the correctness work this
  repo has done since.
- **The VS Code extension has never been published** to the Marketplace,
  and a package-name typo in CI filters (`@typesugar/vscode` vs the real
  name `typesugar-vscode`) means its test jobs have silently never run.
- **Zero consumer-facing AI affordances exist** — no llms.txt, no
  scaffolded agent context in user projects, an error catalog covering 3
  of ~25 diagnostic codes (despite the compiler emitting help URLs for all
  of them), and every existing AI artifact in the repo (AGENTS.md,
  .cursor/rules, the macro-authoring skill) is contributor-facing, not
  consumer-facing.
- **`typesugar init` silently no-ops in the most common brownfield case**:
  `patchBundlerConfig` computes but discards its result when a bundler
  config already exists — it never patches an existing vite/webpack/rollup
  config, only creates new ones.
- Polish debt: `typesugar.dev` vs `typesugar.org` domain inconsistency
  (including in compiler-emitted error URLs baked into published
  packages), an orphaned 16 KB pattern-matching guide unreachable from
  nav, stale internal design docs contradicting the shipped model
  (.sts / explicit `specialize()` / global registries), monorepo-only
  examples (one with a 0-byte package.json), no `engines` fields, no npm
  provenance.

**Verified good — explicitly not re-worked here:** root README (real
quick-start, comparison table), the 40 guides + 5-minute quickstart +
per-environment install pages, the deployed docs site + playground,
`typesugar doctor` (13 checks), `create` templates on published semver,
package metadata (33/35 READMEs, exports/keywords correct), the CI publish
dry-run job, sideEffects flags.

**Decisions (Dean, 2026-07-11):** target **0.2.0** (let the queued
changesets resolve; save 1.0 for a marketing moment after external usage);
AI scope = **llms.txt + init-scaffolded AI context + Claude Code skill**
(MCP server deferred to a future PEP); API reference = **author the
deferred plan now, don't implement**; VS Code extension = **publish to the
Marketplace this release**.

## Sequencing

```
W1 pipeline repair ─► W2 onboarding + pre-release src fixes ─► W3 RELEASE 0.2.0
                                                                    │
            ┌───────────────────────────────────────────────────────┤
            ▼                                                       ▼
      W4 error catalog ─► W5 llms.txt ─► W6 consumer AI      W7 docs polish (parallel)
                                              │              W8 examples   (parallel)
                                              ▼
                                    W9 release verification (last)
```

One PR per wave, each independently green (full build + full vitest +
prettier). Hard constraints: W1 before any version/publish; W4 before
W5/W6 (the AI context references the completed error catalog); W9 last,
after W6's release has published.

---

## Wave 1 — Release pipeline repair (S→M)

**Goal:** the Release workflow goes green on main and produces a correct
"Version Packages" PR; the VS Code extension's tests actually run in CI.

1. **`.changeset/config.json` — remove the `ignore` list entirely** (not
   merely add the missing private dependents). The ignored packages
   (`strings`, `erased`, `lsp-server`, `math`, `units`, `parser`, `codec`)
   are public and published; version-freezing them breaks dependency
   coherence — e.g. the Zed extension npm-installs `@typesugar/lsp-server`,
   which would pin `@typesugar/core@^0.1.x` forever while everything else
   moves to 0.2.x — and queued changesets already reference
   lsp-server/lsp-common/playground, so the freeze is violated in practice.
   PEP-048's freeze intent (no feature investment, excluded from README
   claims) survives without version-freezing; noted in PEP-048's ledger.
   Private packages (`@typesugar/playground`, `typesugar-vscode`, the
   dry-run examples) get versioned by changesets but never npm-published
   (`changeset publish` skips `private: true`). Versioning
   `typesugar-vscode` is a feature, not a bug — it feeds `vsce publish` a
   fresh version each release. Set
   `privatePackages: { version: true, tag: false }` explicitly.
2. **Fix the CI filter typo** — `.github/workflows/ci.yml`:
   `@typesugar/vscode` → `typesugar-vscode` (3 occurrences). Budget for
   fixing whatever rot the resurrected vscode test jobs surface.
3. **`engines: { "node": ">=20" }`** on every publishable package.
4. **npm provenance**: `NPM_CONFIG_PROVENANCE: true` in the changesets
   publish step env in `release.yml` (`id-token: write` already granted).
5. **Guard the vsce publish step** against re-runs (skip when the
   Marketplace already has the current version).

**Acceptance:** `pnpm changeset status` exits 0; CI fully green including
vscode tests actually executing; main push produces a Version Packages PR
with sane bumps (typesugar → 0.2.0); publish dry-run green. The version PR
is **not** merged in this wave (that's W3).

## Wave 2 — Onboarding fixes + pre-release source corrections (M)

Everything baked into the published packages must be fixed before 0.2.0.

1. **`init.ts` `patchBundlerConfig`** — actually patch existing configs:
   insert the unplugin import after the last import, inject `typesugar()`
   first in an existing `plugins: [...]` array; fall back to the "add
   manually" hint only when no plugins array is found (making the hint the
   exception, not the silent default). Cover vite/webpack/rollup config
   filename variants; esbuild scripts stay hint-only. Fixture tests in
   `packages/transformer/tests/init-patch.test.ts`.
2. **Next.js honesty** — the `bundler === "next"` early-return prints an
   explicit "not yet supported; see docs for manual webpack setup" instead
   of implying support.
3. **`doctor` `checkTsPatchActive`** — replace the fragile `"tsp"`
   substring grep with the real ts-patch signature.
4. **Domain fix in shipped source** — `typesugar.dev` → `typesugar.org` in
   all `seeAlso` URLs in `packages/core/src/diagnostics.ts`
   (compiler-emitted), `create.ts` printNextSteps, + full `packages/`
   sweep.
5. **Package hygiene**: READMEs for `@typesugar/lsp-common` and
   `@typesugar/specialize`; `sideEffects: false` on lsp-common.
6. Changesets: patch for transformer, core, lsp-common, specialize.

**Acceptance:** init against a fixture with an existing `vite.config.ts`
produces a building config; `grep -rn "typesugar\.dev" packages/` empty;
new tests green.

## Wave 3 — The release: 0.2.0 to npm + VS Code Marketplace (M, ops)

1. **Pre-flight (manual, Dean):** `NPM_TOKEN` valid with publish rights on
   the `@typesugar` scope + `typesugar`/`unplugin-typesugar`; the
   `typesugar` Marketplace publisher exists and `VSCE_PAT` is set.
2. **Merge the Version Packages PR** from W1 (facade → 0.2.0; keep
   independent versioning — no `fixed` groups mid-recovery).
3. Merge triggers `release.yml`: `changeset publish` (with provenance),
   then `vsce publish`. `private: true` stays on typesugar-vscode (vsce
   ignores npm's private field; it only blocks npm publish, which is
   wanted). Verify LICENSE lands in the .vsix.
4. **Post-publish smoke test (same day):** temp dir against real npm:
   `npx typesugar@latest create app` → install → build → run; `doctor` all
   green; Marketplace extension in a clean VS Code profile; error help URL
   resolves.
5. **Codify** as `scripts/release-smoke.mjs` + a `workflow_dispatch`
   workflow (W9's backbone).
6. Stretch (don't block): Open VSX publish (`ovsx`) — Cursor/Windsurf
   users are disproportionately the AI-assistant audience.

**Acceptance:** all public packages freshly published with provenance;
extension installable from the Marketplace; smoke script green; release
workflow green end-to-end on a subsequent trivial changeset.

## Wave 4 — Error catalog completion (M) — foundation for the AI waves

Every diagnostic code in `packages/core/src/diagnostics.ts` (~25) gets a
real page at `docs/errors/TS<code>.md`. The descriptors are already
documentation-grade (code, severity, category, messageTemplate, long-form
explanation, seeAlso) — this is generation, not stub-writing.

1. **`scripts/generate-error-docs.mjs`** — writes/updates each page's
   generated region (between `<!-- generated:begin/end -->` markers);
   hand-written region below ("Example" + "How to fix") is never touched;
   new pages get a TODO skeleton. Regenerates `docs/errors/index.md` as a
   categorized table.
2. Migrate the 3 existing pages into marker format.
3. Hand-write Example + Fix for the ~10 highest-traffic codes.
4. **`--check` drift gate in CI** — a new descriptor without a page fails.
5. Errors section in the VitePress sidebar.

Committed-generated (not build-time) so pages are PR-reviewable,
hand-editable, agent-greppable, and flow into llms-full.txt for free.

**Acceptance:** 25/25 pages; every seeAlso URL resolves; --check green.

## Wave 5 — llms.txt + docs machine-readability (M)

1. Extract the sidebar definition to `docs/.vitepress/sidebar.ts` (one
   nav-order source for VitePress + the generator).
2. **`scripts/generate-llms-txt.mjs`** via VitePress `buildEnd` (writes
   into outDir → flows through existing deploy):
   - `llms.txt` (llmstxt.org spec): summary + nav-mirroring link sections
     - Errors section + llms-full.txt link.
   - `llms-full.txt`: concatenated markdown in sidebar order; strip
     frontmatter/Vue blocks; absolute links. Include getting-started/,
     guides/, reference/, writing-macros/, errors/, faq. Exclude plans/,
     vision/, design/, rfcs/, ANALYSIS-_, PLAN-_, architecture.md — which
     doubles as keeping stale internal docs out of AI context.
   - Evaluate `vitepress-plugin-llms` first; bespoke (~150 lines) if it
     can't do include/exclude + absolute links.
3. `sitemap: { hostname: "https://typesugar.org" }`; `<link
rel="alternate">`; docs-footer mention.
4. CI check: both files present, non-empty, no relative links in llms.txt.

**Acceptance:** both files served on typesugar.org; nav order matches
sidebar; no component residue; excluded dirs absent; sitemap served.

## Wave 6 — Consumer AI context: init scaffolding + Claude Code skill (L)

The centerpiece for "get AI assistance into a consumer's project".
Canonical content ships **inside the typesugar npm package** so it updates
with the package and cannot drift:

```
packages/typesugar/ai/
  AGENTS.md                    # canonical consumer context (~150-250 lines)
  skills/typesugar/SKILL.md    # Claude Code skill
```

(`"ai"` added to the facade's `files` array.) `init`/`create` copy from
`node_modules/typesugar/ai/` at runtime.

**Scaffolding policy — AGENTS.md-first:** write/merge `AGENTS.md` in the
project root (read natively by Cursor, Codex, Copilot, Zed). Claude Code
gets a pointer `CLAUDE.md` only if none exists (never edit an existing one
unprompted). No per-tool `.cursor/rules` / copilot-instructions — pure
drift surface. **Idempotent merge** via `<!-- typesugar:begin/end -->`
markers; `--ai`/`--no-ai` flags; default prompts (default yes) in the
persona picker. Templates get the same content via the same
copy-from-package path.

**AGENTS.md outline:** (1) what typesugar is — valid TS that MUST build
through a typesugar-aware pipeline; (2) setup invariants — keep the
unplugin/ts-patch wiring + tsconfig plugins entry; use `typesugar check`,
not raw `tsc --noEmit` (pre-transform artifacts like TS1206 are not real
errors); (3) macro syntax recognition table — comptime, @derive decorator
vs JSDoc forms, companion access + dot-syntax sugar, match() is
expression-based, operators, extensions, never hand-write companions or
"fix" seemingly-unused macro imports; (4) top-10 TS9xxx error table + the
"macro didn't expand" checklist; (5) debugging workflow — doctor →
`expand --diff` → error pages; (6) llms.txt / llms-full.txt pointers.

**Claude Code skill** (`ai/skills/typesugar/SKILL.md`): trigger-rich
description ("writing, debugging, or building in a project using typesugar
macros… TS9xxx diagnostic… macro 'didn't expand'"); body = AGENTS.md base

- workflows (`expand --diff` iteration loop; verify expansion before
  assuming a runtime bug). `init` offers to copy to
  `.claude/skills/typesugar/` when `.claude/` exists or `--ai` passed. A
  marketplace-distributed Claude Code plugin is a noted future follow-up.

Plus `docs/guides/ai-assistants.md`, marker-merge tests
(`init-ai.test.ts`), minor changesets.

**Acceptance:** init scaffolds AGENTS.md idempotently (outside content
preserved); `npm pack typesugar` contains `ai/`; skill frontmatter valid.

## Wave 7 — Docs polish (M) — parallel after W3

1. Domain sweep docs-side (`README.md`, guides) + full repo grep.
2. Pattern-matching nav fix: sidebar serves the real 16 KB guide; the 2 KB
   `match.md` folded or cross-linked (one page owns the slot).
3. Historical banners on stale internal docs (architecture.md,
   ANALYSIS-language-design.md, PLAN-language-service-v2.md, plans/_,
   vision/_, design/parameterized-instance.md). Banner, not rewrite.
4. Snippet import sweep — copy-runnable examples in getting-started/\* and
   the top ~10 guides; authoring convention noted. Full-corpus
   compile-checking out of scope.
5. **API reference — deferred plan authored** (per decision): a plan doc
   specifying typedoc scoped to the user-facing runtime surface only
   (std/fp/core/typesugar; excluding transformer/checker internals that
   would mislead agents), entry-point whitelisting, docs integration, and
   the implementation trigger (declared-stable macro-authoring API /
   post-0.3 / sustained demand). `docs/reference/index.md` notes the
   deliberate guide-based policy and links the plan. No typedoc
   implementation in this PEP.

**Acceptance:** zero typesugar.dev hits repo-wide; sidebar serves the real
guide; banners render; swept snippets compile as pasted; plan doc linked.

## Wave 8 — Examples (S) — parallel after W3

1. Fix or delete `examples/implicits/` (0-byte package.json).
2. **`examples/standalone/hello-world/`** on published deps
   (`^0.2.0`), excluded from the workspace — cloneable without the
   monorepo; wired into release-smoke.mjs.
3. Root examples stay on workspace:\* (CI fixtures — correct); README note
   pointing copy-seekers at standalone/ and `typesugar create`.

**Acceptance:** no empty package.json under examples/; hello-world builds
against the live registry in the smoke script.

## Wave 9 — Release verification (S) — last

Execute and record results here: create→install→build→run against real
npm (automated); doctor 13/13; scaffolded AGENTS.md current; Marketplace
extension works in a clean profile; playground loads (manual browser
check); llms.txt/llms-full.txt current with errors section; **agent test**
— a fresh, unprompted Claude Code/Cursor session in the demo project must
(a) explain a deliberately-introduced TS9xxx error and (b) add a
@derive(Eq) type and use match() correctly, using doctor/expand and the
error catalog rather than hallucinating; npm tags/provenance coherent;
this PEP → Done.

---

## Explicitly excluded

| Finding                                                               | Rationale                                                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| MCP server                                                            | Future PEP; llms.txt + AGENTS.md + doctor/expand cover agent needs. Deferred by decision.                          |
| docs/examples 3-tier duplication                                      | Already deferred by PEP-033/051; not release-gating; excluded from llms-full.txt.                                  |
| Legacy browser playground bundle (still imported by MonacoEditor.vue) | Working + CI-tested; consolidating dual paths right before a release is regression risk; future PEP-024 extension. |
| Per-tool AI files (.cursor/rules, copilot-instructions)               | Those tools read AGENTS.md natively; per-tool copies are drift surface. Only the CLAUDE.md pointer is warranted.   |
| Rewriting contributor-facing AGENTS.md/.cursor rules/skill            | Correct as contributor docs; the consumer gap is filled by W6.                                                     |
| typedoc implementation                                                | Planned-but-deferred by decision — W7 authors the plan doc.                                                        |
| fixed/lockstep versioning                                             | Policy change mid-pipeline-recovery adds risk; revisit at 1.0.                                                     |
| Compile-checking every docs snippet in CI                             | High-effort infra; W7 fixes high-traffic pages and sets the convention.                                            |

## Implementation status

- **Wave 1 — in flight** (this PR).
- Waves 2–9 — not started.
