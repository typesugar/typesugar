---
"@typesugar/transformer": patch
---

`typesugar create library` builds with `withTypesugar()` from `typesugar/tsup`, so `dts: true`
emits declarations from the expanded program (the derived companions included), and its Vitest
config adds the typesugar plugin so the tests run expanded code. The template's source uses the
current syntax (`/** @typeclass */`, `/** @impl ... */`, `= implicit()`; `@instance` on a `const`
is an error), its `typecheck` script is `typesugar check`, and it depends on `typesugar` 0.2.
