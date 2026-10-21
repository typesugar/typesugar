---
"@typesugar/macros": patch
"@typesugar/reflect": patch
---

`typeInfo<T>()` is typed as `TypeInfo`, the shape the macro emits: its runtime stub declared
`{ name; fields: { name; type }[] }`, so `info.kind` and `field.optional` were type errors. An
optional field's `type` is its declared type (`age?: number` is `"number"`, with
`optional: true`), as the guide shows, not the `"number | undefined"` the checker gives an optional
property under `strictNullChecks`; a field of a generic declaration (`value?: T`) still shows its
instantiated type. The reflect examples run again (`validator<T>()` returns
`{ success, value } | { success: false, errors }`).
