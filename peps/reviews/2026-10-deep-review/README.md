# 2026-10 deep code review (pre-1.0)

Nine read-only reviewers covered every package on 2026-10-18/19 (branch `deep-review-1.0`).
`review-brief.md` is what they were asked; `findings-*.md` is what they found (309 findings),
each with location, failure scenario and suggested fix. `fix-brief.md` is the TDD brief the
fix agents worked from (failing test first, per finding). `repros/` holds the reviewers'
throwaway reproduction scripts (they reference built `packages/*/dist` and absolute scratch
paths, so treat them as notes rather than runnable tests — the real regression tests live in
each package's test directory).

The fix status of each finding and the 1.0 task list are tracked in
[PEP-059](../../PEP-059-1.0-readiness.md).
