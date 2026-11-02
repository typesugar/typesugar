# typesugar-vscode

> 📖 **Full documentation:** [Editor Setup](https://typesugar.org/getting-started/editor-setup). The microsite is the canonical reference; this README is a quickstart.

> VSCode/Cursor IDE extension for typesugar macro development.

## Overview

The typesugar VS Code extension (package `typesugar-vscode`, private: it is not published to npm) provides IDE support for typesugar macros: syntax highlighting, expansion previews, inline hints, code actions, and diagnostics — all powered by a manifest-driven architecture that automatically adapts to your project's macros.

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

### From VSIX

```bash
# In the typesugar repo
cd packages/vscode
pnpm run package
code --install-extension typesugar-*.vsix
```

## Configuration

The extension knows typesugar's built-in macros out of the box. If your workspace has a
`typesugar.manifest.json` (path set by `typesugar.manifestPath`), the extension merges it
with the built-ins, watches it and hot-reloads when it changes. The manifest lists macro
names, types and metadata (format below).

There is currently no command that generates the manifest: `typesugar build` has no
`--manifest` flag, so the `typesugar.generateManifest` command does not produce one. Write
the file by hand if you need to describe your own macros.

### Settings

| Setting                       | Description                                           | Default                     |
| ----------------------------- | ----------------------------------------------------- | --------------------------- |
| `typesugar.enableCodeLens`    | Show expansion previews                               | `true`                      |
| `typesugar.enableInlayHints`  | Show inline type hints                                | `true`                      |
| `typesugar.enableDiagnostics` | Run background transformer                            | `true`                      |
| `typesugar.manifestPath`      | Manifest path, relative to the workspace root         | `"typesugar.manifest.json"` |
| `typesugar.comptimeInEditor`  | Evaluate `comptime(...)` in the editor (trusted only) | `false`                     |

## Commands

| Command                      | Description                                                        |
| ---------------------------- | ------------------------------------------------------------------ |
| `typesugar.expandMacro`      | Expand macro at cursor                                             |
| `typesugar.showTransformed`  | Show the transformed source in a diff view                         |
| `typesugar.refreshManifest`  | Reload the manifest file                                           |
| `typesugar.generateManifest` | Runs `typesugar build --manifest`, which doesn't exist yet (above) |
| `typesugar.addDerive`        | Add @derive to interface/class                                     |

## Manifest Format

```json
{
  "version": 1,
  "macros": {
    "expression": {
      "comptime": {
        "module": "@typesugar/macros",
        "description": "Compile-time evaluation"
      }
    },
    "decorator": {
      "derive": {
        "module": "@typesugar/derive",
        "args": ["Eq", "Ord", "Clone", "Debug", "Hash", "Default", "Json"]
      },
      "operators": {
        "module": "@typesugar/macros"
      }
    },
    "taggedTemplate": {
      "sql": {
        "module": "@typesugar/sql",
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
│              (watches typesugar.manifest.json)                   │
├─────────────────────────────────────────────────────────────┤
│                   Expansion Service                         │
│           (runs transformer for previews)                   │
└─────────────────────────────────────────────────────────────┘
```

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm run build

# Watch mode
pnpm run build:watch

# Package VSIX
pnpm run package

# Run tests
pnpm run test
```

## Development & Testing

The extension has a comprehensive test suite covering three layers:

### Unit Tests (vitest)

Tests run with mocked VS Code API, testing provider logic in isolation:

```bash
# Run unit tests
pnpm --filter typesugar-vscode test:unit

# Watch mode
pnpm --filter typesugar-vscode test:watch
```

Test files: `test/manifest.test.ts`, `test/semantic-tokens.test.ts`, `test/codelens-inlay.test.ts`, `test/expansion.test.ts`, `test/error-scenarios.test.ts`

### Integration Tests (@vscode/test-cli)

Tests run in a VS Code Extension Development Host with the real VS Code API:

```bash
# Run integration tests (requires display or xvfb)
pnpm --filter typesugar-vscode test:integration

# On Linux CI (headless)
xvfb-run -a pnpm --filter typesugar-vscode test:integration
```

Test files: `test/integration/activation.test.ts`, `test/integration/providers.test.ts`, `test/integration/commands.test.ts`

### Test Fixtures

The `test-fixtures/sample-project/` directory contains a minimal typesugar project used by both integration tests and as a reference for expected behavior:

- `typesugar.manifest.json` — Manifest with known macros
- `sample.ts` — Code exercising all macro types
- `no-macros.ts` — Plain TypeScript (negative test)
- `empty.ts` — Empty file (edge case)

## License

MIT
