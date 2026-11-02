# Webpack Setup

This guide covers setting up typesugar with Webpack, including Next.js projects that use Webpack.

## Installation

```bash
npm install --save-dev unplugin-typesugar @typesugar/transformer
```

## Configuration

### webpack.config.js

```javascript
// CommonJS: the plugin is the module's `default` export
const typesugar = require("unplugin-typesugar/webpack").default;

module.exports = {
  plugins: [typesugar()],
  // ... rest of your config
};
```

### webpack.config.ts (TypeScript)

```typescript
import type { Configuration } from "webpack";
import typesugar from "unplugin-typesugar/webpack";

const config: Configuration = {
  plugins: [typesugar()],
  // ... rest of your config
};

export default config;
```

### Plugin Options

```javascript
typesugar({
  // Type-check the expanded output at build end and fail the build (experimental)
  strict: false,

  // Logging and file patterns (globs or RegExps; relative globs resolve
  // against the working directory; node_modules is always skipped)
  verbose: false,
  include: ["src/**/*.ts", "src/**/*.tsx"],
  exclude: ["**/*.test.ts"],
  tsconfig: "./tsconfig.json",
});
```

See [Configuration](../../reference/config.md#bundler-plugins-unplugin-typesugar)
for every option.

### Typechecking

**Webpack does NOT typecheck by default** — it only transforms. To get type errors:

```javascript
// Option 1: Strict mode (experimental)
typesugar({
  strict: true, // type-checks expanded output at build end; errors fail the build
});
```

```bash
# Option 2: Run typesugar check separately (recommended for CI)
typesugar check && webpack build
```

Use `typesugar check` rather than `tsc --noEmit`, which never runs the macros and so
type-checks the unexpanded source.

```javascript
// Option 3: fork-ts-checker-webpack-plugin for parallel type-checking.
// Note: it runs plain tsc, so it has the same limitation as `tsc --noEmit`.
const ForkTsCheckerWebpackPlugin = require("fork-ts-checker-webpack-plugin");

module.exports = {
  plugins: [typesugar(), new ForkTsCheckerWebpackPlugin()],
};
```

## Next.js Setup

### Next.js 13+ (App Router or Pages)

```javascript
// next.config.js
const typesugar = require("unplugin-typesugar/webpack").default;

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    config.plugins.push(typesugar());
    return config;
  },
};

module.exports = nextConfig;
```

### next.config.mjs (ESM)

```javascript
import typesugar from "unplugin-typesugar/webpack";

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    config.plugins.push(typesugar());
    return config;
  },
};

export default nextConfig;
```

### Important: Turbopack Limitation

typesugar is a Webpack plugin here, so it does nothing under Turbopack, which
doesn't run Webpack plugins. Which bundler Next.js uses depends on its version:
Next.js 16 and later use Turbopack by default for both `next dev` and `next build`
(pass `--webpack` to use Webpack); earlier versions use Webpack unless you pass
`--turbo`.

```bash
# Next.js 16+: opt in to Webpack so typesugar runs
next dev --webpack
next build --webpack

# Next.js 13–15: Webpack is the default
next dev
next build
```

## With ts-loader

If you're using `ts-loader` instead of the unplugin:

```javascript
// webpack.config.js
module.exports = {
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: {
          loader: "ts-loader",
          options: {
            getCustomTransformers: (program) => ({
              before: [require("@typesugar/transformer").default(program)],
            }),
          },
        },
      },
    ],
  },
};
```

Note: The unplugin approach is recommended. It runs typesugar's full pipeline, including the source pre-passes (such as the HKT rewrite) that run before macro expansion; a `getCustomTransformers` hook runs only the macro transformer.

## tsconfig.json

```json
{
  "compilerOptions": {
    "plugins": [
      { "name": "@typesugar/transformer/language-service" },
      { "transform": "@typesugar/transformer", "type": "program" }
    ]
  }
}
```

## Verification

Create a test file and run webpack build:

```typescript
// src/test.ts
import { comptime } from "typesugar";
export const buildTime = comptime(new Date().toISOString());
```

```bash
npx webpack build
```

Check the output for the expanded timestamp literal.

## Troubleshooting

### Module not found errors

Ensure your webpack `resolve` config includes TypeScript extensions:

```javascript
resolve: {
  extensions: ['.ts', '.tsx', '.js', '.jsx'],
}
```

### Next.js: macros not expanding

1. Make sure you're not using Turbopack (see above)
2. Check that the webpack function is being called (add a `console.log`)
3. Verify the plugin is in the correct position in the plugins array

### Slow builds

Add `include` patterns to limit which files are processed:

```javascript
typesugar({
  include: ["src/**/*.ts"],
  exclude: ["**/*.test.ts", "**/*.spec.ts"],
});
```

## Next Steps

- [Editor Setup](../editor-setup.md)
- [Vitest Setup](./vitest.md) for testing (there is no working Jest integration; see [Jest](./jest.md))
