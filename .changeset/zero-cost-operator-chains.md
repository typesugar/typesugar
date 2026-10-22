---
"@typesugar/macros": patch
"@typesugar/transformer-core": patch
---

A chain of inlined typeclass operators (`a + b + c + d` on a product type) is one expression:
`({ x: ((a.x + b.x) + c.x) + d.x, y: ... })`. Beyond the first level, each level used to be applied
as an IIFE over the previous level's object (`((a, b) => ({ ... }))(({ ... }), c)`), because the
inliner can't substitute an object literal its body reads twice. It now reads each property's
initializer where the body reads `p.x`. A value read more than once (a rational's denominator)
or an operand with side effects is bound to a `const` just before the statement when the chain
is evaluated first in it; elsewhere that level stays a function call. Operands are still
evaluated once, in order.
