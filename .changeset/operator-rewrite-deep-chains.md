---
"@typesugar/transformer-core": patch
---

A long arithmetic chain (`1 + 1 + ... + 1`, 10,000 terms) took tens of minutes to
transform: the operator rewrite asked the type checker for each `+`'s left
operand, and the checker re-checks the whole subtree below a binary expression
every time it is asked (cubic overall). An operand that is itself an arithmetic,
bitwise or comparison expression is typed number, bigint, string, boolean or
`any` by TypeScript's rules, so it can't dispatch to an instance; it is now
skipped without the checker, and the right operand's type is only computed when
the left one can dispatch. The same line now takes well under a second.
