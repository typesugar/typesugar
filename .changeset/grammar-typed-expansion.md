---
"@typesugar/parser": patch
---

The parser the `grammar` macro generates type-checks under `strict`. Its functions' parameters were
untyped (TS7006 for every `input`, `pos`, `value`), `var best = null` made `best.pos` an error, and
`parse(input, pos)` required `pos`, so `typesugar check --strict` reported 75 errors in parser's own
tests. Its parameters, function results and `null`/`[]`-initialized variables are now explicitly
`any`, `parse`'s `pos` is optional, and the parser object keeps the type of its members. Erased:
nothing changes at run time.
