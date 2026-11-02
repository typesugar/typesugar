---
"@typesugar/transformer": patch
---

`@derive(Destructure)` works in a program that imports no typesugar package (a library whose source
only uses the built-in `@derive` tag). Its derive macro comes with `@typesugar/std`, whose macros were
loaded only when some file imported a typesugar package, so it was "Unknown derive: 'Destructure'".
They are now loaded for every program, as the other built-in derives are.
