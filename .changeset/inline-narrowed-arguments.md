---
"@typesugar/macros": patch
"@typesugar/transformer-core": patch
---

An inlined instance-method call no longer narrows its argument to `never`.
`destructureCons.extract(Nil)` inlined as `(Nil != null ? [Nil.head, Nil.tail] : undefined)`, and
with `Nil: null` the test narrowed `Nil` to `never`, so `typesugar check --strict` reported
`Nil.head`. A call whose argument the checker finds narrower than its parameter, and whose body
reads that parameter more than once, now goes through the instance; one that reads it once is
inlined as before.
