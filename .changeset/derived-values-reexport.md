---
"@typesugar/core": patch
"@typesugar/macros": patch
"@typesugar/std": patch
"@typesugar/transformer": patch
---

The values `@derive(Destructure)` declares (the constructor functions `Point`, `Circle` and their
instances) can be imported, called and re-exported by name before expansion. Checked as written,
the source reported `export { Circle } from "./shapes"` and `import { Circle }` as TS2305,
`Point(1, 2)` as TS2693 and `Circle(2)` in the deriving file as TS2304, so `emitDeclarations` (tsup's
`withTypesugar`) wrote nothing for an index file that re-exports them. A derive macro can now say
which names it declares (`generatedNames`), and the `DerivedDeclarationReference` suppression rule
accepts exactly those. `typesugar build` keeps those names in the JavaScript's imports and
re-exports, which TypeScript dropped as type-only.
