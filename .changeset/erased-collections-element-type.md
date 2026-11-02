---
"@typesugar/erased": patch
---

`mapErased` and `filterErased` keep the list's element type: on a `WithShow[]` the callback got a
bare `Erased<Capability[]>`, so the documented `mapErased(items, (e) => show(e))` was a type
error. They are generic over the element (`<E extends Erased<readonly Capability[]>>`), like
`sortErased` and `dedup`.
