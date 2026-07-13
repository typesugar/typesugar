# unplugin-typesugar

## 0.1.2

### Patch Changes

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
