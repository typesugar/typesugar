---
"@typesugar/core": patch
---

A real `@derive`/`@impl`/`@opaque`/`@typeclass` tag written after an
`@example` section was silently ignored on any declaration: every tag after
`@example` was treated as example code, so `/** A point. @example const p =
…; @derive(Eq) */ interface Point` got no companion (a ReferenceError at run
time), and a `@typeclass` or `@hkt` below a fenced `@example` registered
nothing. As in JSDoc itself, an `@example` now ends at the next line-start
tag; only a line inside a ```fence is example code. Fence example code that
shows a`@derive` line.
