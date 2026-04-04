---
"@typesugar/core": patch
"@typesugar/macros": patch
"@typesugar/lsp-common": patch
"@typesugar/transformer": patch
"@typesugar/lsp-server": patch
---

PEP-034: Unified SFINAE registration and shared IDE infrastructure

- Unified all SFINAE rule registration into `registerAllSfinaeRules()` to prevent drift between IDE paths
- New `@typesugar/lsp-common` package with shared position mapping, AST helpers, and macro code actions
- Added `getApplicableRefactors` and `getCompletionEntryDetails` to the TS plugin language service
- Diagnostic parity test suite exercising all 6 SFINAE rules
- Zed extension workspace detection (only starts LSP for typesugar projects)
