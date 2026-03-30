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

Install the typesugar Zed extension from the extension marketplace, or build from source:

```bash
cd packages/zed
cargo build --target wasm32-wasip1 --release
```

The extension automatically:

- Recognizes `.sts` and `.stsx` files
- Starts `typesugar-lsp` from your project's `node_modules/.bin/`
- Provides syntax highlighting via tree-sitter-typescript

Ensure `@typesugar/lsp-server` is installed in your project.

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
