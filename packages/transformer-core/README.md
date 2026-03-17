# @typesugar/transformer-core

Browser-compatible transformation core for typesugar macro expansion.

## Overview

This package provides the core macro transformation logic with **zero Node.js dependencies**. It can run in any JavaScript environment: browsers, Node.js, Deno, Bun, Web Workers, etc.

The main `@typesugar/transformer` package depends on this for the actual transformation logic, while adding Node.js-specific features like file caching, macro package loading, and ts-patch integration.

```
@typesugar/transformer-core    ← Pure transformation (this package)
          ↑
@typesugar/transformer         ← Node.js plugin (ts-patch, caching, CLI)
@typesugar/playground          ← Browser bundle (interactive playground)
```

## Installation

```bash
pnpm add @typesugar/transformer-core
```

## Usage

### Basic Usage

```typescript
import { transformCode } from "@typesugar/transformer-core";
import "@typesugar/macros"; // Register built-in macros

const result = transformCode(`
  import { staticAssert } from "@typesugar/macros";
  staticAssert<true>();
`);

console.log(result.code); // Transformed code
console.log(result.changed); // true if any macros were expanded
console.log(result.diagnostics); // Any errors or warnings
```

### With Options

```typescript
const result = transformCode(code, {
  fileName: "my-file.ts", // For diagnostics and source maps
  verbose: true, // Log macro expansions
  trackExpansions: true, // Include expansion records in result
  compilerOptions: {
    // Custom TypeScript options
    strict: true,
  },
});
```

### Using MacroTransformer Directly

For advanced use cases, you can use `MacroTransformer` directly:

```typescript
import * as ts from "typescript";
import { MacroTransformer } from "@typesugar/transformer-core";
import { MacroContextImpl, HygieneContext } from "@typesugar/core";

const transformer = new MacroTransformer(ctx, verbose, expansionTracker);
const result = ts.visitNode(sourceFile, transformer.visit.bind(transformer));
```

## API

### `transformCode(code, options?)`

Transform TypeScript/JavaScript code with macro expansion.

**Parameters:**

- `code: string` — Source code to transform
- `options?: TransformCodeOptions` — Optional configuration

**Returns:** `TransformCodeResult`

```typescript
interface TransformCodeResult {
  original: string; // Original source code
  code: string; // Transformed code
  sourceMap: RawSourceMap | null; // Source map for debugging
  mapper: PositionMapper; // Map positions between original/transformed
  changed: boolean; // Whether any macros were expanded
  diagnostics: TransformDiagnostic[]; // Errors and warnings
  expansions?: ExpansionRecord[]; // If trackExpansions enabled
}
```

### `MacroTransformer`

The core transformation visitor class. Handles all macro types:

- Expression macros (`staticAssert()`, `comptime()`, `pipe()`)
- Attribute macros (`@tailrec`, `@derive`)
- JSDoc macros (`@typeclass`, `@impl`, `@derive`)
- Derive macros (trait generation)
- Tagged template macros

### Source Map Utilities

```typescript
import {
  composeSourceMaps,
  decodeSourceMap,
  findOriginalPosition,
  findGeneratedPosition,
  createPositionMapper,
} from "@typesugar/transformer-core";
```

## Browser Compatibility

This package has no Node.js dependencies:

- ✅ No `fs` — in-memory file system
- ✅ No `path` — path operations abstracted
- ✅ No `process` — environment detection via feature checks
- ✅ Tree-shakeable — unused code eliminated by bundlers

The package is used by `@typesugar/playground` to power the interactive playground on the documentation site.

## License

MIT
