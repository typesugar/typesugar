---
"@typesugar/fusion": patch
---

`vec([1, 2, 3])` is a `FusedVec<number>`, not a `FusedVec<1 | 2 | 3>`: the element type was
inferred from the literals, so the result of `add(v, v)` (a `FusedVec<number>`) could not be
assigned back to `v`. The element type is now `number` unless given explicitly
(`vec<Meters>(xs)`).
