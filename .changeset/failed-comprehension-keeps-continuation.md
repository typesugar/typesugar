---
"@typesugar/transformer-core": patch
---

A comprehension that fails to expand (for example `let: { a << 42; } yield: a + nope;`, where
`42` has no type constructor) keeps its `yield:` / `pure:` / `return:` continuation in the
output. The continuation used to be dropped, so the language service, which checks the expanded
text, never reported the errors in it (here, `Cannot find name 'nope'`) while `typesugar check`
did. A `const x = let` held for the merge goes back in its original place too.
