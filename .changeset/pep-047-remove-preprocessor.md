---
"@typesugar/playground": minor
"@typesugar/transformer": patch
"@typesugar/eslint-plugin": patch
"@typesugar/lsp-server": patch
"unplugin-typesugar": patch
---

PEP-047: Remove the `@typesugar/preprocessor` package

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
