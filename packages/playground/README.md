# @typesugar/playground

> 📖 **Full documentation:** [Interactive Playground](https://typesugar.org/playground). The microsite is the canonical reference; this README is a quickstart.

Browser-compatible bundle for the typesugar interactive playground.

## Features

- **Browser-compatible**: Runs entirely in the browser without Node.js
- **Macro transformation**: Expand typesugar macros at compile time
- **In-memory caching**: LRU cache for fast repeated transformations
- **TypeScript transformer**: Uses TypeScript's transformer API

## Installation

```bash
npm install @typesugar/playground
```

## Usage

```typescript
import { transform } from "@typesugar/playground";

// Transform TypeScript with macros
const result = transform(`
  import { staticAssert } from "typesugar";
  staticAssert(1 + 1 === 2);
`);

console.log(result.code);
console.log(result.diagnostics);
```

## API

### `transform(code, options?)`

Transform TypeScript code with typesugar macros.

**Options:**

- `fileName?: string` - File name used for diagnostics and the HKT rewrite
- `verbose?: boolean` - Enable verbose logging
- `cacheSize?: number` - Maximum cache entries (default: 100)

**Returns:** `TransformResult`

- `original: string` - Original source code
- `code: string` - Transformed code
- `sourceMap: RawSourceMap | null` - Source map
- `changed: boolean` - Whether the code was modified
- `diagnostics: TransformDiagnostic[]` - Any errors or warnings
- `preprocessed?: boolean` - Whether preprocessing was applied

### `preprocessCode(code, options?)`

Preprocess code with custom syntax (pipeline `|>`, HKT `F<_>`, cons `::`).

### `clearCache()`

Clear the transformation cache.

### `getCacheStats()`

Get cache statistics as a string.

## Limitations

The browser playground has some limitations compared to the full transformer:

1. **No file system access**: `includeStr()`, `includeJson()`, and `includeBytes()` macros are not available
2. **Limited type checking**: Type-aware macros may have reduced functionality without a full project context

## Bundle Size

The browser bundle includes:

- `@typesugar/core` - Macro registry and context
- `@typesugar/macros` - Built-in macro implementations

TypeScript itself is a peer dependency and must be loaded separately.

## License

MIT
