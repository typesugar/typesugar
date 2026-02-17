# @ttfx/transformer

> TypeScript transformer for ttfx macro expansion.

## Overview

`@ttfx/transformer` is the core transformation engine of ttfx. It integrates with the TypeScript compiler (via ts-patch or bundler plugins) to process macro invocations during compilation, expanding them into optimized JavaScript code.

**You need this package if you're configuring the build pipeline directly.** Most users should use `@ttfx/integrations` for bundler-specific plugins or configure via `ttfx`.

## Installation

```bash
npm install @ttfx/transformer
# or
pnpm add @ttfx/transformer
```

## Configuration

### With ts-patch (for tsc users)

1. Install ts-patch:

   ```bash
   npm install -D ts-patch
   npx ts-patch install
   ```

2. Configure `tsconfig.json`:
   ```json
   {
     "compilerOptions": {
       "plugins": [{ "transform": "@ttfx/transformer" }]
     }
   }
   ```

### Transformer Options

```typescript
interface MacroTransformerConfig {
  /** Enable verbose logging */
  verbose?: boolean;

  /** Custom macro module paths to load */
  macroModules?: string[];
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
| Attribute       | Decorator         | `@operators class Vec { }`     |
| Derive          | `@derive()`       | `@derive(Eq, Clone)`           |
| Tagged Template | Template literal  | `` sql`SELECT * FROM users` `` |
| Type            | Type reference    | `type X = Add<1, 2>`           |
| Labeled Block   | Labeled statement | `let: { x << expr }`           |

## CLI Usage

The transformer includes a CLI for direct usage:

```bash
# Build TypeScript files with macro expansion
npx ttfx build

# Watch mode
npx ttfx watch

# Type-check only (no emit)
npx ttfx check

# Show expanded output (like cargo expand)
npx ttfx expand src/file.ts
```

## Programmatic Usage

```typescript
import macroTransformerFactory from "@ttfx/transformer";
import * as ts from "typescript";

const program = ts.createProgram(["src/index.ts"], {
  // compiler options
});

const transformer = macroTransformerFactory(program, {
  verbose: true,
});

// Use with ts.transform() or a custom emit pipeline
```

## Import-Scoped Macro Resolution

The transformer uses TypeScript's type checker to resolve macro identifiers:

```typescript
// Direct import
import { comptime } from "ttfx";
comptime(() => 1 + 1); // ✓ Expanded

// Renamed import
import { comptime as ct } from "ttfx";
ct(() => 1 + 1); // ✓ Expanded (follows alias)

// Barrel re-export
// utils.ts: export { comptime } from "ttfx";
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
