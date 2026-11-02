---
"@typesugar/macros": patch
---

`typeInfo<T>()` drops the `undefined` an optional field or parameter's optionality adds from any
union, not only when one other type is left: `typeInfo<Box<boolean>>()` reported `label?: T` as
`"boolean | undefined"` and `Box<string | number>`'s as `"string | number | undefined"`, where the
non-generic forms are `"boolean"` and `"string | number"`. An `undefined` the declaration writes
itself (`maybe?: T | undefined`) is kept.
