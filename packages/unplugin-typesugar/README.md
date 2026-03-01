# unplugin-typesugar

> Bundler integrations for typesugar macro expansion.

## Overview

`unplugin-typesugar` provides plugins for popular bundlers to process typesugar macros during your build. Powered by [unplugin](https://github.com/unjs/unplugin) for maximum compatibility.

## Installation

```bash
npm install unplugin-typesugar
# or
pnpm add unplugin-typesugar
```

## Vite

```typescript
// vite.config.ts
import typesugar from "unplugin-typesugar/vite";

export default {
  plugins: [typesugar()],
};
```

## Webpack

```typescript
// webpack.config.js
const typesugar = require("unplugin-typesugar/webpack").default;

module.exports = {
  plugins: [typesugar()],
};
```

## esbuild

```typescript
// build.js
import esbuild from "esbuild";
import typesugar from "unplugin-typesugar/esbuild";

await esbuild.build({
  entryPoints: ["src/index.ts"],
  plugins: [typesugar()],
  bundle: true,
  outfile: "dist/index.js",
});
```

## Rollup

```typescript
// rollup.config.js
import typesugar from "unplugin-typesugar/rollup";

export default {
  input: "src/index.ts",
  plugins: [typesugar()],
  output: {
    file: "dist/index.js",
    format: "esm",
  },
};
```

## Configuration

All plugins accept the same options:

```typescript
interface TypesugarPluginOptions {
  /** Path to tsconfig.json (default: auto-detected) */
  tsconfig?: string;

  /** File patterns to include (default: /\.[jt]sx?$/) */
  include?: RegExp | string[];

  /** File patterns to exclude (default: /node_modules/) */
  exclude?: RegExp | string[];

  /** Enable verbose logging */
  verbose?: boolean;

  /** Syntax extensions to enable (default: all) */
  extensions?: ("hkt" | "pipeline" | "cons")[];

  /** Enable disk-backed transform cache for faster rebuilds */
  diskCache?: boolean | string;

  /** Enable strict mode - typecheck expanded output at build end */
  strict?: boolean;
}
```

### Example with Options

```typescript
// vite.config.ts
import typesugar from "unplugin-typesugar/vite";

export default {
  plugins: [
    typesugar({
      verbose: true,
      include: /src\/.*\.tsx?$/,
      exclude: /\.test\.ts$/,
      diskCache: true, // Enable disk cache for faster rebuilds
      strict: true, // Typecheck expanded output
    }),
  ],
};
```

## How It Works

The integration plugins:

1. **Intercept** TypeScript files during the build
2. **Create a TypeScript program** with the typesugar transformer
3. **Expand macros** at compile time
4. **Emit transformed code** to the bundler

This means macros are fully expanded before your code reaches the bundler's optimization pipeline.

## API Reference

### Exports

- `unplugin-typesugar/vite` — Vite plugin
- `unplugin-typesugar/webpack` — Webpack plugin
- `unplugin-typesugar/esbuild` — esbuild plugin
- `unplugin-typesugar/rollup` — Rollup plugin
- `unplugin-typesugar` — Core unplugin factory

### Types

```typescript
interface TypesugarPluginOptions {
  tsconfig?: string;
  include?: RegExp | string[];
  exclude?: RegExp | string[];
  verbose?: boolean;
  extensions?: ("hkt" | "pipeline" | "cons")[];
  diskCache?: boolean | string;
  strict?: boolean;
}
```

See [Performance Architecture](../../docs/PERFORMANCE.md) for details on caching and strict mode.

## License

MIT
