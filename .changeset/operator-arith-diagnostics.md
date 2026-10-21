---
"@typesugar/macros": patch
"@typesugar/transformer-core": patch
---

`typesugar check` and `typesugar build` no longer fail on a rewritten `*`, `/`, `-` (or `%`, `**`):
TypeScript reports `a * b` on two objects as TS2362/TS2363, which the OperatorOverload filter
(TS2365 only) never covered, so the operators guide's headline example (`a * b; a / b; a - b` on
rationals) exited 1 although the emitted `numericRational.mul(a, b)` is correct. Those are now
dropped exactly where the operator is rewritten, decided as the rewrite decides it (shared
`operator-chain-types`: both operands typed as rewritten, one instance from scope, a right operand
that fits). A new RewrittenOperatorResult filter drops the knock-on TS2345/TS2322 when a rewritten
operator's value (or an unannotated same-file `const` bound to one) is passed or assigned where its
rewritten type fits (`rationalToString(product)`). The rewrite also treats such a const as an
operand of its rewritten type: `const p = a * b; p + c` was left as JavaScript's `+`.
