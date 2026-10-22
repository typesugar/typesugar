---
"@typesugar/transformer": patch
---

A transform that runs out of stack ("Transform failed: RangeError: Maximum call stack size
exceeded") now says why and what to do: an expression nests too deeply, in practice a chain of
thousands of typeclass operators on objects (`a + a + ... + a`, each rewritten level rebuilt
around its left operand); split it into intermediate consts. A 200-term chain transforms fine.
