# @typesugar/type-system

## 0.1.2

### Patch Changes

- d7d6236: The `Kind` documentation no longer says a preprocessor resolves `Kind<OptionF, number>` to
  `Option<number>`: that resolution was removed with the preprocessor in PEP-047, and `Kind<F, A>`
  is the uncomputed phantom marker. `Apply<F, A>` computes the concrete type, and `@impl` expands an
  instance's own signatures. type-system's examples run again (the showcase asserts with `Apply`;
  the phantom-types example uses the current `createStateMachine` config API).
- c30101d: `packExists(w)` expands to a value typed like the runtime function's. The expansion
  `(w => ({ use: f => f(w) }))(…)` had no `__exists_brand__`, so returning it where an `Exists<W>` is
  expected was TS2741 under `typesugar check --strict` (three times in `existential.ts`), and its
  `f` was implicitly `any` where nothing typed it. `use` is now `<R>(f: (witness: typeof w) => R): R`,
  and the whole is asserted to the call's own type when that type has a name at the call site. Both
  are erased: nothing changes at run time.
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

- 5d86014: `BaseOf<NonNegative>` is `number`: it inferred the whole `number & { brand }`, so `widen`'s
  parameter demanded the target's brand and the documented `widen<NonNegative>(pos)` was a type
  error.
- Updated dependencies [e92220f]
- Updated dependencies [612112b]
- Updated dependencies [de93aa3]
- Updated dependencies [e3065ec]
- Updated dependencies [4d4ce68]
- Updated dependencies [f8dcade]
- Updated dependencies [3709f72]
- Updated dependencies [2543157]
- Updated dependencies [c5ebf64]
- Updated dependencies [d79d995]
- Updated dependencies [0b5bcf8]
- Updated dependencies [a070a0c]
- Updated dependencies [01a547c]
- Updated dependencies [d3243f9]
- Updated dependencies [2694138]
- Updated dependencies [3ae83a6]
- Updated dependencies [7d84596]
- Updated dependencies [3460709]
- Updated dependencies [810833a]
- Updated dependencies [0435dc6]
- Updated dependencies [8b4060d]
- Updated dependencies [a6584d7]
- Updated dependencies [c9a1e3e]
- Updated dependencies [4b0d84d]
- Updated dependencies [977888e]
- Updated dependencies [283fe78]
- Updated dependencies [eb6e5a8]
- Updated dependencies [0780883]
- Updated dependencies [2252df8]
- Updated dependencies [851809b]
- Updated dependencies [8b0526f]
- Updated dependencies [6f70351]
- Updated dependencies [a591082]
- Updated dependencies [2b2fda8]
- Updated dependencies [4f6ad83]
- Updated dependencies [d8f810b]
- Updated dependencies [63bf193]
- Updated dependencies [98adbea]
- Updated dependencies [563e46b]
- Updated dependencies [053978c]
- Updated dependencies [8aaf40f]
- Updated dependencies [c56886c]
- Updated dependencies [ab72bde]
- Updated dependencies [a252187]
- Updated dependencies [93ea406]
- Updated dependencies [51a72ca]
- Updated dependencies [cf7c08b]
- Updated dependencies [2f1744b]
  - @typesugar/core@0.2.0

## 0.1.1

### Patch Changes

- e2cbd69: Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- First stable patch release. Fixes build crash, LSP server stability, Zed extension, and adds pipeline/position-mapper exports to transformer.
- Updated dependencies [e2cbd69]
- Updated dependencies
  - @typesugar/core@0.1.1

## 0.1.1-rc.0

### Patch Changes

- Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- Updated dependencies
  - @typesugar/core@0.1.1-rc.0
