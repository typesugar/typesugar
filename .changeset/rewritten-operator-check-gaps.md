---
"@typesugar/core": minor
"@typesugar/macros": patch
---

`typesugar check` no longer hides real errors next to a rewritten operator. A
`DiagnosticSuppressionRule` can now report `replacementDiagnostics` in place of a diagnostic it
suppresses (identical ones are reported once; if computing them throws, the original is kept).
`RewrittenOperatorResult` uses it to re-check the arguments after a rewritten `a * b`, since tsc
reports only a call's first failing argument: `g(a * b, 5)` with a `string` parameter is now
an error at `5`. `OperatorOverload` uses it to report a rewritten value used as a number, which
TypeScript (typing `a * b` as `number`) accepts and which threw at run time:
`(a * b).toFixed(2)` (TS2339), `const n: number = a * b` (TS2322, also for `+`), a `number`
argument (TS2345), and `a * b > 0` when `>` isn't rewritten (TS2365).
