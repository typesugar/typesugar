# @typesugar/ts-plugin

## 0.1.2

### Patch Changes

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

- Updated dependencies [e3065ec]
- Updated dependencies [2d2ff92]
- Updated dependencies [a80b382]
- Updated dependencies [b98f015]
- Updated dependencies [3709f72]
- Updated dependencies [2543157]
- Updated dependencies [2f43c28]
- Updated dependencies [c5ebf64]
- Updated dependencies [291dc90]
- Updated dependencies [3ae83a6]
- Updated dependencies [4504b87]
- Updated dependencies [d8d3736]
- Updated dependencies [abb063e]
- Updated dependencies [ce9fd6d]
- Updated dependencies [f415cc2]
- Updated dependencies [80b45c7]
- Updated dependencies [86e239b]
- Updated dependencies [3da95a9]
- Updated dependencies [bb1720e]
- Updated dependencies [9dcc681]
- Updated dependencies [3ae83a6]
- Updated dependencies [eb6e5a8]
- Updated dependencies [34bdce1]
- Updated dependencies [6322cde]
- Updated dependencies [f905fba]
- Updated dependencies [914817e]
- Updated dependencies [2252df8]
- Updated dependencies [b676bbc]
- Updated dependencies [6f70351]
- Updated dependencies [111b43d]
- Updated dependencies [dade880]
- Updated dependencies [4f6ad83]
- Updated dependencies [b6a5211]
- Updated dependencies [d8f810b]
- Updated dependencies [63bf193]
- Updated dependencies [98adbea]
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
- Updated dependencies [e365b8d]
- Updated dependencies [e064ef7]
- Updated dependencies [cf7c08b]
- Updated dependencies [652d1c6]
- Updated dependencies [bf451af]
- Updated dependencies [0464551]
- Updated dependencies [8b6ed1a]
- Updated dependencies [2f89b77]
- Updated dependencies [858a07a]
- Updated dependencies [5214c09]
  - @typesugar/transformer@0.2.0

## 0.1.1

### Patch Changes

- e2cbd69: Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- First stable patch release. Fixes build crash, LSP server stability, Zed extension, and adds pipeline/position-mapper exports to transformer.
- Updated dependencies [e2cbd69]
- Updated dependencies
  - @typesugar/transformer@0.1.1

## 0.1.1-rc.0

### Patch Changes

- Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- Updated dependencies
  - @typesugar/transformer@0.1.1-rc.0
