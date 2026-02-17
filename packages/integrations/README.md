# @ttfx/integrations

> Bundler integrations for ttfx macro expansion.

## Overview

`@ttfx/integrations` provides plugins for popular bundlers to process ttfx macros during your build. Powered by [unplugin](https://github.com/unjs/unplugin) for maximum compatibility.

## Installation

```bash
npm install @ttfx/integrations
# or
pnpm add @ttfx/integrations
```

## Vite

```typescript
// vite.config.ts
import ttfx from "@ttfx/integrations/vite";

export default {
  plugins: [ttfx()],
};
```

## Webpack

```typescript
// webpack.config.js
const ttfx = require("@ttfx/integrations/webpack").default;

module.exports = {
  plugins: [ttfx()],
};
```

## esbuild

```typescript
// build.js
import esbuild from "esbuild";
import ttfx from "@ttfx/integrations/esbuild";

await esbuild.build({
  entryPoints: ["src/index.ts"],
  plugins: [ttfx()],
  bundle: true,
  outfile: "dist/index.js",
});
```

## Rollup

```typescript
// rollup.config.js
import ttfx from "@ttfx/integrations/rollup";

export default {
  input: "src/index.ts",
  plugins: [ttfx()],
  output: {
    file: "dist/index.js",
    format: "esm",
  },
};
```

## Configuration

All plugins accept the same options:

```typescript
interface TypeMacroPluginOptions {
  /** Enable verbose logging */
  verbose?: boolean;

  /** Include/exclude patterns */
  include?: string | string[];
  exclude?: string | string[];

  /** Custom macro modules to load */
  macroModules?: string[];
}
```

### Example with Options

```typescript
// vite.config.ts
import ttfx from "@ttfx/integrations/vite";

export default {
  plugins: [
    ttfx({
      verbose: true,
      include: ["src/**/*.ts"],
      exclude: ["**/*.test.ts"],
    }),
  ],
};
```

## How It Works

The integration plugins:

1. **Intercept** TypeScript files during the build
2. **Create a TypeScript program** with the ttfx transformer
3. **Expand macros** at compile time
4. **Emit transformed code** to the bundler

This means macros are fully expanded before your code reaches the bundler's optimization pipeline.

## API Reference

### Exports

- `@ttfx/integrations/vite` — Vite plugin
- `@ttfx/integrations/webpack` — Webpack plugin
- `@ttfx/integrations/esbuild` — esbuild plugin
- `@ttfx/integrations/rollup` — Rollup plugin
- `@ttfx/integrations` — Core unplugin factory

### Types

```typescript
interface TypeMacroPluginOptions {
  verbose?: boolean;
  include?: string | string[];
  exclude?: string | string[];
  macroModules?: string[];
}
```

## License

MIT
