# Fix brief (typesugar docs review → code fixes)

Repo: /Users/deapovey/src/personal/typesugar, branch `docs-arch-1.0` (PR #81, stacked on `deep-review-1.0`). Several fix agents work
IN THE SAME WORKING TREE at the same time, each owning a disjoint set of files. Read
/Users/deapovey/src/personal/typesugar/CLAUDE.md first — its three rules are binding (AST via
ts.factory, never new string codegen / regex rewriting; live same-pass registries; isSyntheticNode
before checker calls + visible warning when degrading). If you remove a parseStatements/
parseExpression exception, update the CLAUDE.md list; never add an unlisted call site.

## Method: failing test first, for every finding

For EACH finding assigned to you:

1. Write a test that reproduces it (prefer tests that EXECUTE generated code or call the real
   runtime, not tests that only grep output text). Put it in the package's existing test dir,
   following local conventions.
2. Run it and confirm it FAILS for the reason in the finding. If you cannot make it fail, the
   finding may be wrong: re-check, and if it is not a real bug, record it as "not reproduced"
   with your evidence and move on. Don't "fix" non-bugs.
3. Fix with the smallest correct change. Rebuild your package's dist if other packages/tests
   consume it (`pnpm --filter <pkg> build`).
4. Re-run the test (passes) and your package's related test files (no regressions).
   Findings marked as needing a product/design decision: implement the conservative option the
   finding suggests (e.g. "throw/diagnose instead of silently wrong", "remove broken export",
   "mark experimental") rather than a large redesign, and list the decision in your report.
   Fix the numbered findings; the "1.0 gaps" sections are NOT yours to implement unless your
   prompt says so (except trivial doc/comment corrections tied to a finding you fixed).

## File ownership — strict

Edit only the files/packages your prompt assigns. If a fix needs a change in a file you don't
own, don't make it: describe the exact change in your report under "Needs from other owners".
Tests you add go in your own package. Never run `git add`, `git commit`, `git stash`, `git
checkout`, `git reset` or anything that changes git state — the orchestrator commits.
Never revert or reformat code you didn't change (other agents are editing nearby). If a file you
own changes under you between Read and Edit, re-read it and re-apply.

## RAM rules (shared 24 GB Mac — important)

- MANDATORY: prefix EVERY vitest, build (pnpm build / tsup), and tsc command with the slot limiter
  `/private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/limit.sh`,
  e.g. `.../limit.sh npx vitest run packages/fp/tests/io.test.ts`. It waits for a free slot (only
  2 such jobs run machine-wide across all agents). Give those Bash calls `timeout: 600000` since
  queueing can take minutes. Small `node -e` checks don't need it.
- Run ONE test command at a time, in the foreground, scoped to a single test file or a small set:
  `npx vitest run <path/to/file.test.ts>` (from repo root). Never run the full root suite, never
  `pnpm test` at root, never `--reporter` watch modes, never two vitest processes at once.
- Builds: only `pnpm --filter <your-package> build` (or `cd packages/x && pnpm build`). No
  workspace-wide `pnpm build`, no `tsc -b` of the whole repo.
- Typecheck your package only: `cd packages/<pkg> && npx tsc --noEmit -p .` (if it has a tsconfig).
- Scratch files go in /private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/fix/<your-group>/
- Before finishing, make sure no process you started is still running.

## Finishing

Run `npx prettier --write <files you changed>`. Then your final message (this is your report —
you cannot write a report file) must contain:

- Per finding: ID — fixed | not reproduced | partially fixed | deferred — test file:name — 1 line.
- Decisions you made that Dean should know about.
- "Needs from other owners": exact cross-file changes you couldn't make.
- Files changed (list).
- Anything left failing, with output.

## This round

The findings come from the docs-REWRITE agents, logged in /private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/fix2/needs.md and in their reports /private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/docfix/report-_.md (read the relevant report entries for repros). Background: running documentation examples through the real
pipeline exposed code bugs. Reports: /Users/deapovey/src/personal/typesugar/peps/reviews/2026-10-docs-arch-review/docs-_.md
(your prompt names the finding numbers). Each report entry has the failing example and evidence.
The test you write first should be the doc example itself (minimised), executed: transform it
and run the output, asserting the result the doc promises.
After fixing, REBUILD your package's dist (`limit.sh pnpm --filter <pkg> build`): a docs agent
will re-run the doc examples against dist afterwards. You can re-check an example with
`node /private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/docrev/doc-example.mjs <file.ts> --run`.
DOCS: the docs were just rewritten to describe current behaviour, including these bugs as "known issue" / "not yet supported" notes. After fixing a bug, grep docs/ and packages/\*/README.md for the sentence(s) describing it and update ONLY those sentences/examples (re-run any example you change through the helper). Report, per finding,
the behaviour the docs should now describe.
Scratch dir: /private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/fix3/<your-group>/
