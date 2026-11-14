---
"@typesugar/macros": minor
"@typesugar/transformer-core": minor
"@typesugar/fp": patch
"@typesugar/std": patch
---

Return-type-driven specialization matches Result types by declaration, not by
name (PEP-062 row 10). It used to take any type named `Result`, `Either` or
`Validation` as a source and rewrite any call named `ok`, `err`, `Result.ok` or
`R.ok` in its body, so a library's own `Result` (a class with static `ok`/`err`,
for example) was rewritten. A renamed import of the constructors
(`import { ok as succeed }`) was missed, and a union target such as fp's
`Either` (`Left | Right`) was never matched.

- `ResultAlgebra.targetTypes` is now a list of `DeclarationRef`s
  (`{ module, name }` or `{ global }`) instead of type names. fp's algebras target
  `@typesugar/fp`'s `Option` and `Either`, and std's targets the global `Promise`.
- New `registerResultSource`/`getResultSources` register the Result types
  that may be rewritten and their `ok`/`err` constructors. A Result type that
  isn't registered is never rewritten. typesugar registers none itself.
- `getResultAlgebra(typeName)` is replaced by `getResultAlgebras()`.
- transformer-core: `specializeForResultAlgebra` and `rewriteResultCalls` take
  the `ResultSource`, and `getTypeName` is removed.
