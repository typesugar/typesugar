---
"@typesugar/transformer-core": patch
---

A typeclass operator whose left operand had no instance borrowed the right
operand's declared type without checking the left: `a === b` with `a: Foo`
and `b: Bar` (Bar derives Eq) compiled to `Bar.Eq.equals(a, b)`. An operand's
declared type is now tried only when both operands are assignable to it, so
that comparison stays native.
