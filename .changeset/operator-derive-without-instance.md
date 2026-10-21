---
"@typesugar/transformer-core": patch
---

`a === b` (or another activated operator) on a type that declares
`@derive(Eq)` but has no instance, because its derive failed (a generic
`Box<T>`, which `@derive` doesn't support yet), is TS9001 at the operator, as
`summon<Eq<Box<number>>>()` is, instead of silently staying a reference
comparison.
