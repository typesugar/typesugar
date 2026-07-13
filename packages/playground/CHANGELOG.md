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
  - @typesugar/core@0.2.0
  - @typesugar/macros@0.2.0
  - @typesugar/effect@0.2.0
  - @typesugar/std@0.2.0
  - @typesugar/contracts@0.2.0
  - @typesugar/transformer-core@0.2.0
  - @typesugar/fp@0.2.0
  - @typesugar/typeclass@0.1.2
  - @typesugar/collections@0.1.2
  - @typesugar/validate@0.1.2
  - @typesugar/codec@0.1.2
  - @typesugar/graph@0.1.2
  - @typesugar/mapper@0.1.2
  - @typesugar/math@0.1.2
  - @typesugar/parser@0.1.2
  - @typesugar/testing@0.1.2
  - @typesugar/type-system@0.1.2
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
