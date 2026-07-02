---
"@typesugar/macros": minor
"@typesugar/std": patch
"@typesugar/effect": patch
"@typesugar/collections": patch
"@typesugar/validate": patch
---

PEP-053 Waves 4–5: the compiler's hard-coded builtin instance table is gone.
The ~28 static `registerInstanceMethods(...)` registrations (source-code-as-
strings copies of the fp/std/effect instances), the deprecated
`registerInstanceMethods` function, and the internal-registration machinery
are deleted from `@typesugar/macros`. Instance method bodies now come
exclusively from source extraction — the same rules for std/fp/effect
instances as for user instances, no builtin magic. The 16 primitive
intrinsics (`eqNumber` → `a === b`, …) and the per-program AST registry
(`registerInstanceMethodsFromAST`) remain. `eitherBifunctor` and
`flatMapStream` (registrations with no corresponding source instance) are
dropped. Residual `specialize()`-as-API comment mentions in std/effect/
collections/validate sources are rewritten for the always-on model.
