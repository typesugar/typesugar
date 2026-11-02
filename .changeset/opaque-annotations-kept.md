---
"@typesugar/core": patch
"@typesugar/transformer-core": patch
"@typesugar/transformer": patch
---

`@opaque` annotations are kept as written in every position, and expanded code is checked against
the runtime view of opaque types (`opaqueTypesAsUnderlying`: `Option<number>` is `number | null`).
Annotation stripping covered only a variable or parameter default initialized by an erased
constructor of a same-project type, so `function fo(o: Option<number>)` called as `fo(Some(2))`
(now `fo(2)`) and `const a: Option<number> = Some(3)` with fp's `Option` failed `strictOutput`, and
the declarations emitted from the expanded program lost the opaque type where it did strip.
`strictOutput` and `typesugar build --strict` serve every file in that view.
