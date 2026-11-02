---
"@typesugar/macros": patch
---

With `import type { Show } from "typesugar"` (which is `@typesugar/fp`'s
`Show`), `summon<Show<number>>()` and `implicit()` were TS9001: the search of
the typeclass's own package scanned its root exports, and fp exports its
instances only inside a namespace (`TC.ShowOps.showNumber`). That search now
also enters the package's namespace re-exports (by symbol, up to three deep)
when the root has no match, and imports the namespace (`TC`). The TS9001 help
for a primitive no longer says only `@typesugar/std`'s typeclasses come with
instances.
