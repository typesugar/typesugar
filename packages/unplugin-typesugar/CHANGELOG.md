# unplugin-typesugar

## 0.2.0

### Minor Changes

- 8b6ed1a: `withTypesugar()` for tsup (`unplugin-typesugar/tsup`, also `typesugar/tsup`):
  wraps a tsup config, adds typesugar's esbuild plugin, and makes `dts: true`
  work on macro code. tsup's own `dts` step type-checks the unexpanded source,
  so a fluent `match()` with binding patterns failed it with TS2304. The helper
  emits the declarations from the expanded program into `.tsup/typesugar-dts/`
  and points tsup's `dts` step at them, so tsup still bundles and names them
  (`index.d.ts`, `index.d.cts`). In watch mode they are re-emitted after each
  rebuild. `emitDeclarations()` now also returns `declarationsBySource`.

### Patch Changes

- f905fba: A macro error reported by the Node loader (`node --import typesugar/register`) or a bundler plugin
  reads `file:line:col: [typesugar] [TS9209] ...`, not `[typesugar] [typesugar] [TS9209] ...`.
- b6a5211: PEP-047: Remove the `@typesugar/preprocessor` package

  The lexical preprocessor is gone. HKT type-syntax (`F<A>` → `Kind<F, A>`) is now
  handled solely by the AST-based rewriter in `@typesugar/transformer`
  (`rewriteHKTTypeReferences`), which the type-checker path already used.
  - **`@typesugar/playground`** (breaking): the `preprocess` / `preprocessOnly` /
    `preprocessCode` exports were removed. Use `transform()` — macro expansion runs
    the HKT rewrite internally.
  - **`@typesugar/transformer`**: CLI build/run/preprocess now call the AST
    rewriter; `RawSourceMap` is imported from `@typesugar/core`.
  - **`@typesugar/eslint-plugin`**: the processor uses the AST rewriter instead of
    the preprocessor.
  - **`@typesugar/lsp-server`, `unplugin-typesugar`**: dropped the unused
    `@typesugar/preprocessor` dependency.
  - **Behavior drop:** the preprocessor's `Kind<TypeF, A>` → concrete `Type<A>`
    resolution is removed (it was unused on the `.ts` path); `Kind<…>` relies on
    the `Kind` type's own instantiation, as the type-checker path already did.

- ab72bde: PEP-058 Wave 1: declare `engines.node >=20` on all published packages and enable npm provenance attestations in the release pipeline.
- 93ea406: PEP-060 item 1: support TypeScript 6, reject TypeScript 7 with one clear error
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

- Updated dependencies [de93aa3]
- Updated dependencies [e3065ec]
- Updated dependencies [2d2ff92]
- Updated dependencies [a80b382]
- Updated dependencies [4d4ce68]
- Updated dependencies [b98f015]
- Updated dependencies [f8dcade]
- Updated dependencies [3709f72]
- Updated dependencies [2543157]
- Updated dependencies [2f43c28]
- Updated dependencies [c5ebf64]
- Updated dependencies [d79d995]
- Updated dependencies [0b5bcf8]
- Updated dependencies [a070a0c]
- Updated dependencies [01a547c]
- Updated dependencies [291dc90]
- Updated dependencies [d3243f9]
- Updated dependencies [2694138]
- Updated dependencies [3ae83a6]
- Updated dependencies [4504b87]
- Updated dependencies [d8d3736]
- Updated dependencies [7d84596]
- Updated dependencies [abb063e]
- Updated dependencies [ce9fd6d]
- Updated dependencies [f415cc2]
- Updated dependencies [3460709]
- Updated dependencies [80b45c7]
- Updated dependencies [86e239b]
- Updated dependencies [0435dc6]
- Updated dependencies [3da95a9]
- Updated dependencies [8b4060d]
- Updated dependencies [a6584d7]
- Updated dependencies [c9a1e3e]
- Updated dependencies [bb1720e]
- Updated dependencies [9dcc681]
- Updated dependencies [4b0d84d]
- Updated dependencies [977888e]
- Updated dependencies [283fe78]
- Updated dependencies [3ae83a6]
- Updated dependencies [eb6e5a8]
- Updated dependencies [34bdce1]
- Updated dependencies [6322cde]
- Updated dependencies [f905fba]
- Updated dependencies [0780883]
- Updated dependencies [914817e]
- Updated dependencies [2252df8]
- Updated dependencies [851809b]
- Updated dependencies [8b0526f]
- Updated dependencies [b676bbc]
- Updated dependencies [6f70351]
- Updated dependencies [111b43d]
- Updated dependencies [dade880]
- Updated dependencies [a591082]
- Updated dependencies [2b2fda8]
- Updated dependencies [4f6ad83]
- Updated dependencies [b6a5211]
- Updated dependencies [d8f810b]
- Updated dependencies [63bf193]
- Updated dependencies [98adbea]
- Updated dependencies [563e46b]
- Updated dependencies [e274769]
- Updated dependencies [053978c]
- Updated dependencies [8aaf40f]
- Updated dependencies [855eb1f]
- Updated dependencies [c56886c]
- Updated dependencies [ab72bde]
- Updated dependencies [4b78011]
- Updated dependencies [a252187]
- Updated dependencies [076e677]
- Updated dependencies [33fee99]
- Updated dependencies [56e1acf]
- Updated dependencies [8587de8]
- Updated dependencies [93ea406]
- Updated dependencies [a266074]
- Updated dependencies [8acbcc4]
- Updated dependencies [51a72ca]
- Updated dependencies [e365b8d]
- Updated dependencies [e064ef7]
- Updated dependencies [cf7c08b]
- Updated dependencies [652d1c6]
- Updated dependencies [bf451af]
- Updated dependencies [2f1744b]
- Updated dependencies [0464551]
- Updated dependencies [8b6ed1a]
- Updated dependencies [2f89b77]
- Updated dependencies [858a07a]
- Updated dependencies [5214c09]
  - @typesugar/core@0.2.0
  - @typesugar/transformer@0.2.0

## 0.1.1

### Patch Changes

- e2cbd69: Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- First stable patch release. Fixes build crash, LSP server stability, Zed extension, and adds pipeline/position-mapper exports to transformer.
- Updated dependencies [e2cbd69]
- Updated dependencies
  - @typesugar/core@0.1.1
  - @typesugar/transformer@0.1.1
  - @typesugar/preprocessor@0.1.1

## 0.1.1-rc.0

### Patch Changes

- Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- Updated dependencies
  - @typesugar/core@0.1.1-rc.0
  - @typesugar/transformer@0.1.1-rc.0
  - @typesugar/preprocessor@0.1.1-rc.0
