---
"@typesugar/transformer-core": patch
---

No runtime import of a typeclass marker left behind by `summon`

`import { summon, Clone } from "typesugar"; summon<Clone<P>>()` expands to an
instance literal, but only `summon` was removed from the import. tsc and
esbuild elide the unused `Clone`, except under `verbatimModuleSyntax`, where the
emitted JS kept `import { Clone } from "typesugar"`: a runtime dependency on
the macro package. A non-macro specifier in an import that also brought in a
macro is now removed when the file used it and the expanded code no longer does
(as a value or a type). A specifier the file never used is left alone.
