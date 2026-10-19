# unplugin-typesugar

> 📖 **Full documentation:** [Getting Started (build tools)](https://typesugar.org/getting-started/). The microsite is the canonical reference; this README is a quickstart.

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

  /**
   * Files to transform: a RegExp, a glob, or an array of either (default: /\.[jt]sx?$/).
   * Globs (picomatch) match the absolute module path; a relative glob resolves against
   * the project root (Vite's `root`, else the working directory); `**`-prefixed globs
   * match anywhere. `include: []` transforms nothing.
   */
  include?: RegExp | string | Array<RegExp | string>;

  /**
   * Files to skip, in the same forms as `include`. Files under node_modules are
   * always skipped, unless an `include` pattern names node_modules.
   */
  exclude?: RegExp | string | Array<RegExp | string>;

  /** Enable verbose logging */
  verbose?: boolean;

  /** Enable disk-backed transform cache for faster rebuilds */
  diskCache?: boolean | string;

  /**
   * Typecheck the expanded output at build end, and fail the build on type errors.
   * `true`: every file, every build. `"incremental"`: only files whose macro output
   * changed (and their dependents); the first build is a full check.
   */
  strict?: boolean | "incremental";

  /** Conditions for cfg() / @cfgAttr conditional compilation, e.g. { debug: true } */
  cfgConfig?: Record<string, unknown>;
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
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["**/*.test.ts"],
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
  include?: RegExp | string | Array<RegExp | string>;
  exclude?: RegExp | string | Array<RegExp | string>;
  verbose?: boolean;
  diskCache?: boolean | string;
  strict?: boolean | "incremental";
  cfgConfig?: Record<string, unknown>;
}
```

See [Performance Architecture](../../docs/PERFORMANCE.md) for details on caching and strict mode.

## License

MIT
