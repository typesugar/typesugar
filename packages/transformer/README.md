# @typesugar/transformer

> 📖 **Full documentation:** [Getting Started](https://typesugar.org/getting-started/). The microsite is the canonical reference; this README is a quickstart.

> TypeScript transformer for typesugar macro expansion.

## Overview

`@typesugar/transformer` is the core transformation engine of typesugar. It runs inside the bundler plugins (`unplugin-typesugar`, `withTypesugar()` from `typesugar/tsup`), the `typesugar` CLI (`typesugar build`, `check`, `run`), and the Node loader (`typesugar/register`), expanding macro invocations into optimized JavaScript code during compilation.

**You need this package if you're configuring the build pipeline directly.** Most users should use `unplugin-typesugar` for bundler-specific plugins or configure via `typesugar`.

## Installation

```bash
npm install @typesugar/transformer
# or
pnpm add @typesugar/transformer
```

## Configuration

### tsc-style builds

A plain `tsc` doesn't expand macros. Use the `typesugar` CLI in its place: it reads the
same `tsconfig.json`, expands macros, and emits `.js` and `.d.ts` files from the
expanded program.

```bash
npx typesugar build   # in place of tsc
npx typesugar check   # in place of tsc --noEmit
```

See [tsc Setup](https://typesugar.org/getting-started/environments/tsc).

### With ts-patch (alternative)

If you need `tsc` itself to expand macros, [ts-patch](https://github.com/nonara/ts-patch)
can run the transformer as a `tsconfig.json` plugin:

```bash
npm install -D ts-patch
npx ts-patch install
```

```json
{
  "compilerOptions": {
    "plugins": [{ "transform": "@typesugar/transformer", "type": "program" }]
  }
}
```

A patched `tsc` type-checks the **unexpanded** source and emits `.d.ts` files from it, so a
library should still emit its declarations with `typesugar build` (see
[Declarations](https://typesugar.org/getting-started/environments/tsc#declarations)).

### In Node (scripts, tsx, `node --test`)

```bash
node --import @typesugar/transformer/register src/main.ts   # or typesugar/register
node --import @typesugar/transformer/register --test "src/**/*.test.ts"
```

Node module hooks expand each TypeScript module before it runs, alone (Node 22.18+ /
23.6+) or with tsx. See [Node.js, tsx and node:test](https://typesugar.org/getting-started/environments/node).

### Transformer Options

```typescript
interface MacroTransformerConfig {
  /** Enable verbose logging */
  verbose?: boolean;

  /** Conditional compilation configuration (for cfg/cfgAttr macros) */
  cfgConfig?: Record<string, unknown>;

  /** Enable expansion tracking for source maps and diagnostics */
  trackExpansions?: boolean;

  /**
   * Directory for the disk-backed macro expansion cache.
   * Set to `false` to disable caching entirely.
   * Defaults to `.typesugar-cache`.
   */
  cacheDir?: string | false;
}
```

There is no option for naming macro modules. Macro packages are found through the
`typesugar.macros` field in their own `package.json` when a compiled file imports them;
see [Publishing Macros](https://typesugar.org/writing-macros/publishing-macros#getting-discovered).

**Example tsconfig.json:**

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "transform": "@typesugar/transformer",
        "verbose": true,
        "cacheDir": ".typesugar-cache"
      }
    ]
  }
}
```

## How It Works

The transformer processes TypeScript source files during compilation:

1. **Import Resolution** — Traces imports to their origin modules to determine which identifiers are macros
2. **Macro Expansion** — Expands expression macros, attribute macros, derive macros, tagged templates, type macros, and labeled block macros
3. **Import Cleanup** — Removes imports that only brought macro placeholders into scope
4. **Diagnostics** — Reports errors and warnings through the TypeScript diagnostic pipeline

### Supported Macro Types

| Type            | Trigger           | Example                        |
| --------------- | ----------------- | ------------------------------ |
| Expression      | Function call     | `comptime(() => 1 + 1)`        |
| Attribute       | Decorator         | `@typeclass`, `@derive`        |
| Derive          | `@derive()`       | `@derive(Eq, Clone)`           |
| Tagged Template | Template literal  | `` sql`SELECT * FROM users` `` |
| Type            | Type reference    | `type X = Add<1, 2>`           |
| Labeled Block   | Labeled statement | `let: { x << expr }`           |

## CLI Usage

The transformer includes a CLI for direct usage:

```bash
# Build TypeScript files with macro expansion
npx typesugar build

# Build with disk cache (faster incremental builds)
npx typesugar build --cache

# Build with strict mode (typecheck expanded output)
npx typesugar build --strict

# Only the .d.ts files, from the expanded program (after a bundler built the JS)
npx typesugar build --emitDeclarationOnly --declarationDir dist

# Watch mode (automatically reuses state across rebuilds)
npx typesugar watch

# Type-check only (no emit)
npx typesugar check

# Show expanded output (like cargo expand)
npx typesugar expand src/file.ts

# Run a file directly (like ts-node but with macros)
npx typesugar run src/script.ts

# Run with cache (useful when iterating)
npx typesugar run src/script.ts --cache
```

### CLI Options

| Option            | Description                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `--cache [dir]`   | Enable disk cache for faster rebuilds (default: `.typesugar-cache/transforms`) [build/run] |
| `--no-cache`      | Disable disk cache                                                                         |
| `--strict`        | Typecheck expanded output (catches macro bugs) [build/check]                               |
| `--verbose`, `-v` | Enable verbose logging                                                                     |
| `--project`, `-p` | Path to tsconfig.json                                                                      |

See [Performance Architecture](../../docs/PERFORMANCE.md) for details on caching and optimization.

## Programmatic Usage

```typescript
import macroTransformerFactory from "@typesugar/transformer";
import * as ts from "typescript";

const program = ts.createProgram(["src/index.ts"], {
  // compiler options
});

const transformer = macroTransformerFactory(program, {
  verbose: true,
});

// Use with ts.transform() or a custom emit pipeline
```

`emitDeclarations({ project, declarationDir })` writes `.d.ts` files from the expanded
program, as `typesugar build --emitDeclarationOnly` does.

## Import-Scoped Macro Resolution

The transformer uses TypeScript's type checker to resolve macro identifiers:

```typescript
// Direct import
import { comptime } from "typesugar";
comptime(() => 1 + 1); // ✓ Expanded

// Renamed import
import { comptime as ct } from "typesugar";
ct(() => 1 + 1); // ✓ Expanded (follows alias)

// Barrel re-export
// utils.ts: export { comptime } from "typesugar";
import { comptime } from "./utils";
comptime(() => 1 + 1); // ✓ Expanded (follows re-export chain)

// Not a macro (different module)
function comptime(fn: () => number) {
  return fn();
}
comptime(() => 1 + 1); // ✗ Not expanded (not from macro module)
```

## License

MIT
