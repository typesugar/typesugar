# @typesugar/vscode

> VSCode/Cursor IDE extension for typesugar macro development.

## Overview

`@typesugar/vscode` provides IDE support for typesugar macros: syntax highlighting, expansion previews, inline hints, code actions, and diagnostics — all powered by a manifest-driven architecture that automatically adapts to your project's macros.

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

Search for "typesugar" in the VSCode/Cursor extensions panel.

### From VSIX

```bash
# In the typesugar repo
cd packages/vscode
pnpm run package
code --install-extension typesugar-*.vsix
```

## Configuration

The extension reads from `typesugar.manifest.json` in your workspace root. Generate it with:

```bash
npx typesugar build --manifest
```

The manifest contains all macro names, types, and metadata. The extension watches this file and hot-reloads when it changes.

### Settings

| Setting                       | Description                | Default |
| ----------------------------- | -------------------------- | ------- |
| `typesugar.enableCodeLens`    | Show expansion previews    | `true`  |
| `typesugar.enableInlayHints`  | Show inline type hints     | `true`  |
| `typesugar.enableDiagnostics` | Run background transformer | `true`  |

## Commands

| Command                      | Description                      |
| ---------------------------- | -------------------------------- |
| `typesugar.expandMacro`      | Expand macro at cursor           |
| `typesugar.refreshManifest`  | Reload the manifest file         |
| `typesugar.generateManifest` | Run `typesugar build --manifest` |
| `typesugar.addDerive`        | Add @derive to interface/class   |

## Manifest Format

```json
{
  "version": 1,
  "macros": {
    "expression": {
      "comptime": {
        "module": "@typesugar/comptime",
        "description": "Compile-time evaluation"
      }
    },
    "decorator": {
      "derive": {
        "module": "@typesugar/derive",
        "args": ["Eq", "Ord", "Clone", "Debug", "Hash", "Default", "Json", "Builder"]
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

# Compile
pnpm run compile

# Watch mode
pnpm run watch

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
pnpm --filter @typesugar/vscode test:unit

# Watch mode
pnpm --filter @typesugar/vscode test:watch
```

Test files: `test/manifest.test.ts`, `test/semantic-tokens.test.ts`, `test/codelens-inlay.test.ts`, `test/expansion.test.ts`, `test/error-scenarios.test.ts`

### Integration Tests (@vscode/test-cli)

Tests run in a VS Code Extension Development Host with the real VS Code API:

```bash
# Run integration tests (requires display or xvfb)
pnpm --filter @typesugar/vscode test:integration

# On Linux CI (headless)
xvfb-run -a pnpm --filter @typesugar/vscode test:integration
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
