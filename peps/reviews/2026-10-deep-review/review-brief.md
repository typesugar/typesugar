# Deep code review brief (typesugar, pre-1.0)

Repo: /Users/deapovey/src/personal/typesugar (branch deep-review-1.0, off origin/main).
typesugar is a compile-time macro system for TypeScript (TS transformer + unplugin + LSP/IDE
tooling + a set of runtime libraries). Read /Users/deapovey/src/personal/typesugar/CLAUDE.md
first: its three rules (AST over string codegen with an EXHAUSTIVE exception list; live same-pass
registries for things a macro just generated; isSyntheticNode before checker calls on possibly
synthetic nodes, with a visible warning when degrading) are review criteria in their own right.

## Your job

Do a deep, line-by-line review of YOUR SCOPE (given in your prompt) looking for real defects
that would hurt a 1.0 release:

- correctness bugs (wrong output, wrong codegen, crashes, unhandled edge cases, off-by-one,
  wrong precedence/parenthesization in generated code, hygiene/name capture, async misuse)
- robustness: swallowed exceptions with no visible trace, unbounded caches/leaks, global
  mutable state that breaks across files/watch mode/multiple programs, path handling that
  breaks on Windows or with symlinks, non-determinism
- public API problems: exports that throw "not implemented" at runtime, documented features
  that don't exist, type signatures that lie, runtime stubs that silently do the wrong thing
- security: config/macro-package loading, eval/Function, path traversal, shell injection
- CLAUDE.md rule violations (an unlisted parseStatements/parseExpression call site is a bug)
- test gaps ONLY where they hide a likely bug (do not list "could use more tests" generically)

Skip style nits, naming preferences, and speculative "might be nice" refactors.

## Constraints (important)

- READ-ONLY. Do not edit any file in the repo. Do not commit.
- Do NOT run vitest, pnpm build, tsc on the whole project, or anything else heavy: this Mac is
  shared and RAM-constrained. You MAY run small checks under ~300 MB: `node -e` / tiny scripts
  against already-built `packages/*/dist`, grep, git log/blame. Put any scratch files in
  /private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/review/
- Verify each finding before reporting it: re-read the code path, check callers, check whether a
  test already covers the case, and try a tiny repro against dist when cheap. Drop anything you
  cannot substantiate. Precision matters more than count.

## Output

Write your findings to
/private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/review/findings-<GROUP>.md
with one section per finding, most severe first:

### <n>. <one-line title>

- Severity: critical | high | medium | low
- Confidence: confirmed (repro'd) | high | medium
- Location: path:line
- Problem: what is wrong, concretely
- Failure scenario: concrete input/state -> wrong output/crash
- Suggested fix: specific, minimal
- Fix size: S | M | L

Then a final section "## 1.0 gaps" listing non-bug things in your scope that block a credible 1.0
(stubbed/unfinished features, missing docs for public API, unstable APIs that should be marked
experimental, etc.), each one line.

Your final message: the path to your findings file plus a 5-line summary (counts by severity and
the top 3 issues).
