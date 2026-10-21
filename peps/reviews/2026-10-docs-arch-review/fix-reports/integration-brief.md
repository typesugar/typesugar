# Integration brief (round 2)

The code-fix brief applies in full (TDD, ownership, RAM rules, no git):
/private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/docrev/code-fix-brief.md

Seven fix groups landed on `docs-arch-1.0` (see `git log --oneline deep-review-1.0..HEAD`; the
per-group reports with their reasoning are in
/private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/fix2/reports/).
A full root vitest run afterwards gave 29 failing files (log:
.../scratchpad/fix2/full1.log; JSON: /Users/deapovey/src/personal/typesugar/.vitest-results/test-results.json
— that JSON will be overwritten by your own runs, so the log is the stable copy).

For each failing file assigned to you:

1. Reproduce it alone (`limit.sh npx vitest run <file>`).
2. Find the cause, with `git log -p deep-review-1.0..HEAD -- <path>` / blame. Decide which
   case it is:
   (a) a REGRESSION from one of the seven fixes → fix the code (the fix's own tests must still
   pass; if the two goals truly conflict, keep both behaviours correct and say how);
   (b) a test that pins OLD behaviour that a fix deliberately changed (check the fix report)
   → update the test to assert the new, correct behaviour (executing the output where
   possible), and say which fix changed it;
   (c) a LATENT bug the fixes exposed → fix it, failing test first (the existing failing test
   may already be that test).
   Never "fix" a failure by weakening a test to pass without understanding it, or by skipping it.
3. Report per file: case (a/b/c), cause, change, files.

Ownership here is by the files your prompt lists PLUS whatever code those failures lead you to,
EXCEPT files another integration agent owns (listed in your prompt). If you need a change in a
file another integration agent owns, describe it under Needs.
