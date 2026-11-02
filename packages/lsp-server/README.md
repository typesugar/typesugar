# @typesugar/lsp-server

> 📖 **Full documentation:** [Editor Setup](https://typesugar.org/getting-started/editor-setup). The microsite is the canonical reference; this README is a quickstart.

> Status: experimental — API may change before 1.0.

The supported `.ts`/`.tsx` editor story is `@typesugar/ts-plugin` (+ the VS Code extension); the standalone LSP server primarily existed for non-VS Code editors and the now-removed `.sts`/Zed integration.

Standalone LSP server for typesugar macro-aware IDE support (diagnostics,
hover, completions, code actions) over stdio, for editors that don't use the
TypeScript language-service plugin path.
