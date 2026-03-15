# Editor Setup

This guide covers setting up your editor for the best typesugar development experience.

## VSCode / Cursor

### Install the Extension

Install the typesugar extension from the marketplace:

1. Open Extensions (Cmd/Ctrl+Shift+X)
2. Search for "typesugar"
3. Click Install

Or install from the command line:

```bash
code --install-extension typesugar.vscode-typesugar
```

### Extension Features

**Syntax Highlighting:**

- Macro invocations are highlighted distinctly
- Extension methods show their typeclass origin
- Comprehension syntax (`let:`, `yield:`, `<<`) gets special treatment

**CodeLens:**

- Inline expansion previews above macro calls
- Click to see the full expanded code

**Inlay Hints:**

- Bind variable types in comprehensions
- Compile-time evaluation results

**Code Actions:**

- "Expand macro" at cursor position
- "Wrap in comptime()"
- "Add @derive() decorator"

**Diagnostics:**

- Macro-specific errors with context
- Errors point to your source code, not generated code

### Extension Configuration

Open Settings (Cmd/Ctrl+,) and search for "typesugar":

```json
{
  // Show expansion previews as CodeLens
  "typesugar.enableCodeLens": true,

  // Show inlay hints for types
  "typesugar.enableInlayHints": true,

  // Show macro-specific diagnostics
  "typesugar.enableDiagnostics": true,

  // Path to manifest file (auto-generated)
  "typesugar.manifestPath": "typesugar.manifest.json"
}
```

### Language Service Plugin

For full IDE integration, add the language service plugin to `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "typesugar/language-service" }]
  }
}
```

This provides:

- Accurate type information for macro-generated code
- Proper go-to-definition for derived methods
- Autocomplete for typeclass methods

### Using Workspace TypeScript

Ensure VSCode uses the workspace TypeScript, not the built-in version:

1. Open a TypeScript file
2. Click the TypeScript version in the status bar (bottom right)
3. Select "Use Workspace Version"

Or add to `.vscode/settings.json`:

```json
{
  "typescript.tsdk": "node_modules/typescript/lib"
}
```

## ESLint

### Installation

```bash
npm install --save-dev @typesugar/eslint-plugin
```

### Configuration (eslint.config.js)

For the modern flat config format:

```javascript
import typesugar from "@typesugar/eslint-plugin";

export default [
  // Use the recommended config (lightweight, fast)
  ...typesugar.configs.recommended,

  // Your other configs...
];
```

### Full Transformer Mode

For maximum accuracy, use the full processor that runs the actual transformer:

```javascript
import typesugar from "@typesugar/eslint-plugin";

export default [
  ...typesugar.configs.full,
  // Your other configs...
];
```

The full mode is slower but catches more edge cases.

### What the Plugin Does

The ESLint plugin solves a key problem: ESLint sees your source code before macro expansion. Without the plugin, you'd get false positives like:

- "`Eq` is not defined" (in `@derive(Eq)`)
- "`comptime` is not a function"
- "Expected 0 arguments, but got 1"

The plugin preprocesses your code so ESLint sees the expanded output.

### Legacy .eslintrc Config

```json
{
  "extends": ["plugin:@typesugar/recommended"],
  "plugins": ["@typesugar"]
}
```

## Prettier

typesugar works with Prettier out of the box for standard TypeScript syntax. Custom syntax extensions (like `|>` or `::` operators) should be preprocessed before formatting.

### Recommended Setup

```json
// .prettierrc
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "es5"
}
```

## Other Editors

### Neovim

Use the TypeScript language server with the typesugar plugin configured in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "typesugar/language-service" }]
  }
}
```

Configure your LSP to use the workspace TypeScript:

```lua
-- init.lua (nvim-lspconfig)
require("lspconfig").tsserver.setup({
  init_options = {
    preferences = {
      includePackageJsonAutoImports = "on",
    },
    plugins = {
      { name = "typesugar/language-service" },
    },
  },
})
```

### JetBrains IDEs (WebStorm, IntelliJ)

JetBrains IDEs use their own TypeScript service and don't support TypeScript language service plugins directly.

For WebStorm users:

1. Configure the transformer in `tsconfig.json`
2. Use external tools for macro expansion: `typesugar expand <file>`
3. Type checking works, but some IDE features won't recognize derived methods

### Sublime Text

Use the LSP package with typescript-language-server:

1. Install Package Control
2. Install "LSP" and "LSP-typescript"
3. Configure to use workspace TypeScript
4. Add the language service plugin to `tsconfig.json`

## Verify IDE Setup

### Check 1: Expansion Preview

In a file with macros, you should see:

- CodeLens showing expansion previews (VSCode)
- No red squiggles on macro calls
- Proper types for derived methods

### Check 2: Go to Definition

For a derived method like `.equals()`:

- Go-to-definition should work
- It should point to the generated code or the derive macro

### Check 3: Autocomplete

Type `user.` on a derived class and verify:

- Autocomplete suggests derived methods
- Method signatures are correct

## Troubleshooting

### "Cannot find name 'comptime'"

1. Ensure `typesugar` is installed
2. Add the import: `import { comptime } from "typesugar"`
3. Check that the language service plugin is configured

### No CodeLens / Inlay Hints

1. Verify the extension is installed and enabled
2. Check extension settings are enabled
3. Restart the editor

### ESLint shows false positives

1. Install `@typesugar/eslint-plugin`
2. Add to your ESLint config
3. Restart ESLint server

### Slow IDE performance

1. Exclude `node_modules` and `dist` from TypeScript checking
2. Use project references for large codebases
3. Consider the lightweight ESLint processor instead of full mode

## Next Steps

- [Troubleshooting](./troubleshooting.md) for more common issues
- [Getting Started](./index.md) to continue setup
