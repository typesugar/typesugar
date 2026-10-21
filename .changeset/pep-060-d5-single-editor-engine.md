---
"typesugar-vscode": minor
"@typesugar/transformer": patch
---

PEP-060 D5: the tsserver plugin is typesugar's single editor engine for 1.0.

- **`typesugar-vscode`**: the extension no longer starts `@typesugar/lsp-server`, so
  completions, hover, diagnostics, definitions, rename and code actions are no longer served
  twice. Language features come only from the bundled tsserver plugin. "Expand Macro at Cursor"
  and "Show Transformed Source" stay; they now ask the plugin through custom tsserver requests,
  and both are also in the editor context menu. `typesugar.comptimeInEditor` reaches the plugin
  through the TypeScript extension's `configurePlugin` (trusted workspaces only). Removed:
  CodeLens, the LSP's macro semantic tokens (and their token types and colours), the status bar
  item, the `refreshManifest` / `generateManifest` / `addDerive` commands, the
  `enableCodeLens` / `enableInlayHints` / `enableDiagnostics` / `manifestPath` settings, the
  manifest activation event, and eight unused modules. `generateManifest` ran
  `typesugar build --manifest`, a flag that doesn't exist.
- **`@typesugar/transformer`** (language-service plugin): answers the custom tsserver requests
  `_typesugar.expandMacro` and `_typesugar.showTransformed`; adds macro-expansion inlay hints
  and maps TypeScript's own inlay hints back to source positions; takes `comptimeInEditor` from
  the editor (`configurePlugin`) but ignores it when it comes from the repository's
  `tsconfig.json`; loads at most once per project (a `tsconfig.json` entry plus the VS Code
  extension's global plugin no longer double-transform); maps positions for TypeScript's own
  refactors, which crashed on transformed files; and no longer offers "Expand …" / "Add
  @derive(...)" refactors that did nothing.
- **`@typesugar/lsp-server`**: removed from the repository. The published 0.1.1 stays on npm and
  stays installable, but gets no further releases; use the TypeScript plugin.
