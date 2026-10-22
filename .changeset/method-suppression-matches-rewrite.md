---
"@typesugar/macros": patch
---

`typesugar build` hid a TS2339 that `typesugar check` reported, for a method
call the transformer then left as written (a TypeError at run time):
`import "@typesugar/std/syntax/eq"; const m: number = 7; m.equals(7)` with no
`Eq<number>` instance imported was suppressed because a built-in intrinsic
existed, and `p.equals(q)` on a `@derive(Eq)` type was suppressed in a file
that never activated Eq method syntax. The suppression now decides as the
rewrite does: method syntax active in the file (an activation import or the
typeclass defined there), and for a primitive receiver an instance resolved
from scope (literals widened by the checker).
