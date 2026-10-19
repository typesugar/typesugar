# @typesugar/lsp-server

> ⚠️ **Not supported in 1.0; use the TypeScript language-service plugin — see [editor setup](https://typesugar.org/getting-started/editor-setup).**
>
> The tsserver plugin (`@typesugar/transformer/language-service` in `tsconfig.json`
> `compilerOptions.plugins`) is typesugar's single editor engine for 1.0. It runs inside your
> editor's own TypeScript server: VS Code (through the typesugar extension), and Neovim, Zed,
> Sublime Text, Helix and Emacs through `typescript-language-server` or `vtsls`. The VS Code
> extension no longer starts this server.
>
> This package is kept in the repository but is not developed or tested as an editor
> integration. Starting it logs a one-time warning saying so.

Standalone LSP server for typesugar macro-aware IDE support (diagnostics, hover, completions,
code actions) over stdio. It handles a single root `tsconfig.json`, with no project references
and no file watching, which is part of why the tsserver plugin replaced it.
