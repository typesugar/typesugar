---
"@typesugar/transformer": patch
---

The bundler plugins' TypeScript-to-JavaScript step no longer passes the project's
`compilerOptions.plugins` to TypeScript. With ts-patch installed, TypeScript applies each
`{ "transform": ... }` entry in `transpileModule` too, so a tsconfig that lists
`@typesugar/transformer` for `tspc` had its already expanded code expanded again: a
`/** @typeclass */` interface got its companion twice, and esbuild/tsup failed with "Multiple
exports with the same name".
