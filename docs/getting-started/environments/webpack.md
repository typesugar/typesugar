# Webpack Setup

This guide covers setting up typesugar with Webpack, including Next.js projects that use Webpack.

## Installation

```bash
npm install --save-dev unplugin-typesugar @typesugar/transformer ts-patch
```

## Configuration

### webpack.config.js

```javascript
const typesugar = require("unplugin-typesugar/webpack");

module.exports = {
  plugins: [typesugar.default()],
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
  // Typecheck expanded output at build end
  strict: false,

  // Logging and file patterns
  verbose: false,
  include: ["**/*.ts", "**/*.tsx"],
  exclude: ["node_modules/**"],
  tsconfig: "./tsconfig.json",
});
```

### Typechecking

**Webpack does NOT typecheck by default** — it only transforms. To get type errors:

```javascript
// Option 1: Strict mode
typesugar({
  strict: true, // Typechecks expanded output at build end
});
```

```bash
# Option 2: Run tsc separately (recommended for CI)
tsc --noEmit && webpack build
```

```javascript
// Option 3: Use fork-ts-checker-webpack-plugin for parallel typechecking
const ForkTsCheckerWebpackPlugin = require("fork-ts-checker-webpack-plugin");

module.exports = {
  plugins: [typesugar(), new ForkTsCheckerWebpackPlugin()],
};
```

## Next.js Setup

### Next.js 13+ (App Router or Pages)

```javascript
// next.config.js
const typesugar = require("unplugin-typesugar/webpack");

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

If you're using Turbopack (`next dev --turbo`), typesugar won't work because Turbopack uses SWC instead of the TypeScript compiler. Use the standard Webpack mode for development:

```bash
# Use webpack (typesugar works)
next dev

# Turbopack (typesugar doesn't work)
next dev --turbo
```

Production builds (`next build`) always use Webpack, so typesugar will work.

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

Note: The unplugin approach is recommended as it handles both the transformer and preprocessor stages.

## tsconfig.json

```json
{
  "compilerOptions": {
    "plugins": [
      { "name": "typesugar/language-service" },
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

1. Make sure you're not using Turbopack
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
- [Jest Setup](./jest.md) for testing with Webpack projects
