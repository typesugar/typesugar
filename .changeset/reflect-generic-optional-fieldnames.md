---
"@typesugar/macros": patch
---

`typeInfo<Box<number>>()` reports an optional parameter written in terms of the type's parameter
instantiated: `set(v?: T)`'s `v` is `"number"`, not `"T"` (an optional field `label?: T` is
`"number"` too, without the `undefined` its optionality adds). `fieldNames<T>()` lists the fields
`typeInfo<T>().fields` lists, without the type's methods (`fieldNames<Box<number>>()` was
`["label", "value", "set", "get"]`). A method whose signature the type checker fails on is left out
of `typeInfo<T>().methods` with a warning naming it, instead of silently.
