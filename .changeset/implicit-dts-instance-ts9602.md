---
"@typesugar/core": patch
"@typesugar/transformer-core": patch
---

A call that `= implicit()` completes with an instance from a package's `.d.ts` (std's `ordNumber`, a
library's `Point.Eq`) warns TS9602, as the same call with the instance written out already did: the
declaration has no method bodies, so the call keeps dictionary passing. It used to fall back without
a word, and the specialization guide said a specialized copy was made.
