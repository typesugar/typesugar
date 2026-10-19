# Documentation review brief (typesugar, pre-1.0)

Repo: /Users/deapovey/src/personal/typesugar, branch `deep-review-1.0` (PR #80: 309 code fixes
from a deep review, not yet merged). Read `peps/PEP-059-1.0-readiness.md` first, especially its
breaking-change list: many documented behaviours changed on this branch, and docs that describe
the OLD behaviour are findings. Treat the code on this branch as the source of truth.

## Your job

Review YOUR SCOPE (given in your prompt) as a user would meet it. A doc defect is anything that
would make a reader write code that does not work, or believe something false:

- examples that do not compile, emit macro errors, emit type errors, or print something other
  than what the doc says;
- APIs, options, CLI flags, config keys, package names, import paths or exports that do not exist,
  were renamed, or behave differently from what the doc says (check against `packages/*/src` and
  each package's `package.json` `exports`);
- claims about behaviour that the code contradicts (zero-cost, "erased", "compile error", safety
  or security guarantees, performance numbers with no source);
- install/setup steps that would fail (wrong package, wrong plugin config, wrong tsconfig);
- broken internal links and anchors, pages that are unreachable from the VitePress sidebar
  (`docs/.vitepress/config.*`), and duplicate pages that disagree with each other;
- public API with no documentation at all (a 1.0 gap, not a defect);
- aspirational/plan/vision pages presented as if they describe shipped features.

Skip prose style, tone, typos that do not change meaning, and "could explain more".

## Checking examples

Use the helper, which runs an example through the real pipeline from the built `dist`:

    node /private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/docrev/doc-example.mjs <file.ts> [--run] [--under packages/<pkg>]

Put each extracted example in your own scratch dir
`/private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/docrev/<GROUP>/`.
It prints macro diagnostics, type errors in the generated output, the output, and with `--run`
the program's stdout/stderr. `@typesugar/*` packages not linked at the repo root (check
`ls node_modules/@typesugar`) need `--under packages/<that-pkg>` so imports resolve. Examples that
are deliberately partial (fragments, `...`) may need minimal scaffolding; add only what the doc
implies, and say so. An example that only works with scaffolding the doc does not mention is a
finding (low) if the reader could not guess it.

Check every non-trivial example in scope, not a sample; prioritise getting-started, the README
hero examples, and anything a guide presents as "copy this".

## Constraints (important)

- READ-ONLY on the repo. Do not edit, create or delete anything under the repo except the
  helper's own gitignored `.typesugar/doc-examples/` output. Do not commit.
- One helper run at a time (each is ~330 MB). Do NOT run vitest, pnpm build, docs:build, tsc on
  the project, or anything else heavy: the Mac is shared and another session has a ~4 GB job
  running.
- Verify every finding (run it, or quote the code that contradicts the doc). Precision over count.

## Output

Return your findings as TEXT in your final message (you cannot write report files). Format, most
severe first:

### <n>. <one-line title>

- Severity: high (reader's code breaks or they believe something dangerous/false) | medium |
  low
- Location: docs/path.md:line (and the contradicting code path:line if relevant)
- Problem: what the doc says vs what is true
- Evidence: helper output excerpt or code quote
- Suggested fix: the concrete replacement text or example

Then "## 1.0 gaps" (undocumented public API, missing pages, structural problems), one line each.
Then "## Examples checked": a table of page, example count, how many passed.
End with a 5-line summary: counts by severity and the top 3 problems.
