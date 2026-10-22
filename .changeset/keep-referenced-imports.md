---
"@typesugar/transformer": patch
---

`typesugar build`, watch and ts-patch keep the imports the expanded code references: TypeScript
dropped `import { Point }` when the source used `Point` only as a type, so the emitted
`Point.Eq.equals(...)` (or an instance imported by name and used only through `summon`) was a
ReferenceError at run time.
