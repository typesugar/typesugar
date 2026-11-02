---
"@typesugar/macros": patch
"@typesugar/transformer-core": patch
---

More places that caught a type-checker failure and quietly degraded now say so with a warning:
`@impl`'s test for a type-level function (the type was silently treated as a data type), the check
of whether a `@derive` companion is assigned before a use above its declaration (the use was
silently taken as running first), the scan of an instance method's body before it is inlined (the
method was silently called through its instance), and the check of what is read before an inlined
call whose effects might be hoisted.
