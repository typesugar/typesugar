# @typesugar/playground

## 0.2.0

### Minor Changes

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

### Patch Changes

- 563e46b: PEP-052 Wave 6: resolution-free operator/method syntax-marker fallback,
  closing the gap for hosts (the browser playground) that cannot resolve
  modules via the checker.
  - NEW: `@typesugar/core` exports `registerSyntaxMarkerFallback`/
    `getSyntaxMarkerFallback` — a small, provider-declared registry that lets a
    package register "this exact import specifier activates operator/method
    syntax for typeclass X" without needing real module resolution.
    `scanImportsForScope` consults it as a purely additive fallback alongside
    the existing checker-based marker discovery.
  - NEW: `@typesugar/std` registers all 21 of its syntax markers (13 method +
    8 operator) via this mechanism from its `./macros` entry; `@typesugar/fp`
    registers its one marker (`@typesugar/fp/syntax/show`) from its root `.`
    entry (fp has no separate `./macros` compile-time entry).
  - FIXED: `@typesugar/playground`'s `transform()` — the actual in-memory host
    this wave exists for — never loaded std's or fp's compile-time
    registrations at all (both were only imported for runtime values via a
    separate iframe-sandbox bundle). A playground snippet importing e.g.
    `@typesugar/std/syntax/eq/ops` could not activate Eq operator syntax.
    Fixed with two side-effect imports; verified negligible bundle-size impact.

- c56886c: PEP-054: Rename "SFINAE rules" to "diagnostic suppression rules"

  "SFINAE" borrowed C++ template-metaprogramming terminology (overload-resolution
  failure) for a mechanism that actually suppresses a TypeScript diagnostic when
  typesugar's macro transformer will resolve it at emit time — an unrelated,
  misleading analogy. Renamed throughout to `DiagnosticSuppressionRule` and its
  family.
  - **`@typesugar/core`** (breaking): `packages/core/src/sfinae.ts` and
    `sfinae-rules.ts` are renamed to `diagnostic-suppression.ts` and
    `diagnostic-suppression-rules.ts`. Every exported symbol is renamed:
    `SfinaeRule` → `DiagnosticSuppressionRule`, `SfinaeAuditEntry` →
    `DiagnosticSuppressionAuditEntry`, `SfinaeEvalResult` →
    `DiagnosticSuppressionEvalResult`, `registerSfinaeRule(Once)` →
    `registerDiagnosticSuppressionRule(Once)`, `clearSfinaeRules` →
    `clearDiagnosticSuppressionRules`, `getSfinaeRules` →
    `getDiagnosticSuppressionRules`, `getSfinaeAuditLog`/`clearSfinaeAuditLog` →
    `getDiagnosticSuppressionAuditLog`/`clearDiagnosticSuppressionAuditLog`,
    `isSfinaeAuditEnabled`/`setSfinaeAuditMode` →
    `isDiagnosticSuppressionAuditEnabled`/`setDiagnosticSuppressionAuditMode`,
    `evaluateSfinae` → `evaluateDiagnosticSuppression`. No deprecated aliases
    (pre-1.0, matching PEP-053's precedent). The `TYPESUGAR_SHOW_SFINAE`
    environment variable is renamed to `TYPESUGAR_SHOW_SUPPRESSED_DIAGNOSTICS`.
  - **`@typesugar/macros`** (breaking): `sfinae-rules.ts`/`sfinae-registration.ts`
    renamed to `diagnostic-suppression-rules.ts`/`diagnostic-suppression-registration.ts`.
    `SfinaeRegistrationOptions` → `DiagnosticSuppressionRegistrationOptions`,
    `registerAllSfinaeRules` → `registerAllDiagnosticSuppressionRules`,
    `ALL_SFINAE_RULE_NAMES` → `ALL_DIAGNOSTIC_SUPPRESSION_RULE_NAMES`. Individual
    rule creator functions (`createExtensionMethodCallRule`, etc.) are unchanged.
  - **`@typesugar/transformer`** (breaking, CLI): the `--show-sfinae` flag is
    renamed to `--show-suppressed-diagnostics`. No deprecated alias — the old
    flag is now silently ignored (typesugar's CLI does not error on unrecognized
    flags), so scripts/CI invocations using the old name will stop enabling
    audit mode without a warning. Update any tooling that passes `--show-sfinae`
    or reads `TYPESUGAR_SHOW_SFINAE`.
  - **`@typesugar/lsp-server`, `@typesugar/playground`**: internal call sites
    updated to the renamed core/macros exports; no public API changes.

  Not renamed (deliberately out of scope, see PEP-054): `type-rewrite-registry.ts`
  (a separate, correctly-named mechanism), and PEP-011/PEP-034's own historical
  titles.

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
- Updated dependencies [4d4ce68]
- Updated dependencies [9bcb9d8]
- Updated dependencies [0e0fe90]
- Updated dependencies [f8dcade]
- Updated dependencies [3400d8c]
- Updated dependencies [fae35e9]
- Updated dependencies [5d86014]
- Updated dependencies [f3c8949]
- Updated dependencies [3709f72]
- Updated dependencies [2543157]
- Updated dependencies [a7158b3]
- Updated dependencies [c5ebf64]
- Updated dependencies [ec2188f]
- Updated dependencies [2ec1797]
- Updated dependencies [d79d995]
- Updated dependencies [81f31db]
- Updated dependencies [0b5bcf8]
- Updated dependencies [a070a0c]
- Updated dependencies [16bf668]
- Updated dependencies [01a547c]
- Updated dependencies [34850dc]
- Updated dependencies [291dc90]
- Updated dependencies [5f9af12]
- Updated dependencies [d3243f9]
- Updated dependencies [2694138]
- Updated dependencies [3ae83a6]
- Updated dependencies [7340c04]
- Updated dependencies [d8d3736]
- Updated dependencies [7d84596]
- Updated dependencies [592d66b]
- Updated dependencies [3460709]
- Updated dependencies [eb77b03]
- Updated dependencies [4ca9f31]
- Updated dependencies [0435dc6]
- Updated dependencies [80d05b4]
- Updated dependencies [b8d6753]
- Updated dependencies [95602ac]
- Updated dependencies [a39fa2d]
- Updated dependencies [456294d]
- Updated dependencies [bec2d2b]
- Updated dependencies [fbf4ef1]
- Updated dependencies [8b4060d]
- Updated dependencies [a6584d7]
- Updated dependencies [75f1968]
- Updated dependencies [e016c8d]
- Updated dependencies [c9a1e3e]
- Updated dependencies [624d80a]
- Updated dependencies [e0ba26b]
- Updated dependencies [9dcc681]
- Updated dependencies [4b0d84d]
- Updated dependencies [76af80e]
- Updated dependencies [977888e]
- Updated dependencies [ac891d1]
- Updated dependencies [c7fb29f]
- Updated dependencies [508c7d3]
- Updated dependencies [a5c1b85]
- Updated dependencies [283fe78]
- Updated dependencies [d7d6236]
- Updated dependencies [eb6e5a8]
- Updated dependencies [6659c44]
- Updated dependencies [0411491]
- Updated dependencies [f4ffc81]
- Updated dependencies [0780883]
- Updated dependencies [f6e9683]
- Updated dependencies [0079f40]
- Updated dependencies [f66c14f]
- Updated dependencies [b893cb6]
- Updated dependencies [4e1787c]
- Updated dependencies [945648a]
- Updated dependencies [914817e]
- Updated dependencies [2252df8]
- Updated dependencies [851809b]
- Updated dependencies [718090c]
- Updated dependencies [5d3d92a]
- Updated dependencies [05dbbcb]
- Updated dependencies [ef7164e]
- Updated dependencies [8b0526f]
- Updated dependencies [6f70351]
- Updated dependencies [dade880]
- Updated dependencies [d0392e0]
- Updated dependencies [babbb30]
- Updated dependencies [8d5b6e3]
- Updated dependencies [cb87742]
- Updated dependencies [0e5a1de]
- Updated dependencies [38a89d0]
- Updated dependencies [ef5be91]
- Updated dependencies [a591082]
- Updated dependencies [2b2fda8]
- Updated dependencies [89c895b]
- Updated dependencies [c30101d]
- Updated dependencies [4f6ad83]
- Updated dependencies [0e2a586]
- Updated dependencies [928566a]
- Updated dependencies [d8f810b]
- Updated dependencies [63bf193]
- Updated dependencies [98adbea]
- Updated dependencies [48b621b]
- Updated dependencies [563e46b]
- Updated dependencies [57d76a1]
- Updated dependencies [e274769]
- Updated dependencies [053978c]
- Updated dependencies [8aaf40f]
- Updated dependencies [855eb1f]
- Updated dependencies [76672a0]
- Updated dependencies [c56886c]
- Updated dependencies [ab72bde]
- Updated dependencies [a252187]
- Updated dependencies [238e7d7]
- Updated dependencies [2fb4b62]
- Updated dependencies [c352805]
- Updated dependencies [56e1acf]
- Updated dependencies [4b8ef70]
- Updated dependencies [93ea406]
- Updated dependencies [e0694af]
- Updated dependencies [95b6631]
- Updated dependencies [f471698]
- Updated dependencies [5da6803]
- Updated dependencies [51a72ca]
- Updated dependencies [616d213]
- Updated dependencies [dca9c00]
- Updated dependencies [e064ef7]
- Updated dependencies [cf7c08b]
- Updated dependencies [d7b3911]
- Updated dependencies [e40c7e3]
- Updated dependencies [2f1744b]
- Updated dependencies [5d86014]
- Updated dependencies [0c9202a]
- Updated dependencies [5cc34d9]
- Updated dependencies [8204470]
- Updated dependencies [c1e797e]
- Updated dependencies [6edd688]
- Updated dependencies [615d4c1]
  - @typesugar/core@0.2.0
  - @typesugar/transformer-core@0.2.0
  - @typesugar/testing@0.1.2
  - @typesugar/macros@0.2.0
  - @typesugar/contracts@0.2.0
  - @typesugar/validate@0.2.0
  - @typesugar/std@0.2.0
  - @typesugar/typeclass@0.2.0
  - @typesugar/fp@0.2.0
  - @typesugar/parser@0.1.2
  - @typesugar/type-system@0.1.2
  - @typesugar/effect@0.2.0
  - @typesugar/collections@0.1.2
  - @typesugar/codec@0.1.2
  - @typesugar/graph@0.1.2
  - @typesugar/mapper@0.1.2
  - @typesugar/math@0.1.2
  - @typesugar/units@0.1.2

## 0.1.1

### Patch Changes

- e2cbd69: Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- First stable patch release. Fixes build crash, LSP server stability, Zed extension, and adds pipeline/position-mapper exports to transformer.
- Updated dependencies [e2cbd69]
- Updated dependencies
  - @typesugar/core@0.1.1
  - @typesugar/macros@0.1.1
  - @typesugar/transformer-core@0.1.1
  - @typesugar/preprocessor@0.1.1
  - @typesugar/std@0.1.1
  - @typesugar/typeclass@0.1.1
  - @typesugar/fp@0.1.1
  - @typesugar/collections@0.1.1
  - @typesugar/graph@0.1.1
  - @typesugar/parser@0.1.1
  - @typesugar/codec@0.1.1
  - @typesugar/mapper@0.1.1
  - @typesugar/math@0.1.1
  - @typesugar/symbolic@0.1.1
  - @typesugar/units@0.1.1
  - @typesugar/type-system@0.1.1
  - @typesugar/contracts@0.1.1
  - @typesugar/validate@0.1.1
  - @typesugar/effect@0.1.1
  - @typesugar/testing@0.1.1

## 0.1.1-rc.0

### Patch Changes

- Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- Updated dependencies
  - @typesugar/core@0.1.1-rc.0
  - @typesugar/macros@0.1.1-rc.0
  - @typesugar/transformer-core@0.1.1-rc.0
  - @typesugar/preprocessor@0.1.1-rc.0
  - @typesugar/std@0.1.1-rc.0
  - @typesugar/typeclass@0.1.1-rc.0
  - @typesugar/fp@0.1.1-rc.0
  - @typesugar/collections@0.1.1-rc.0
  - @typesugar/graph@0.1.1-rc.0
  - @typesugar/parser@0.1.1-rc.0
  - @typesugar/codec@0.1.1-rc.0
  - @typesugar/mapper@0.1.1-rc.0
  - @typesugar/math@0.1.1-rc.0
  - @typesugar/symbolic@0.1.1-rc.0
  - @typesugar/units@0.1.1-rc.0
  - @typesugar/type-system@0.1.1-rc.0
  - @typesugar/contracts@0.1.1-rc.0
  - @typesugar/validate@0.1.1-rc.0
  - @typesugar/effect@0.1.1-rc.0
  - @typesugar/testing@0.1.1-rc.0
