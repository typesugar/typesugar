---
"@typesugar/testing": patch
---

`forAll(...)`'s expansion keeps its arguments' contextual types. It bound the generator, count and
property to consts, so an unannotated parameter (`forAll((seed) => seed * 2, (value) => …)`) lost
the type `forAll`'s signature gave it, and `typesugar check --strict` reported TS7006 for each. The
arguments are now passed to a generic function typed like `forAll`'s own signature; each is still
evaluated once, in order.
