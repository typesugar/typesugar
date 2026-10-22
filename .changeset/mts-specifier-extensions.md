---
"@typesugar/core": patch
"@typesugar/transformer-core": patch
---

A type or `@opaque` companion declared in a `.mts`/`.cts` file is named with the extension
TypeScript's module resolution expects: `.mjs`/`.cjs` (or the file's own `.mts`/`.cts` where
the project writes TypeScript extensions, `allowImportingTsExtensions` /
`rewriteRelativeImportExtensions`), not `.js`. `typeToPortableTypeNode` wrote
`import("./lib/shapes.js").Shape` for a type in `shapes.mts` -- TS2307 under `--strict`, an
`any` read inside a fluent `match()` that asserts its scrutinee to it, and a wrong inferred
`@opaque` annotation in emitted declarations -- and an erased `@opaque` method call imported its
companion function from `./opt.js` for an `opt.mts`, which fails at run time. Both use
`sourceSpecifierExtension` (exported from `@typesugar/core`). An extensionless (bundler)
import of a `.mts`/`.cts` file gets its `.mjs`/`.cjs` extension, which extensionless
resolution needs.
