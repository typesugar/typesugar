# typesugar-vscode

## 0.2.0

### Minor Changes

- 33fee99: PEP-060 D5: the tsserver plugin is typesugar's single editor engine for 1.0.
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

### Patch Changes

- 3da95a9: An error TypeScript finds in macro-generated code is reported at the nearest code of yours around
  it instead of being dropped. The editor dropped every such error (a position with no source
  mapping), and plain `typesugar check`/`build` did too, so an unannotated `@impl` instance with a
  missing or misspelled member (TS1360 at the `satisfies` the expansion adds) built cleanly and
  threw at run time; `check --strict` reported it at a line of the expanded code. All of them now
  report it at the instance's initializer. `check` and `build` also type-check the expansion of
  every `@impl` instance (as they already did for comprehensions and `match()` chains), since an
  unannotated instance meets its typeclass only there.
- 5e8c832: The extension declares `"untrustedWorkspaces": { "supported": false }`: in a folder you haven't
  trusted (Restricted Mode) it stays off, and the TypeScript server plugin it contributes is not
  registered, because the plugin runs the workspace's macro packages and `typesugar.config`. Trust
  the folder to turn it on. SECURITY.md describes what VS Code's own TypeScript support does in
  Restricted Mode, and other editors.
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
  - @typesugar/ts-plugin@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [e2cbd69]
- Updated dependencies
  - @typesugar/core@0.1.1
  - @typesugar/ts-plugin@0.1.1
  - @typesugar/lsp-server@0.1.1

## 0.1.1-rc.0

### Patch Changes

- Updated dependencies
  - @typesugar/core@0.1.1-rc.0
  - @typesugar/ts-plugin@0.1.1-rc.0
  - @typesugar/lsp-server@0.1.1-rc.0
