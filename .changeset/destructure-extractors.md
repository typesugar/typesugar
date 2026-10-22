---
"@typesugar/std": minor
"@typesugar/macros": patch
---

Extractor patterns come from `Destructure` instances. `Name(...)` in a
pattern (fluent `match()` or a `match:` switch) resolves a
`Destructure<typeof Name, Input, Output>` instance by `Name`'s symbol, from the
current file, the modules it imports, or the module that declares `Name`. An
instance with a `@destructure` descriptor (`not-null -> self`,
`kind = "circle" -> r`, `always -> x, y`, ...) is inlined: the test and the
field reads, no call. Without one, its `extract` is called once and the result
destructured. A name with no instance is still an `instanceof` pattern.

**Breaking (internal):** `registerProductExtractor`, `registerCustomExtractor`
and `clearRegisteredExtractors` are removed (nothing outside tests used them);
declare a `Destructure` instance instead. `@impl` on a multi-parameter
typeclass no longer warns that it can't generate a companion.
