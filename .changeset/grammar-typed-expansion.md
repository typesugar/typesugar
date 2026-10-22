---
"@typesugar/parser": patch
---

The parser the `grammar` macro generates type-checks under `strict`. Its functions' parameters were
untyped (TS7006 for every `input`, `pos`, `value`), `var best = null` made `best.pos` an error, and
`parse(input, pos)` required `pos`, so `typesugar check --strict` reported 75 errors in parser's own
tests. Its internal parameters, function results and `null`/`[]`-initialized variables are now
explicitly `any`, `parse`'s `pos` is optional, and the parser object is asserted to the runtime
tag's type, `Grammar<unknown>`, so ``export const g = grammar`...` `` declares
`g: Grammar<unknown>` and `g.parse(...)` is a `ParseResult`, as without the transformer, rather
than an object of `any` members. Erased: nothing changes at run time.
