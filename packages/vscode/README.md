# @ttfx/vscode

> VSCode/Cursor IDE extension for ttfx macro development.

## Overview

`@ttfx/vscode` provides IDE support for ttfx macros: syntax highlighting, expansion previews, inline hints, code actions, and diagnostics — all powered by a manifest-driven architecture that automatically adapts to your project's macros.

## Features

### Semantic Token Highlighting

- **Macro invocations** — Expression macros, decorators, tagged templates
- **Extension methods** — Typeclass implicit extension methods
- **Comprehension syntax** — `let:`, `yield:`, `par:`, `<<` operators
- **Bind variables** — Variables bound in comprehension blocks

### CodeLens — Expansion Previews

See what your macros expand to without running the build:

```typescript
// ▶ Expands to: const x = 120;
const x = comptime(() => {
  let r = 1;
  for (let i = 1; i <= 5; i++) r *= i;
  return r;
});
```

### Inlay Hints

- **Bind variable types** in comprehensions: `user: User`
- **Comptime results** inline: `= 120`

### Code Actions

- **Expand macro** — Replace macro call with its expansion
- **Wrap in comptime** — Convert expression to compile-time evaluation
- **Add @derive** — Quick-pick to add derive macros

### Diagnostics

- Background transformer runs on save
- Macro-specific errors with rich related info
- Points to the exact macro invocation, not internal code

### Status Bar

Shows macro count with one-click manifest refresh.

## Installation

### From Marketplace

Search for "ttfx" in the VSCode/Cursor extensions panel.

### From VSIX

```bash
# In the ttfx repo
cd packages/vscode
pnpm run package
code --install-extension ttfx-*.vsix
```

## Configuration

The extension reads from `ttfx.manifest.json` in your workspace root. Generate it with:

```bash
npx ttfx build --manifest
```

The manifest contains all macro names, types, and metadata. The extension watches this file and hot-reloads when it changes.

### Settings

| Setting                  | Description                | Default |
| ------------------------ | -------------------------- | ------- |
| `ttfx.enableCodeLens`    | Show expansion previews    | `true`  |
| `ttfx.enableInlayHints`  | Show inline type hints     | `true`  |
| `ttfx.enableDiagnostics` | Run background transformer | `true`  |

## Commands

| Command                 | Description                    |
| ----------------------- | ------------------------------ |
| `ttfx.expandMacro`      | Expand macro at cursor         |
| `ttfx.refreshManifest`  | Reload the manifest file       |
| `ttfx.generateManifest` | Run `ttfx build --manifest`    |
| `ttfx.addDerive`        | Add @derive to interface/class |

## Manifest Format

```json
{
  "version": 1,
  "macros": {
    "expression": {
      "comptime": {
        "module": "@ttfx/comptime",
        "description": "Compile-time evaluation"
      }
    },
    "decorator": {
      "derive": {
        "module": "@ttfx/derive",
        "args": [
          "Eq",
          "Ord",
          "Clone",
          "Debug",
          "Hash",
          "Default",
          "Json",
          "Builder"
        ]
      },
      "operators": {
        "module": "@ttfx/operators"
      }
    },
    "taggedTemplate": {
      "sql": {
        "module": "@ttfx/sql",
        "contentType": "sql"
      }
    },
    "labeledBlock": {
      "let": {
        "continuations": ["yield", "pure"]
      },
      "par": {
        "continuations": ["yield"]
      }
    }
  },
  "extensionMethods": {
    "Show": ["show"],
    "Eq": ["equals"]
  }
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      VSCode Extension                        │
├─────────────┬─────────────┬──────────────┬─────────────────┤
│  Semantic   │  CodeLens   │  Inlay Hints │  Code Actions   │
│   Tokens    │  Provider   │   Provider   │    Provider     │
├─────────────┴─────────────┴──────────────┴─────────────────┤
│                    Manifest Loader                          │
│              (watches ttfx.manifest.json)                   │
├─────────────────────────────────────────────────────────────┤
│                   Expansion Service                         │
│           (runs transformer for previews)                   │
└─────────────────────────────────────────────────────────────┘
```

## Development

```bash
# Install dependencies
pnpm install

# Compile
pnpm run compile

# Watch mode
pnpm run watch

# Package VSIX
pnpm run package

# Run tests
pnpm run test
```

## License

MIT
