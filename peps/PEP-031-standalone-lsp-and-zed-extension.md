# PEP-031: Standalone LSP Server & Zed Extension

**Status:** Draft
**Date:** 2026-03-30
**Author:** Claude (with Dean Povey)

## Context

typesugar's IDE support currently exists as a **TypeScript Language Service Plugin** (`@typesugar/ts-plugin`) that runs in-process with `tsserver`. This architecture means:

1. The plugin only works in editors that use `tsserver` and respect `compilerOptions.plugins` (effectively just VS Code).
2. The VS Code extension (`packages/vscode`) provides additional features (CodeLens, semantic tokens, inlay hints, code actions) that are tightly coupled to the VS Code API.
3. Editors like **Zed**, Neovim, Helix, and Sublime Text all support the **Language Server Protocol (LSP)** but cannot use our in-process TS plugin.

Zed in particular requires extensions to be Rust compiled to WASM, providing a language definition (Tree-sitter grammar) and an LSP adapter that starts a standalone server over stdio.

### Current Architecture

```
┌──────────────────────────────────────────────────────┐
│ VS Code                                              │
│  ┌──────────────┐   ┌─────────────────────────────┐  │
│  │ vscode ext   │   │ tsserver                    │  │
│  │ (CodeLens,   │   │  ┌───────────────────────┐  │  │
│  │  semantic    │   │  │ @typesugar/ts-plugin   │  │  │
│  │  tokens,     │   │  │  → language-service.ts │  │  │
│  │  inlay hints)│   │  └───────────────────────┘  │  │
│  └──────────────┘   └─────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### Target Architecture

```
┌──────────────────────────────────────────────────┐
│  @typesugar/lsp-server (Node.js, stdio)          │
│  ┌────────────────────────────────────────────┐  │
│  │ LSP protocol layer (vscode-languageserver) │  │
│  │  → language-service.ts (existing)          │  │
│  │  → expansion.ts (from vscode ext)          │  │
│  └────────────────────────────────────────────┘  │
└──────────────────┬───────────────────────────────┘
                   │ stdio / LSP
       ┌───────────┼───────────────┐
       │           │               │
   ┌───┴───┐  ┌───┴───┐     ┌─────┴─────┐
   │ VS Code│  │  Zed  │     │ Neovim/   │
   │  ext   │  │  ext  │     │ Helix/etc │
   └────────┘  └───────┘     └───────────┘
```

## Waves

### Wave 1: Standalone LSP Server (`packages/lsp-server`)

Extract and wrap the existing language service into a standalone LSP server that communicates over stdio.

**Tasks:**

- [ ] Create `packages/lsp-server/` with `package.json` (`@typesugar/lsp-server`), `tsconfig.json`
- [ ] Add dependencies: `vscode-languageserver` (protocol), `vscode-languageserver-textdocument` (document sync)
- [ ] Implement `src/server.ts` — LSP server entry point:
  - Initialize `TransformationPipeline` and language service from `@typesugar/transformer/language-service`
  - Create a TypeScript `LanguageServiceHost` backed by LSP `TextDocuments`
  - Wire up LSP lifecycle: `onInitialize`, `onInitialized`, `onShutdown`
- [ ] Implement document sync: `onDidOpen`, `onDidChangeContent`, `onDidClose` → trigger retransform, push diagnostics
- [ ] Map existing language service methods to LSP handlers:

  | TS LanguageService method                            | LSP handler                                          |
  | ---------------------------------------------------- | ---------------------------------------------------- |
  | `getSemanticDiagnostics` + `getSyntacticDiagnostics` | `textDocument/publishDiagnostics` (push)             |
  | `getCompletionsAtPosition`                           | `textDocument/completion`                            |
  | `getCompletionEntryDetails`                          | `completionItem/resolve`                             |
  | `getQuickInfoAtPosition`                             | `textDocument/hover`                                 |
  | `getDefinitionAndBoundSpan`                          | `textDocument/definition`                            |
  | `getTypeDefinitionAtPosition`                        | `textDocument/typeDefinition`                        |
  | `getReferencesAtPosition`                            | `textDocument/references`                            |
  | `getSignatureHelpItems`                              | `textDocument/signatureHelp`                         |
  | `getRenameInfo` + `findRenameLocations`              | `textDocument/rename` + `textDocument/prepareRename` |
  | `getDocumentHighlights`                              | `textDocument/documentHighlight`                     |
  | `getCodeFixesAtPosition`                             | `textDocument/codeAction`                            |

- [ ] Add a `bin` entry (`typesugar-lsp`) that runs `node dist/server.js --stdio`
- [ ] Add integration test: start server over stdio, send `initialize` → `textDocument/didOpen` with a `.sts` file → verify diagnostics are returned

**Gate:**

- [ ] `typesugar-lsp --stdio` starts and responds to `initialize`
- [ ] Opening a `.sts` file with a macro produces correct diagnostics
- [ ] `textDocument/completion` returns macro-aware completions (extension methods)
- [ ] `textDocument/definition` on a macro-generated symbol resolves correctly
- [ ] Position mapping is correct: LSP positions correspond to the original `.sts` source, not the transformed output
- [ ] Full test suite passes with no regressions

### Wave 2: Migrate VS Code Extension Features to LSP

Move VS Code-specific providers into the LSP server so all editors benefit.

**Tasks:**

- [ ] **Semantic tokens** — implement `textDocument/semanticTokens/full` in the LSP server, using the manifest-driven token classification from `packages/vscode/src/semantic-tokens.ts` (macro, macroDecorator, extensionMethod, etc.)
- [ ] **CodeLens** — implement `textDocument/codeLens` + `codeLens/resolve` for inline macro expansion previews, porting logic from `packages/vscode/src/codelens.ts`
- [ ] **Inlay hints** — implement `textDocument/inlayHint` for bind types and comptime results, porting from `packages/vscode/src/inlay-hints.ts`
- [ ] **Code actions** — extend `textDocument/codeAction` with expand-macro, wrap-in-comptime, add-derive actions from `packages/vscode/src/code-actions.ts`
- [ ] **Commands** — implement workspace commands (`typesugar.expandMacro`, `typesugar.showTransformed`, `typesugar.refreshManifest`) via `workspace/executeCommand`
- [ ] Refactor VS Code extension to be a thin LSP client:
  - Remove duplicated provider logic
  - Use `vscode-languageclient` to connect to `typesugar-lsp` over stdio
  - Keep only VS Code-specific UI (output channel, status bar, webview panels if any)

**Gate:**

- [ ] VS Code extension works identically via the LSP server (semantic tokens, CodeLens, inlay hints, code actions all functional)
- [ ] No duplicate logic remains between `packages/vscode` and `packages/lsp-server`
- [ ] LSP server returns semantic tokens for a file with macros
- [ ] Full test suite passes with no regressions

### Wave 3: Zed Extension (`packages/zed`)

Create a Zed editor extension that provides typesugar support via the LSP server.

**Tasks:**

- [ ] Create `packages/zed/` with Zed extension structure:
  - `extension.toml` — extension manifest (name, version, description, authors, repository)
  - `languages/sugared-typescript/` — language directory:
    - `config.toml` — language config (tab size, comment tokens, brackets, word characters)
    - `highlights.scm` — Tree-sitter highlight queries (can start by inheriting from TypeScript's queries and adding macro-specific patterns)
    - `injections.scm` — injection queries (if needed for template literals)
  - `src/lib.rs` — Rust extension entry point (compiled to WASM)
- [ ] Implement `src/lib.rs`:
  - Implement `zed::Extension` trait
  - `language_server_command()` → return path to `typesugar-lsp` binary (resolve from `node_modules/.bin/` or global install)
  - `language_server_initialization_options()` → pass workspace config (manifest path, feature flags)
- [ ] Language detection: register `.sts` → `sugared-typescript`, `.stsx` → `sugared-typescriptreact`
- [ ] Tree-sitter grammar: evaluate whether to create a custom grammar or use `tree-sitter-typescript` as a base with macro-aware extensions (custom syntax like `|>`, `::`, `F<_>` would need grammar additions)
- [ ] Add installation instructions to README

**Gate:**

- [ ] Zed recognizes `.sts` files and applies syntax highlighting
- [ ] Zed starts the LSP server when a `.sts` file is opened
- [ ] Diagnostics appear in the Zed editor
- [ ] Completions, hover, go-to-definition work in Zed
- [ ] Extension can be built with `cargo build --target wasm32-wasi`

### Wave 4: Neovim Configuration (Documentation Only)

Since Neovim supports arbitrary LSP servers via `nvim-lspconfig`, no plugin is needed — just configuration.

**Tasks:**

- [ ] Document `nvim-lspconfig` setup for `typesugar-lsp`:

  ```lua
  local lspconfig = require('lspconfig')
  local configs = require('lspconfig.configs')

  configs.typesugar = {
    default_config = {
      cmd = { 'typesugar-lsp', '--stdio' },
      filetypes = { 'sugared-typescript', 'sugared-typescriptreact' },
      root_dir = lspconfig.util.root_pattern('typesugar.manifest.json', 'package.json'),
    },
  }

  lspconfig.typesugar.setup{}
  ```

- [ ] Document filetype detection for `.sts`/`.stsx` in Neovim
- [ ] Add Helix language server configuration example (`languages.toml`)

**Gate:**

- [ ] Documentation is accurate and tested with Neovim
- [ ] Copy-paste setup works out of the box

## Design Decisions

### Why not wrap `tsserver` directly?

We considered having editors connect to `tsserver` with the plugin loaded (the way VS Code does today). This was rejected because:

1. Most editors don't support `tsserver` plugin configuration
2. `tsserver` uses its own non-standard protocol (not LSP)
3. We'd still need an LSP adapter layer, and we'd inherit all of tsserver's complexity
4. A standalone server gives us full control over initialization, caching, and lifecycle

### Why `vscode-languageserver` (Node.js) instead of a Rust LSP?

1. The entire transformer pipeline is TypeScript — calling it from Rust would require Node.js FFI anyway
2. `vscode-languageserver` is mature and handles protocol details (cancellation, progress, capabilities negotiation)
3. The language service is already written; we're wrapping it, not rewriting it

### Tree-sitter grammar for Zed

typesugar's syntax is a superset of TypeScript. Options:

1. **Use `tree-sitter-typescript` as-is** — works for most syntax but won't highlight `|>`, `::`, or macro decorators specially. Simplest starting point.
2. **Fork `tree-sitter-typescript`** — add rules for pipe operator, extension method syntax, etc. Better highlighting but maintenance burden.
3. **Custom grammar** — overkill given that 95% of syntax is standard TypeScript.

Recommendation: start with option 1, add targeted overrides via `highlights.scm` queries where possible, and fork only if users request better syntax highlighting.

## Files Changed

| Package            | Files                                                                                    | Waves |
| ------------------ | ---------------------------------------------------------------------------------------- | ----- |
| `lsp-server` (new) | `package.json`, `tsconfig.json`, `src/server.ts`, `bin/typesugar-lsp`                    | 1     |
| `lsp-server`       | `src/semantic-tokens.ts`, `src/codelens.ts`, `src/inlay-hints.ts`, `src/code-actions.ts` | 2     |
| `vscode`           | `src/extension.ts` (refactor to LSP client), remove provider files                       | 2     |
| `zed` (new)        | `extension.toml`, `src/lib.rs`, `languages/sugared-typescript/*`                         | 3     |
| `docs`             | Neovim/Helix setup guides                                                                | 4     |

## Consequences

### Benefits

- **Multi-editor support** — Zed, Neovim, Helix, Sublime, and any LSP client get full typesugar IDE features
- **Single source of truth** — language intelligence logic lives in one place (the LSP server), not duplicated per editor
- **Easier maintenance** — fixing a bug in the LSP server fixes it everywhere
- **VS Code extension simplifies** — becomes a thin client, easier to maintain and test

### Trade-offs

- **New package to maintain** — `packages/lsp-server` adds build/test/release surface
- **VS Code feature parity risk** — during Wave 2 migration, some VS Code-specific features may need careful porting (e.g., webview-based expansion previews may not have LSP equivalents)
- **Zed extension requires Rust** — small amount of Rust/WASM to maintain for the Zed adapter
- **Tree-sitter grammar gap** — custom typesugar syntax (`|>`, `::`) won't get specialized highlighting until a grammar fork is created

### Non-Goals

- Rewriting the transformer pipeline in Rust
- Supporting editors that don't implement LSP
- Creating a Language Server Index Format (LSIF) generator
- IntelliJ/WebStorm plugin (uses its own plugin API, not LSP)
