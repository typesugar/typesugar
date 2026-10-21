---
"@typesugar/transformer": minor
---

`typesugar build` emits `.d.ts` files from the expanded program. TypeScript
computes declarations with the checker, and `build` used to hand it the
unexpanded source, so an exported function returning a fluent `match()` was
declared `: any` and pattern-bound names were undeclared. Now every file is
expanded first and the declarations describe the expanded code
(`area(shape: Shape): number`), importing nothing from typesugar. The program
the macros run against is built with declaration emit off, so it reports no
declaration errors about unexpanded types; `noEmitOnError` is decided on the
diagnostics `build` reports.

New flags: `typesugar build --emitDeclarationOnly` (only `.d.ts`, for projects
whose JavaScript comes from a bundler) and `--declarationDir <dir>`. The same
step is available as an API: `emitDeclarations({ project, declarationDir })`
from `@typesugar/transformer`.
