# @typesugar/lsp-common

## 0.1.2

### Patch Changes

- 4f6ad83: PEP-034: Unified SFINAE registration and shared IDE infrastructure
  - Unified all SFINAE rule registration into `registerAllSfinaeRules()` to prevent drift between IDE paths
  - New `@typesugar/lsp-common` package with shared position mapping, AST helpers, and macro code actions
  - Added `getApplicableRefactors` and `getCompletionEntryDetails` to the TS plugin language service
  - Diagnostic parity test suite exercising all 6 SFINAE rules
  - Zed extension workspace detection (only starts LSP for typesugar projects)

- ab72bde: PEP-058 Wave 1: declare `engines.node >=20` on all published packages and enable npm provenance attestations in the release pipeline.
- a252187: PEP-058 Wave 2: pre-release onboarding and source corrections.
  - `typesugar init` now actually patches an existing vite/webpack/rollup
    config (previously it computed and silently discarded the patch,
    no-oping in the most common brownfield case), and prints an explicit
    "not yet supported" message for Next.js instead of implying support.
  - `typesugar create` templates now ship inside `@typesugar/transformer` —
    previously they lived only at the monorepo root, so `create` failed for
    every registry install of the CLI.
  - `typesugar doctor`'s ts-patch detection now checks for ts-patch's real
    `/// tsp-module:` header instead of a fuzzy substring that could
    false-positive on unpatched builds.
  - All compiler-emitted diagnostic help URLs (`seeAlso` in the TS9xxx and
    EFFECT0xx catalogs) and CLI next-step links now point at the canonical
    typesugar.org domain (previously typesugar.dev, which is not the site).
  - `@typesugar/lsp-common` gains a README and `sideEffects: false`.

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
  - @typesugar/core@0.2.0
