# Architecture review brief (typesugar, pre-1.0)

Repo: /Users/deapovey/src/personal/typesugar, branch `deep-review-1.0` (PR #80, unmerged).
typesugar is a compile-time macro system for TypeScript: a TS transformer, an unplugin, ts-patch
and tsserver-plugin integrations, an LSP server and VS Code extension, a browser playground, and
about two dozen runtime libraries.

Before forming views, read: `CLAUDE.md`, `PHILOSOPHY.md`, `ROADMAP.md`, `docs/architecture.md`,
`peps/README.md` (skim the PEP titles and statuses; open the ones relevant to your scope),
`peps/PEP-059-1.0-readiness.md` (the code review's outcome and 1.0 task list), and the findings
in `peps/reviews/2026-10-deep-review/findings-*.md`. The code review already found and fixed 309
defects. Your job is different: assess the DESIGN, not individual bugs.

Think hard. This is a planning task.

## Your job

For YOUR SCOPE (given in your prompt), answer: is this the architecture typesugar should freeze
at 1.0, and if not, what should change before 1.0 versus after? Concretely:

- Map how it actually works today (from the code, not the docs): the components, the data that
  flows between them, who owns which state, and where the same responsibility is implemented more
  than once.
- Identify structural problems: duplicated pipelines or logic that has drifted or will drift,
  global/process-wide state that should be per-program or per-file, layering violations and
  dependency cycles, leaky or unstable abstractions exposed to users or macro authors, and
  designs whose failure modes keep producing the same class of bug (the code-review findings are
  evidence: cite clusters of findings that share a root cause).
- Separate what must be settled before 1.0 (anything that would force a breaking change later:
  public API shape, package boundaries, config format, the macro-author contract, emitted-code
  contracts) from what can safely change after.
- For each recommended change: the problem, the evidence (file:line, finding ids), the proposed
  design, the alternatives you rejected and why, its blast radius (which packages/users break),
  a size estimate (S/M/L/XL), and whether it blocks 1.0.
- Note where `docs/architecture.md` (or other design docs) describes something other than what
  the code does.
- Respect decisions already recorded in PEPs and PHILOSOPHY.md; if you think one is wrong, say so
  explicitly and argue it, rather than proposing around it silently.

Do not propose rewrites for their own sake. A recommendation needs a concrete cost it removes
(bugs, drift, user confusion, a 1.0 compatibility trap).

## Constraints (important)

- READ-ONLY. Do not edit any file in the repo. Do not commit.
- Do NOT run vitest, pnpm build, tsc on the project, or anything else heavy: the Mac is shared and
  another session has a ~4 GB job running. grep, git log/blame, reading files, and tiny `node -e`
  checks against built `packages/*/dist` (under ~300 MB) are fine.
- Scratch files, if any, go in
  `/private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/docrev/arch-<GROUP>/`.

## Output

Return as TEXT in your final message (you cannot write report files), structured so it can be
turned into a PEP:

1. **Current architecture**: a concise map of components and state ownership (an ASCII diagram is
   welcome), with file references.
2. **Assessment**: what is sound and should be frozen as-is (briefly, with reasons).
3. **Recommendations**: numbered, most important first, each with the fields listed above, and
   clearly tagged `BLOCKS 1.0` or `POST-1.0`.
4. **Decisions for Dean**: questions with real trade-offs only he can settle, with your
   recommended answer.
5. **Doc/code mismatches** in the design docs.
6. A 5-line summary.
