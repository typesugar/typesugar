---
"typesugar": minor
"@typesugar/macros": minor
"@typesugar/transformer": minor
"@typesugar/transformer-core": minor
"@typesugar/core": patch
---

PEP-053 Wave 1: specialization is now an always-on compiler optimization, not
an API.

- REMOVED: the `specialize()`, `specialize$()`, `mono()`, and `inlineCall()`
  macros and runtime stubs, the `fn.specialize(dict)` extension-method rewrite,
  and the `@typesugar/specialize` package (including the `Specialized<F, N>`
  type). Calls that pass a known typeclass instance auto-specialize — no
  annotation needed; use `// @no-specialize` to opt a call out.
- REMOVED: `createSpecializedFunction`, `canFlattenToExpression`, and the
  `SpecializeOptions` type from `@typesugar/macros` (dead once the explicit
  surface was gone), and the TS9601/TS9221 diagnostics.
- FIXED: `// @no-specialize-warn` previously disabled specialization entirely
  (substring collision with `// @no-specialize`); it now only suppresses the
  TS9602 skip warning. Both markers now also work on a comment line
  immediately above the call, matching the documented form.
