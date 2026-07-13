# Plan: Generated API Reference (deferred)

**Status:** Planned, not scheduled. Deliberately deferred by
[PEP-058](https://github.com/typesugar/typesugar/blob/main/peps/PEP-058-production-release-readiness.md)
Wave 7 — this document is the decision record and the design for when it _is_
picked up.

> Note: this plan is current (written 2026-07), unlike the other documents in
> this directory. It carries no historical-document banner.

## The question

typesugar has no symbol-level API reference — no typedoc, no generated
signature pages. Everything user-facing is hand-written: the
[guides](/guides/), the [reference section](/reference/), and (since PEP-058
Wave 4) the [error catalog](/errors/). Should we generate one?

## Decision: not yet — and not for the whole workspace, ever

**Why not now.** The public surface of a macro system is not a set of function
signatures. It is:

- **macro invocation forms** — `/** @derive(Eq) */`, `comptime(...)`,
  `match(...)`, `@impl`/`summon` — which are syntax, not exported symbols, and
  which typedoc cannot see at all;
- **the generated shapes** those macros produce (`Point.Eq.equals`), which do
  not exist in the source typedoc reads;
- **a small runtime surface** (`@typesugar/std`, `@typesugar/fp` companions)
  that the guides already cover with worked examples.

Typedoc over the workspace as it stands would document the _implementation_ —
`MacroContext`, `DiagnosticBuilder`, `RichDiagnostic`, `TransformationPipeline`,
expansion caches — none of which are user API. That is worse than nothing:

- it buries the ~5% that is user-facing under 95% internals;
- and it actively **misleads AI assistants**, which now consume
  [`llms-full.txt`](https://typesugar.org/llms-full.txt) (PEP-058 Wave 5). An
  agent that finds `DiagnosticBuilder` in an "API reference" will try to use
  it. This is the same reasoning that keeps superseded design docs out of the
  corpus.

**Why not never.** Two real gaps a reference would close: the `@typesugar/std`
and `@typesugar/fp` runtime companions (`map`, `flatMap`, `fold`, the typeclass
method sets) have no signature-level listing, and macro _authors_ (the
`extension-author` persona) have no generated `MacroContext` reference — only
the hand-written [MacroContext page](/reference/macro-context).

## Trigger conditions

Pick this up when **any** of:

1. A stable, declared **macro-authoring API** exists (`@typesugar/core`'s
   author-facing surface frozen behind a semver promise) — the natural moment
   is a 1.0, or the PEP that declares it.
2. Sustained user demand: issues asking "what methods does `Option` have"
   that the guides genuinely fail to answer.
3. The runtime packages grow beyond what worked examples can cover.

## Design, for when it happens

**Scope: entry-point whitelisting, not workspace-wide.** Generate only the
user-facing surface, from an explicit list — never `packages/*`:

| Package              | What to include                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `@typesugar/std`     | typeclasses + their method signatures; `match`; extension methods                                                                         |
| `@typesugar/fp`      | `Option`/`Either`/`IO` companions and typeclass instances                                                                                 |
| `@typesugar/core`    | **only** the macro-author surface (`MacroContext`, `defineMacro*`, `MacroDefinition`) — explicitly `@internal`-tagged for everything else |
| `typesugar` (facade) | the re-exported public surface                                                                                                            |

Everything else — `transformer`, `transformer-core`, `macros`, `lsp-*`,
`ts-plugin` — is implementation and stays out.

**Mechanism.** `typedoc` + `typedoc-plugin-markdown`, emitting into
`docs/reference/api/`, wired into the VitePress sidebar under Reference.
Enforce the boundary with typedoc's `--excludeInternal` plus an explicit
`entryPoints` list, and gate it in CI the way the error catalog is gated
(regenerate, diff, fail on drift).

**llms.txt interaction.** The generated pages must be _included_ in
`llms-full.txt` (they're real user docs) — but only because the scoping above
guarantees they contain no internals. If the scope ever widens, revisit that.

**Effort:** ~M. The work is not running typedoc; it is curating the entry
points and `@internal`-tagging `@typesugar/core` so the boundary is
machine-enforced rather than aspirational.

## In the meantime

`docs/reference/` states the policy explicitly, so a reader looking for a
generated reference knows it's a decision, not an oversight.
