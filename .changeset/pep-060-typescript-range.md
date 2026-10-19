---
"@typesugar/codec": patch
"@typesugar/collections": patch
"@typesugar/contracts": patch
"@typesugar/contracts-refined": patch
"@typesugar/core": patch
"@typesugar/derive": patch
"@typesugar/effect": patch
"@typesugar/erased": patch
"@typesugar/eslint-plugin": patch
"@typesugar/fp": patch
"@typesugar/fusion": patch
"@typesugar/graph": patch
"@typesugar/lsp-common": patch
"@typesugar/lsp-server": patch
"@typesugar/macros": patch
"@typesugar/mapper": patch
"@typesugar/math": patch
"@typesugar/parser": patch
"@typesugar/playground": patch
"@typesugar/reflect": patch
"@typesugar/sql": patch
"@typesugar/std": patch
"@typesugar/strings": patch
"@typesugar/testing": patch
"@typesugar/transformer": patch
"@typesugar/transformer-core": patch
"@typesugar/ts-plugin": patch
"@typesugar/type-system": patch
"@typesugar/typeclass": patch
"@typesugar/units": patch
"@typesugar/validate": patch
"typesugar": patch
"unplugin-typesugar": patch
---

PEP-060 item 1: support TypeScript 6, reject TypeScript 7 with one clear error

- **Peer range is now `typescript >=5.9.0 <7.0.0`** on every package (was
  `>=5.0.0 <6.0.0`). TypeScript 6.0.x still has the JavaScript compiler API typesugar
  is built on; TypeScript 7 (`typescript@latest` since 7.0) does not. The floor
  moved up from 5.0 because older releases were measured to break: before 5.5,
  Node's ESM loader sees none of TypeScript's named exports, so the CLI and the
  Vite plugin crash on their first `ts.*` access (5.0–5.3 also lack
  `checker.isTypeAssignableTo` and other APIs typesugar calls); 5.5–5.8 lack
  `checker.getNonPrimitiveType()`, so `@impl X<object>` instances never resolve.
  5.9.3 and 6.0.3 build, type-check and pass the core, transformer-core, macros,
  transformer, std and fp suites. The `library` and `macro-plugin` templates that
  `typesugar create` copies peer the same range, and all three templates now
  install `typescript ^5.9.3`.
- **`typescript` is now an optional peer** of the packages whose runtime `.` entry
  never loads it: codec, collections, contracts, erased, fp, fusion, mapper, parser,
  strings, testing, units, validate and the `typesugar` umbrella. Their `./macros`
  entries still need TypeScript at build time. `check:runtime-purity` now fails if a
  package with an optional peer loads `typescript` from its `.` entry, directly or
  through a dependency.
- **TypeScript version guard.** `@typesugar/core` exports `assertSupportedTypeScript`,
  `getUnsupportedTypeScriptReason`, `UnsupportedTypeScriptError`,
  `SUPPORTED_TYPESCRIPT_RANGE` and `TYPESCRIPT_SUPPORT_URL`. `@typesugar/macros` runs
  it first thing at load, and the transformer (pipeline, ts-patch factory, and the
  language-service plugin, which checks tsserver's own TypeScript), `transformCode`,
  unplugin, the LSP server and the ESLint processors call it before their first
  compiler-API access. On TypeScript 7 they all stop with
  `[typesugar] TypeScript 7.0.2 is not supported: TypeScript 7 removed the JavaScript
compiler API that typesugar's transformer needs. Install typescript@6 (or 5.9+) as a
devDependency for typesugar (npm i -D typescript@6); see
https://typesugar.org/getting-started/troubleshooting#typescript-7` instead of an
  opaque `Cannot read properties of undefined (reading 'ES2022')`. TypeScript older
  than 5.9, or a module missing `ts.factory` / `ts.createProgram`, is rejected the
  same way.
