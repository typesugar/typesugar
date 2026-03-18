# tsc (TypeScript Compiler) Setup

This guide covers setting up typesugar with the TypeScript compiler directly, using ts-patch.

## Overview

The TypeScript compiler (`tsc`) doesn't natively support transformer plugins. ts-patch modifies the installed TypeScript to enable this feature.

## Installation

```bash
npm install --save-dev @typesugar/transformer ts-patch typescript
```

## Step 1: Install ts-patch

```bash
npx ts-patch install
```

This patches your local `node_modules/typescript` installation.

## Step 2: Add Prepare Script

Add ts-patch to your `prepare` script so it persists after `npm install`:

```json
{
  "scripts": {
    "prepare": "ts-patch install -s",
    "build": "tsc",
    "check": "tsc --noEmit"
  }
}
```

The `-s` flag makes ts-patch silent (no output on success).

## Step 3: Configure tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "declaration": true,
    "plugins": [
      { "name": "typesugar/language-service" },
      { "transform": "@typesugar/transformer", "type": "program" }
    ]
  },
  "include": ["src/**/*"]
}
```

### Plugin Configuration

The transformer plugin accepts options:

```json
{
  "plugins": [
    {
      "transform": "@typesugar/transformer",
      "type": "program",
      "verbose": false
    }
  ]
}
```

### Typechecking

**tsc with ts-patch provides full typechecking.** This is the only build path where:

- Macro transformation AND typechecking happen in the same pass
- Type errors are reported during build (not as a separate step)
- The full TypeScript API is available for all macros

Unlike bundlers (Vite, esbuild, Webpack), you don't need `strict: true` or a separate `tsc --noEmit` step — typechecking is built-in.

## Using tspc Instead of tsc

ts-patch provides `tspc` as an alternative to `tsc`:

```json
{
  "scripts": {
    "build": "tspc"
  }
}
```

`tspc` is a patched version of `tsc` that doesn't require modifying `node_modules/typescript`. This is useful if you can't or don't want to patch TypeScript globally.

## Using the typesugar CLI

typesugar provides its own CLI that wraps tsc:

```bash
# Build with macro expansion
npx typesugar build

# Watch mode
npx typesugar watch

# Type-check only
npx typesugar check

# See expanded output
npx typesugar expand src/main.ts

# Run a file directly (with macro expansion)
npx typesugar run src/main.ts
```

## Verification

1. Create a test file:

```typescript
// src/test.ts
import { comptime } from "typesugar";

export const buildTime = comptime(new Date().toISOString());
```

2. Build:

```bash
npx tsc
# or
npx typesugar build
```

3. Check `dist/test.js` for the expanded timestamp.

## Multiple tsconfig Files

For different build configurations:

```bash
# Development build
npx tsc --project tsconfig.dev.json

# Production build
npx tsc --project tsconfig.prod.json
```

Each config can have different transformer options.

## Troubleshooting

### "Transform not found" Error

1. Verify ts-patch is installed: `npx ts-patch check`
2. Reinstall: `npx ts-patch install`
3. Check that `@typesugar/transformer` is in `node_modules`

### ts-patch Resets After npm install

Add to your prepare script:

```json
{
  "scripts": {
    "prepare": "ts-patch install -s"
  }
}
```

### Macros Not Expanding

1. Ensure the `plugins` array is in `compilerOptions`
2. Check the transform path is correct
3. Verify the file is included in `include`

### IDE Shows Errors

1. Add the language service plugin
2. Restart your editor/TypeScript server
3. Ensure your editor is using the workspace TypeScript

## CI/CD Considerations

In CI environments, run ts-patch after installing dependencies:

```yaml
# GitHub Actions example
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
  - run: npm ci
  - run: npx ts-patch install
  - run: npm run build
```

Or rely on the `prepare` script (runs automatically after `npm ci`).

## Next Steps

- [Editor Setup](../editor-setup.md)
- [Vitest Setup](./vitest.md) for testing
- [Monorepo Setup](./monorepo.md) for workspace configurations
