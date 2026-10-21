---
"@typesugar/core": patch
"@typesugar/transformer-core": patch
---

`@derive` on something that is not an interface, class or type alias is error TS9102 at the tag,
with help that points at `derived<TC<T>>()` for a variable. A JSDoc `@derive` on a `const` used to
be ignored without a word, and one on a function only warned.
