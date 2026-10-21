---
"@typesugar/transformer-core": patch
---

Typeclass method syntax works on a literal receiver: `(7).show()`, `const n = 3; n.show()`,
`"a".show()` and `true.show()` were left as plain method calls (a run-time "is not a function")
because the checker types them as the literal types `7`, `3`, `"a"`, `true`, which no
`@impl Show<number>` is declared for. When no instance matches the literal type, the instance is
now looked up for its base type (`number`, `string`, `boolean`), widened by the checker. The
prefix-unary operator rewrite now decides that an operand is primitive by its type flags, as the
binary form does.
