---
"@typesugar/transformer-core": patch
---

Typeclass comparison operators are safe on nullable operands and find a
narrowed union's instance:

- `c === p` with `c: P | undefined` compiled to `P.Eq.equals(c, p)`, which
  threw when `c` was `undefined`. A comparison (`===`, `!==`, `==`, `!=`, `<`,
  `<=`, `>`, `>=`) with an operand whose type admits `null`/`undefined` now
  gives the native result when that operand is nullish:
  `c == null ? c === p : P.Eq.equals(c, p)`. Operands are evaluated once (a
  call or property read goes through an arrow's parameters). Non-null operands
  still compile to the plain call. Nullability is read from the checker, so
  this needs `strictNullChecks`.
- `s1 === s2` where `s1: Shape` (a derived union) was assigned one variant
  stayed a reference comparison, with no diagnostic: the checker narrows `s1`
  to that variant, which has no instance. The operands' declared types (by
  symbol) are now tried after the narrowed type, for the rewrite and for TS9804.
