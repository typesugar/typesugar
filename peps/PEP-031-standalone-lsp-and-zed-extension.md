# PEP-031: Standalone LSP Server & Zed Extension

**Status:** Implemented (scope reduced by [PEP-047](PEP-047-remove-sts.md))
**Date:** 2026-03-30
**Author:** Claude (with Dean Povey)

> **Scope reduced (2026-06-10):** PEP-047 removed the `.sts`/`.stsx` extension
> and custom surface syntax. The `@typesugar/zed` package and all `.sts`-specific
> LSP file discovery, snapshot preprocessing, and language detection described
> below were deleted. The standalone LSP server itself remains, now serving
> macro-aware diagnostics/features for plain `.ts`/`.tsx` files.

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

- [x] Create `packages/lsp-server/` with `package.json` (`@typesugar/lsp-server`), `tsconfig.json`
- [x] Add dependencies: `vscode-languageserver` (protocol), `vscode-languageserver-textdocument` (document sync)
- [x] Implement `src/server.ts` — LSP server entry point:
  - Initialize `TransformationPipeline` and language service from `@typesugar/transformer/language-service`
  - Create a TypeScript `LanguageServiceHost` backed by LSP `TextDocuments`
  - Wire up LSP lifecycle: `onInitialize`, `onInitialized`, `onShutdown`
- [x] Implement document sync: `onDidOpen`, `onDidChangeContent`, `onDidClose` → trigger retransform, push diagnostics
- [x] Map existing language service methods to LSP handlers:

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

- [x] Add a `bin` entry (`typesugar-lsp`) that runs `node dist/server.js --stdio`
- [x] Add integration test: start server over stdio, send `initialize` → `textDocument/didOpen` with a `.sts` file → verify diagnostics are returned

**Gate:**

- [x] `typesugar-lsp --stdio` starts and responds to `initialize`
- [x] Opening a file produces correct diagnostics
- [x] `textDocument/completion` returns completions with correct resolve position
- [x] `textDocument/definition` resolves correctly
- [x] Position mapping is correct: LSP positions correspond to the original source, not the transformed output
- [x] Full test suite passes (35 tests: 27 unit + 8 integration)

### Wave 1.5: Code Review Fixes

Fixes all issues identified in code review of Wave 1.

**Tasks:**

- [x] **fix #1: URI construction** — use `vscode-uri` (`URI.file()` / `URI.parse()`) instead of naive string construction for correct handling of spaces, `#`, `?`, and other special characters in file paths
- [x] **fix #2: document lookup** — use `fileNameToUri()` for consistent URI construction when looking up open documents via `documents.get()`, matching the URI format the editor sends
- [x] **fix #3: getScriptVersion recursion risk** — `getScriptVersion` now reads `transformCache` directly instead of calling `getTransformResult`, preventing potential `getScriptVersion → getTransformResult → getScriptVersion` loops
- [x] **fix #4: completionItem/resolve position** — store `transformedOffset` in `item.data` so `getCompletionEntryDetails` receives the correct position instead of hardcoded `0`
- [x] **fix #5: dead code** — removed unused `diskFileVersions` map
- [x] **fix #6: synchronous diagnostics** — `onDidChangeContent` now debounces diagnostic publishing (300ms) to avoid blocking the LSP message loop on every keystroke; `onDidOpen` still publishes immediately
- [x] **fix #7: shutdown lifecycle** — added `onShutdown` handler that clears pending diagnostic timers and calls `languageService.dispose()`; added `onExit` handler
- [x] **fix #8: double lookup** — `getScriptVersion` now reads `transformCache` directly (see fix #3), avoiding redundant `getTransformResult` calls
- [x] **fix #9: connection fallback** — simplified to always call `createConnection(ProposedFeatures.all)` (auto-detects transport from argv); bin script ensures `--stdio` is in argv
- [x] **fix #10: DocumentHighlightKind enum** — replaced magic numbers `2`/`3` with `DocumentHighlightKind.Read`/`DocumentHighlightKind.Write` from `vscode-languageserver`
- [x] **fix #11: unused import** — removed unused `DocumentHighlightKind as _DocumentHighlightKind` type alias and unused `Position` type import
- [x] **fix #12: positionToOffset bounds** — `positionToOffset` now clamps character to actual line length; `offsetToPosition` clamps to `[0, text.length]`
- [x] **fix #13: dependency propagation** — added `onDidSave` handler that invalidates transform cache and re-publishes diagnostics for all other open documents (saving file A can change diagnostics in file B)

**Structural:**

- [x] Extracted pure helper functions (`uriToFileName`, `fileNameToUri`, `offsetToPosition`, `positionToOffset`, `textSpanToRange`) into `src/helpers.ts` so they can be unit-tested without triggering the LSP connection setup
- [x] Added `vscode-uri` as a direct dependency

**Tests:**

- [x] 27 unit tests in `tests/helpers.test.ts` covering URI round-tripping (fix #1/#2), offset/position conversion with clamping (fix #12), edge cases (empty text, out-of-bounds)
- [x] 8 integration tests in `tests/lsp-integration.test.ts` covering: initialize (#9), diagnostics, hover, completion resolve (#4), go-to-definition, shutdown (#7), debounce (#6), dependent re-check on save (#13)

**Gate:**

- [x] All 35 tests pass
- [x] `tsc --noEmit` passes with zero errors
- [x] `tsup` build succeeds

### Wave 2: Migrate VS Code Extension Features to LSP

Move VS Code-specific providers into the LSP server so all editors benefit.

**Tasks:**

- [x] **Semantic tokens** — implement `textDocument/semanticTokens/full` in the LSP server, using the manifest-driven token classification from `packages/vscode/src/semantic-tokens.ts` (macro, macroDecorator, extensionMethod, etc.)
- [x] **CodeLens** — implement `textDocument/codeLens` + `codeLens/resolve` for inline macro expansion previews, porting logic from `packages/vscode/src/codelens.ts`
- [x] **Inlay hints** — implement `textDocument/inlayHint` for bind types and comptime results, porting from `packages/vscode/src/inlay-hints.ts`
- [x] **Code actions** — extend `textDocument/codeAction` with expand-macro, wrap-in-comptime, add-derive actions from `packages/vscode/src/code-actions.ts`
- [x] **Commands** — implement workspace commands (`typesugar.expandMacro`, `typesugar.showTransformed`, `typesugar.refreshManifest`) via `workspace/executeCommand`
- [x] Refactor VS Code extension to be a thin LSP client:
  - Rewrote `extension.ts` to use `vscode-languageclient` connecting to `typesugar-lsp` over stdio
  - Added `@typesugar/lsp-server` as bundled dependency
  - Removed all provider registrations (semantic tokens, codelens, inlay hints, code actions, diagnostics)
  - Kept VS Code-specific UI: commands (peek widget, diff view, terminal), status bar
  - Old provider files retained for reference but no longer imported

**Gate:**

- [x] VS Code extension connects to LSP server for all language features
- [x] extension.ts no longer imports or registers duplicate providers
- [x] LSP server returns semantic tokens for a file with macros (22 unit tests)
- [x] Full test suite passes: 57 tests (27 helpers + 22 wave2 + 8 integration)

### Wave 3: Zed Extension (`packages/zed`)

Create a Zed editor extension that provides typesugar support via the LSP server.

**Tasks:**

- [x] Create `packages/zed/` with Zed extension structure:
  - `extension.toml` — extension manifest (name, version, description, authors, repository)
  - `languages/sugared-typescript/` — language directory with `config.toml`, `highlights.scm`
  - `languages/sugared-typescriptreact/` — same for `.stsx` files
  - `src/lib.rs` — Rust extension entry point (compiled to WASM)
  - `Cargo.toml` — standalone workspace (not part of root napi workspace)
- [x] Implement `src/lib.rs`:
  - Implements `zed::Extension` trait
  - `language_server_command()` → resolves `typesugar-lsp` via `worktree.which()` or `node_modules/.bin/`
  - `language_server_initialization_options()` → returns None (server auto-discovers config)
- [x] Language detection: `.sts` → Sugared TypeScript (grammar: typescript), `.stsx` → Sugared TypeScript React (grammar: tsx)
- [x] Tree-sitter grammar: uses `tree-sitter-typescript`/`tree-sitter-tsx` as-is (per PEP recommendation, option 1). LSP semantic tokens provide macro-aware highlighting overlay.
- [ ] Add installation instructions to README

**Gate:**

- [x] Extension can be built with `cargo build --target wasm32-wasip1 --release`
- [x] Language detection registered for `.sts` and `.stsx`
- [ ] Zed recognizes `.sts` files and applies syntax highlighting (requires manual testing)
- [ ] Zed starts the LSP server when a `.sts` file is opened (requires manual testing)
- [ ] Diagnostics, completions, hover, go-to-definition work in Zed (requires manual testing)

### Wave 4: Neovim Configuration (Documentation Only)

Since Neovim supports arbitrary LSP servers via `nvim-lspconfig`, no plugin is needed — just configuration.

**Tasks:**

- [x] Document `nvim-lspconfig` setup for `typesugar-lsp` (including filetype detection and treesitter registration)
- [x] Document filetype detection for `.sts`/`.stsx` in Neovim
- [x] Add Helix language server configuration example (`languages.toml`)
- [x] Comprehensive editor setup guide at `docs/editor-setup.md` covering Neovim, Helix, Zed, and VS Code

**Gate:**

- [x] Documentation covers all editors with copy-paste examples
- [ ] Tested with Neovim (requires manual testing)

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
