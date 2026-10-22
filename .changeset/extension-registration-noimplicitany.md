---
"@typesugar/macros": patch
---

A `"use extension"` file's self-registration calls type-check under `noImplicitAny`. They were
emitted as `globalThis.__typesugar_registerExtension?.(...)`, which is TS7017 where the hook is
declared nowhere, so `typesugar check --strict` reported every exported extension of
`@typesugar/std` and `@typesugar/graph`. They are now `(globalThis as any).__typesugar_registerExtension?.(...)`,
like the companion registry's calls.
