# typesugar-vscode

> 📖 **Full documentation:** [Editor Setup](https://typesugar.org/getting-started/editor-setup). The microsite is the canonical reference; this README is a quickstart.

> VS Code / Cursor extension for typesugar.

## Overview

The typesugar VS Code extension (package `typesugar-vscode`, private: it is not published to npm)
adds typesugar to VS Code's built-in TypeScript support. All language features come from the
TypeScript server plugin `@typesugar/ts-plugin` (a thin wrapper around
`@typesugar/transformer/language-service`), which the extension bundles and registers through
`typescriptServerPlugins`. That plugin is typesugar's single editor engine; the extension doesn't
start a separate language server.

## Features

### From the TypeScript server plugin

VS Code's own TypeScript features become macro-aware: the plugin serves macro-expanded code to
TypeScript and maps positions back to your source.

- **Diagnostics**: TypeScript errors and typesugar's macro errors (TS9xxx), at your source
  positions, not in generated code
- **Completions, hover, go-to-definition, references, rename, signature help** through macro
  expansions
- **Quick fixes** that typesugar diagnostics suggest
- **Inlay hints** after expression-macro calls showing the expansion
  (`fieldNames<User>()  = ["id", "name"]`). VS Code only asks for inlay hints when at least one
  `typescript.inlayHints.*` setting is on.

### From the extension

| Command                                                            | What it does                                                      |
| ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `typesugar: Expand Macro at Cursor` (`typesugar.expandMacro`)      | Opens the expansion of the macro under the cursor beside the file |
| `typesugar: Show Transformed Source` (`typesugar.showTransformed`) | Diff of the file against what TypeScript sees after expansion     |

Both are in the command palette and the editor context menu for TypeScript files. They ask the
plugin through custom tsserver requests, so they show the current buffer, saved or not.

TextMate grammars highlight `let:`/`yield:` blocks, the `<<` bind operator, `comptime`, and unit
literals such as `42_km`.

## Installation

### From VSIX

```bash
# In the typesugar repo
cd packages/vscode
pnpm run package
code --install-extension typesugar-*.vsix
```

The extension's bundled plugin works with VS Code's bundled TypeScript and with the workspace
version. If your `tsconfig.json` also lists `@typesugar/transformer/language-service` (needed for
other editors), the project's installed copy is used and the bundled one stands down.

## Settings

| Setting                      | Description                                                                                                      | Default |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------- |
| `typesugar.comptimeInEditor` | Evaluate `comptime(...)` in the editor. Trusted workspaces only: comptime code runs with the editor's privileges | `false` |

The setting reaches the plugin through the TypeScript extension's `configurePlugin` API. A
repository can't switch it on from its own `tsconfig.json`.

## Development

```bash
pnpm install
pnpm run build          # tsup → dist/extension.js
pnpm run build:watch
pnpm run package        # VSIX with the bundled ts-plugin + transformer
```

### Unit tests (vitest, mocked VS Code API)

```bash
pnpm --filter typesugar-vscode test:unit
```

Test files: `test/extension-activation.test.ts` (commands, tsserver requests, plugin
configuration), `test/vsix-smoke.test.ts` (package contents). The plugin side of the custom
requests is tested in `packages/transformer/tests/language-service-editor.test.ts`.

### Integration tests (@vscode/test-cli)

These download and run VS Code in an Extension Development Host:

```bash
pnpm --filter typesugar-vscode test:integration
# Linux CI (headless)
xvfb-run -a pnpm --filter typesugar-vscode test:integration
```

Test files: `test/integration/activation.test.ts`, `test/integration/commands.test.ts`,
`test/integration/providers.test.ts` (the plugin answers `_typesugar.showTransformed`).
They use `test-fixtures/sample-project/`.

## License

MIT
