---
"unplugin-typesugar": minor
"typesugar": minor
"@typesugar/transformer": patch
---

`withTypesugar()` for tsup (`unplugin-typesugar/tsup`, also `typesugar/tsup`):
wraps a tsup config, adds typesugar's esbuild plugin, and makes `dts: true`
work on macro code. tsup's own `dts` step type-checks the unexpanded source,
so a fluent `match()` with binding patterns failed it with TS2304. The helper
emits the declarations from the expanded program into `.tsup/typesugar-dts/`
and points tsup's `dts` step at them, so tsup still bundles and names them
(`index.d.ts`, `index.d.cts`). In watch mode they are re-emitted after each
rebuild. `emitDeclarations()` now also returns `declarationsBySource`.
