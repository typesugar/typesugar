# @typesugar/playground

Browser-compatible bundle for the typesugar interactive playground.

## Features

- **Browser-compatible**: Runs entirely in the browser without Node.js
- **Preprocessor support**: Transform `.sts` files with custom syntax (HKT, pipeline, cons)
- **Macro transformation**: Expand typesugar macros at compile time
- **In-memory caching**: LRU cache for fast repeated transformations
- **TypeScript backend**: Uses TypeScript's transformer API (no oxc dependency)

## Installation

```bash
npm install @typesugar/playground
```

## Usage

```typescript
import { transform, preprocess } from "@typesugar/playground";

// Transform TypeScript with macros
const result = transform(`
  import { staticAssert } from "typesugar";
  staticAssert(1 + 1 === 2);
`);

console.log(result.code);
console.log(result.diagnostics);

// Preprocess .sts files (custom syntax)
const { code, changed } = preprocess(`const result = x |> f |> g;`, { fileName: "test.sts" });
```

## API

### `transform(code, options?)`

Transform TypeScript code with typesugar macros.

**Options:**

- `fileName?: string` - File name (affects preprocessing for `.sts` files)
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
2. **TypeScript backend only**: The oxc backend is not available in the browser
3. **Limited type checking**: Type-aware macros may have reduced functionality without a full project context

## Bundle Size

The browser bundle includes:

- `@typesugar/preprocessor` - Custom syntax transforms
- `@typesugar/core` - Macro registry and context
- `@typesugar/macros` - Built-in macro implementations

TypeScript itself is a peer dependency and must be loaded separately.

## License

MIT
