---
"@typesugar/type-system": patch
"@typesugar/fp": patch
---

The `Kind` documentation no longer says a preprocessor resolves `Kind<OptionF, number>` to
`Option<number>`: that resolution was removed with the preprocessor in PEP-047, and `Kind<F, A>`
is the uncomputed phantom marker. `Apply<F, A>` computes the concrete type, and `@impl` expands an
instance's own signatures. type-system's examples run again (the showcase asserts with `Apply`;
the phantom-types example uses the current `createStateMachine` config API).
