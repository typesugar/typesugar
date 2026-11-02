---
"@typesugar/sql": patch
"@typesugar/transformer": patch
---

The doc comments of sql's `Read`/`Write`/`Codec` derive macros, and the `macro-plugin` template's
`@example`, began a line with `@derive(...)` on a `const`, which is a real JSDoc tag there: it was
ignored before, and is now error TS9102. They name the derive in code text (or a fenced example)
instead.
