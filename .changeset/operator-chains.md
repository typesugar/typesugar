---
"@typesugar/macros": patch
"@typesugar/transformer-core": patch
---

Chained typeclass operators are rewritten: `a + b + c` on rationals compiled
to `numericRational.add(a, b) + c`, a string concatenation
(`"[object Object]..."`), because TypeScript types `a + b` on objects as an
error and the outer `+` saw no instance. An operator whose method returns the
typeclass's own type parameter (`add(a: A, b: A): A`, recorded in the op
index as `resultIsSelf`) now gives its expression that type, so
`a + b + c` is `add(add(a, b), c)` and `a + b < c` is
`lessThan(add(a, b), c)`. A method returning anything else ends the chain. Either operand can be such an expression,
so `a + b * c` is `add(a, mul(b, c))` and `a - (b - c)` is `sub(a, sub(b, c))` (the right operand
was typed by TypeScript, `number`, and reported as "right operand must also be"), and the chain is
typed with an explicit stack, not recursion, whichever way it nests.
