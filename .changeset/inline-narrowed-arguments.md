---
"@typesugar/macros": patch
"@typesugar/transformer-core": patch
---

An inlined instance-method call keeps its argument typed as the parameter. `destructureCons.extract(Nil)`
inlined as `(Nil != null ? [Nil.head, Nil.tail] : undefined)`, and with `Nil: null` the test narrowed
`Nil` to `never`, so `typesugar check --strict` reported `Nil.head`. An argument the checker finds
narrower than its parameter is now substituted as `(Nil as List<A>)`, the type fitted to the call
site like the body's other annotations. Erased: nothing changes at run time.
