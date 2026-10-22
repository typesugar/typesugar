---
"@typesugar/core": patch
"@typesugar/macros": patch
"@typesugar/transformer-core": patch
---

An `@impl` instance's method is inlined into another module only where every name its body uses
resolves there to the same declaration. `ordNumber.eqv(NaN, NaN)` in a file that imports only
`ordNumber` compiled to `compareNumber(NaN, NaN) === EQ`, a ReferenceError at run time, because
`@impl` registered its methods without the symbols their names resolve to and the call site
accepted any name that resolved to nothing. Such a call now goes through the instance and warns
TS9602 naming the identifier. A type name in an inlined body that doesn't resolve to the same type
at the call site is written through an import type, or, when it can't be named there (the method's
own type parameter), the call goes through the instance, so the expansion type-checks under
`typesugar check --strict`.
