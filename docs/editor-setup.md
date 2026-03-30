# Editor Setup

typesugar provides a standalone LSP server (`@typesugar/lsp-server`) that works with any editor supporting the Language Server Protocol.

## Prerequisites

Install the LSP server in your project:

```bash
npm install --save-dev @typesugar/lsp-server
```

Or globally:

```bash
npm install -g @typesugar/lsp-server
```

The server binary is `typesugar-lsp` and communicates over stdio.

---

## Neovim

### Using nvim-lspconfig

Add to your Neovim configuration (e.g., `~/.config/nvim/lua/plugins/typesugar.lua`):

```lua
local lspconfig = require('lspconfig')
local configs = require('lspconfig.configs')

-- Register the typesugar language server
if not configs.typesugar then
  configs.typesugar = {
    default_config = {
      cmd = { 'typesugar-lsp', '--stdio' },
      filetypes = { 'sugared-typescript', 'sugared-typescriptreact', 'typescript', 'typescriptreact' },
      root_dir = lspconfig.util.root_pattern('typesugar.manifest.json', 'tsconfig.json', 'package.json'),
    },
  }
end

lspconfig.typesugar.setup{}
```

### Filetype detection

Add to `~/.config/nvim/filetype.lua`:

```lua
vim.filetype.add({
  extension = {
    sts = 'sugared-typescript',
    stsx = 'sugared-typescriptreact',
  },
})
```

### Treesitter (syntax highlighting)

`.sts` files use TypeScript syntax. Map them to the TypeScript parser:

```lua
vim.treesitter.language.register('typescript', 'sugared-typescript')
vim.treesitter.language.register('tsx', 'sugared-typescriptreact')
```

---

## Helix

Add to `~/.config/helix/languages.toml`:

```toml
[language-server.typesugar-lsp]
command = "typesugar-lsp"
args = ["--stdio"]

[[language]]
name = "sugared-typescript"
scope = "source.sts"
injection-regex = "sts"
file-types = ["sts"]
roots = ["typesugar.manifest.json", "tsconfig.json", "package.json"]
language-servers = ["typesugar-lsp"]
grammar = "typescript"
comment-token = "//"
indent = { tab-width = 2, unit = "  " }

[[language]]
name = "sugared-typescriptreact"
scope = "source.stsx"
injection-regex = "stsx"
file-types = ["stsx"]
roots = ["typesugar.manifest.json", "tsconfig.json", "package.json"]
language-servers = ["typesugar-lsp"]
grammar = "tsx"
comment-token = "//"
indent = { tab-width = 2, unit = "  " }
```

---

## Zed

### 1. Install the extension

Install the typesugar Zed extension from the extension marketplace, or as a dev extension:

- `cmd+shift+p` → "zed: install dev extension" → select the `packages/zed/` directory

Or build from source:

```bash
cd packages/zed
cargo build --target wasm32-wasip1 --release
```

### 2. Configure language servers

**Important:** Zed runs its built-in TypeScript language server alongside typesugar-lsp. The built-in server doesn't understand macros and will report false errors. You need to disable it for TypeScript files.

Add to your project's `.zed/settings.json` (or global Zed settings via `cmd+,`):

```json
{
  "languages": {
    "TypeScript": {
      "language_servers": ["typesugar-lsp", "!typescript-language-server", "!vtsls"]
    },
    "TSX": {
      "language_servers": ["typesugar-lsp", "!typescript-language-server", "!vtsls"]
    }
  }
}
```

The `!` prefix disables a language server. This makes typesugar-lsp the sole TypeScript language server, which provides all standard TS features (diagnostics, completions, hover, go-to-definition, rename, etc.) plus macro-aware features (semantic tokens, codelens, inlay hints, macro expansion).

### 3. Ensure the LSP server is installed

```bash
npm install --save-dev @typesugar/lsp-server
```

The extension finds the server at `node_modules/@typesugar/lsp-server/dist/server.js` and runs it via `node`.

---

## VS Code

Install the `typesugar` extension from the VS Code marketplace. It bundles the LSP server and starts it automatically.

---

## Features available in all editors

| Feature          | Description                                           |
| ---------------- | ----------------------------------------------------- |
| Diagnostics      | Type errors + macro expansion errors                  |
| Completions      | TypeScript completions + extension method completions |
| Hover            | Type information on hover                             |
| Go to definition | Navigate to symbol definitions                        |
| Type definition  | Navigate to type definitions                          |
| Find references  | Find all references to a symbol                       |
| Rename           | Rename symbols across files                           |
| Signature help   | Function parameter hints                              |
| Semantic tokens  | Macro-aware syntax highlighting                       |
| CodeLens         | Inline macro expansion previews                       |
| Inlay hints      | Comptime results and bind variable types              |
| Code actions     | Expand macro, wrap in comptime, add @derive           |
