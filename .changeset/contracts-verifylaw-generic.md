---
"@typesugar/contracts": patch
---

`verifyLaw` accepts a typed law (`Law<[x: number]>` from `defineLaw`): it took `Law<unknown[]>`,
which a law with typed `check` parameters is not assignable to.
