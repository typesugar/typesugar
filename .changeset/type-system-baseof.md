---
"@typesugar/type-system": patch
---

`BaseOf<NonNegative>` is `number`: it inferred the whole `number & { brand }`, so `widen`'s
parameter demanded the target's brand and the documented `widen<NonNegative>(pos)` was a type
error.
