---
"@typesugar/std": patch
---

A fluent `match()`'s discriminant switch no longer tests a field the tag guarantees. Inside `case
"circle":`, `if ("radius" in _s)` tested what the type already says (the circle variant requires
`radius`), so it was dead code in every arm. It is emitted only when the field is optional in that
variant, or when the tag doesn't pick out one variant (two variants share it, a variant's tag isn't
a literal, or the scrutinee isn't a discriminated union). The output is smaller, and an arm whose
fields are all required is the plain field read a hand-written switch has.
