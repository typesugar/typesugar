---
"@typesugar/macros": patch
---

`summon` and `implicit()` find a typeclass's own instances when the file
reaches the typeclass through a re-export: `import type { Ord, Eq } from
"typesugar"` names `@typesugar/std`'s `Ord`, and `summon<Ord<number>>()` was
TS9001 because the file doesn't import `@typesugar/std`, where `ordNumber`
is. The package that declares the typeclass is now searched last, as if the
file imported it, and the instance is imported from it. `implicit()` compares
the typeclass by identity too (a renamed import, `Eq as Equal`, works).

The TS9001 help no longer tells you to add `@derive(Eq)` to a primitive (it
says the instance has to come from a module) or to import a typeclass the
file already imports.
