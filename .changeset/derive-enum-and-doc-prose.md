---
"@typesugar/transformer-core": patch
"@typesugar/core": patch
---

`/** @derive(Eq) */` on an `enum` was silently ignored; it is now TS9102, like
`@derive` on a `const` or a function (another macro tag on an enum warns that it
was ignored).

Documentation that mentions `@derive` no longer trips TS9102: on a declaration
`@derive` can't apply to (a derive macro's own `const`), a `@derive(X)` line
followed by prose (`@derive(Read) — derives a Read instance`) is documentation,
and a macro tag after an `@example` tag (`@example` then `@derive(Validation)` on
its own line) is example code, like one in a fenced example. A bare
`@derive(Eq)` line on a `const` is still TS9102.
