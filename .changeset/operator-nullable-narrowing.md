---
"@typesugar/transformer-core": patch
---

A typeclass comparison with a nullable operand compiled to
`c == null ? c === p : P.Eq.equals(c, p)`, which loses TypeScript's narrowing:
`if (c === p) return c.x;` was TS18048 in the expanded code, so
`typesugar build --strict` / `check --strict` failed on ordinary code. The
expansion is now `c === p || (c != null && P.Eq.equals(c, p))` (`!==`:
`c !== p && (c == null || P.Eq.notEquals(c, p))`), which TypeScript narrows
as it narrowed the original, with the same results; an ordering operator
(`<`, `<=`, `>`, `>=`) with a nullish operand is `false`. A property read
(`this.p === o`) is no longer moved into an arrow, so it narrows too.
