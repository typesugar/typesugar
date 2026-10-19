# Editor Setup

typesugar's editor support is a **TypeScript server plugin**, `@typesugar/transformer/language-service`.
It runs inside your editor's own TypeScript server (tsserver), serves macro-expanded code to
TypeScript, and maps every position back to your source. Diagnostics (TypeScript's and
typesugar's TS9xxx), completions, hover, go-to-definition, references, rename, signature help and
quick fixes then work through macros in any editor whose TypeScript support is tsserver-based.

The plugin is the only supported editor engine in 1.0. The standalone `@typesugar/lsp-server` is
not supported in 1.0.

## Set up the project (every editor)

1. Install the transformer as a direct devDependency, so the TypeScript server can find the
   plugin in your project's `node_modules` (with pnpm, a transitive install through `typesugar`
   is not enough):

   ```bash
   npm install --save-dev @typesugar/transformer
   ```

2. Add the plugin to `tsconfig.json`:

   ```json
   {
     "compilerOptions": {
       "plugins": [{ "name": "@typesugar/transformer/language-service" }]
     }
   }
   ```

   Plugins in `tsconfig.json` only affect editors; `tsc` ignores them. Use the same `name`
   everywhere. The VS Code extension registers the same engine under the wrapper name
   `@typesugar/ts-plugin`; you don't need to list that one.

3. Make the editor use the project's TypeScript (`node_modules/typescript`), not one bundled with
   the editor. TypeScript looks for `tsconfig.json` plugins next to the TypeScript it runs from,
   so with a bundled TypeScript the plugin isn't found. The sections below say how per editor.

The plugin's only option is `"verbose": true` (or `TYPESUGAR_VERBOSE=1` in the TypeScript
server's environment), which logs what it does to the TypeScript server log.

::: warning TypeScript 7
TypeScript 7 (the native port) has no tsserver plugin API, so typesugar's editor support doesn't
work with it yet. Use TypeScript 6 (or 5.x) as typesugar's `typescript` devDependency. On
TypeScript 7 the plugin refuses to load with a
["TypeScript 7.x is not supported"](./troubleshooting.md#typescript-7) message.
:::

## VS Code / Cursor

Install the typesugar extension:

1. Open Extensions (Cmd/Ctrl+Shift+X)
2. Search for "typesugar"
3. Click Install

Or from the command line:

```bash
code --install-extension typesugar.typesugar-vscode
```

The extension bundles the plugin and registers it with VS Code's TypeScript server, so the
language features work without the `tsconfig.json` entry and with either VS Code's TypeScript or
the workspace version. If `tsconfig.json` does list the plugin (for other editors on your team),
the project's installed copy is used and the bundled one stands down; to use the project's copy,
select the workspace TypeScript ("TypeScript: Select TypeScript Version" → "Use Workspace
Version", or `"typescript.tsdk": "node_modules/typescript/lib"` in `.vscode/settings.json`).

The extension adds:

- **typesugar: Expand Macro at Cursor**: opens the expansion of the macro under the cursor in a
  side editor.
- **typesugar: Show Transformed Source**: a diff of the file against what TypeScript sees after
  expansion.
- **Inlay hints** after expression-macro calls, showing the expansion
  (`fieldNames<User>()  = ["id", "name"]`). VS Code only asks the TypeScript server for inlay
  hints when at least one `typescript.inlayHints.*` setting is on, for example
  `"typescript.inlayHints.variableTypes.enabled": true`.
- Syntax highlighting for `let:`/`yield:` blocks, the `<<` bind operator, `comptime` and unit
  literals.

Both commands are in the command palette and in the editor's context menu.

One setting:

```json
{
  // Evaluate comptime(...) blocks in the editor (trusted workspaces only).
  // Off by default: comptime code runs with the editor's privileges.
  "typesugar.comptimeInEditor": false
}
```

A repository can't turn `comptimeInEditor` on from its own `tsconfig.json`; only this setting or
`TYPESUGAR_COMPTIME_IN_EDITOR=1` in the editor's environment can. See
[Compile-Time Evaluation](../guides/comptime.md).

## Other editors

Other editors reach tsserver through
[`typescript-language-server`](https://github.com/typescript-language-server/typescript-language-server)
or [`vtsls`](https://github.com/yioneko/vtsls), and both load tsserver plugins. Set up the project
as above, then make sure the server uses the project's TypeScript. The snippets below follow each
editor's standard TypeScript configuration; we test the plugin itself and the VS Code extension,
not every editor's setup, so please [report](https://github.com/typesugar/typesugar/issues) what
works or doesn't. The expansion commands are VS Code only; elsewhere, run
`npx typesugar expand <file>` (add `--diff` for a diff).

### Neovim

**`ts_ls` (typescript-language-server)** loads `tsconfig.json` plugins and prefers the project's
`node_modules/typescript` when it exists, so the project setup is enough:

```lua
-- nvim-lspconfig
require("lspconfig").ts_ls.setup({})
-- Neovim 0.11+: vim.lsp.enable("ts_ls")
```

**vtsls** uses its bundled TypeScript unless told otherwise. Either let it use the workspace
version (the `tsconfig.json` entry is then picked up):

```lua
require("lspconfig").vtsls.setup({
  settings = {
    vtsls = { autoUseWorkspaceTsdk = true },
  },
})
```

or load the plugin as a global plugin, which works with the bundled TypeScript too.
`location` is the directory whose `node_modules` contains `@typesugar/transformer`:

```lua
require("lspconfig").vtsls.setup({
  settings = {
    vtsls = {
      tsserver = {
        globalPlugins = {
          {
            name = "@typesugar/transformer/language-service",
            location = vim.fn.getcwd(),
            enableForWorkspaceTypeScriptVersions = true,
          },
        },
      },
    },
  },
})
```

### Zed

Zed's TypeScript support uses vtsls by default. With the project setup above, tell vtsls to use
the workspace TypeScript in `.zed/settings.json`:

```json
{
  "lsp": {
    "vtsls": {
      "settings": {
        "vtsls": { "autoUseWorkspaceTsdk": true }
      }
    }
  }
}
```

The `globalPlugins` alternative from the Neovim section works here too, under
`lsp.vtsls.settings.vtsls.tsserver.globalPlugins`.

### Sublime Text

Install [LSP](https://packagecontrol.io/packages/LSP) and
[LSP-typescript](https://packagecontrol.io/packages/LSP-typescript) (typescript-language-server).
It uses the project's TypeScript when there is one, so the project setup is enough. To load the
plugin globally instead, add it in Preferences → Package Settings → LSP → Servers →
LSP-typescript:

```json
{
  "initializationOptions": {
    "plugins": [
      { "name": "@typesugar/transformer/language-service", "location": "/path/to/project" }
    ]
  }
}
```

### Helix

Helix runs `typescript-language-server` for TypeScript by default, which picks up the
`tsconfig.json` plugin from the project's TypeScript; the project setup is enough. To pass the
plugin explicitly, in `languages.toml`:

```toml
[language-server.typescript-language-server.config]
plugins = [{ name = "@typesugar/transformer/language-service", location = "/path/to/project" }]
```

### Emacs

Both **lsp-mode** (its `ts-ls` client) and **eglot** run `typescript-language-server`, which picks
up the `tsconfig.json` plugin from the project's TypeScript, so the project setup is enough. With
lsp-mode you can also register the plugin globally:

```elisp
(setq lsp-clients-typescript-plugins
      (vector (list :name "@typesugar/transformer/language-service"
                    :location "/path/to/project")))
```

### JetBrains IDEs (WebStorm, IntelliJ)

Unverified: it may work if WebStorm uses the project's TypeScript (Settings → Languages &
Frameworks → TypeScript → TypeScript: the project's `node_modules/typescript`), since WebStorm runs
tsserver for its TypeScript service. Please [report](https://github.com/typesugar/typesugar/issues)
whether it does. `typesugar check` and `typesugar expand <file>` work from the terminal either
way.

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
  typesugar.configs.recommended,

  // Your other configs...
];
```

### Full Transformer Mode

For maximum accuracy, use the full processor that runs the actual transformer:

```javascript
import typesugar from "@typesugar/eslint-plugin";

export default [
  typesugar.configs.full,
  // Your other configs...
];
```

The full mode is slower but catches more edge cases.

Each `configs.*` entry is a single flat-config object, so put it in the array as is
(spreading it with `...` throws "is not iterable"). The plugin needs ESLint 9 or
later; legacy `.eslintrc` configs are not supported.

### What the Plugin Does

The ESLint plugin solves a key problem: ESLint sees your source code before macro expansion. Without the plugin, you'd get false positives like:

- "`Eq` is not defined" (in `@derive(Eq)`)
- "`comptime` is not a function"
- "Expected 0 arguments, but got 1"

The plugin preprocesses your code so ESLint sees the expanded output.

## Prettier

typesugar works with Prettier out of the box — all source is standard TypeScript.

### Recommended Setup

```json
// .prettierrc
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "es5"
}
```

## Verify IDE Setup

### Check 1: No false errors

In a file with macros there should be no red squiggles on macro calls, and derived methods should
have proper types. In VS Code, **typesugar: Show Transformed Source** shows what TypeScript sees.

### Check 2: Go to Definition

For a derived method like `.equals()`, go-to-definition should work and point to your source or
the derive macro.

### Check 3: Autocomplete

Type `user.` on a derived class and check that autocomplete suggests the derived methods with
correct signatures.

## Troubleshooting

### Macros show as errors, or nothing is typesugar-aware

1. Check that the TypeScript server loaded the plugin: its log has `[typesugar]` lines (VS Code:
   "TypeScript: Open TS Server Log"; with `"verbose": true` in the plugin entry there are more).
2. Outside VS Code, check that the server uses the project's TypeScript and that
   `@typesugar/transformer` is a direct devDependency.
3. Check the TypeScript version: TypeScript 7 is not supported yet.
4. Restart the TypeScript server (VS Code: "TypeScript: Restart TS Server").

### "Cannot find name 'comptime'"

1. Ensure `typesugar` is installed
2. Add the import: `import { comptime } from "typesugar"`
3. Check that the plugin is loaded (above)

### No inlay hints

VS Code: turn on at least one `typescript.inlayHints.*` setting (and keep
`editor.inlayHints.enabled` on). Other editors: enable inlay hints in the editor and in the
TypeScript server's preferences.

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
