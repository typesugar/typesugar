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
    "build": "typesugar build",
    "check": "typesugar check"
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
      { "name": "@typesugar/transformer/language-service" },
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
      "verbose": false,
      "cfgConfig": {}
    }
  ]
}
```

See [Configuration](../../reference/config.md#transformer-plugin) for every option.

### Typechecking

ts-patch runs the transformer at **emit** time, after TypeScript has already
type-checked the file. So a patched `tsc`:

- type-checks the **original, unexpanded** source. Code that is valid only after
  expansion produces phantom errors — for example `@derive(Eq) interface P {…}`
  reports `TS1206: Decorators are not valid here`, and method sugar or `let:` labels
  are checked as written;
- reports macro errors (they are added to the emit diagnostics, so `tsc` exits
  non-zero on them);
- with `--noEmit`, never runs the transformer at all, so it is not a useful check.

For type-checking, and as your CI gate, use the typesugar CLI: `typesugar check`
(no output) or `typesugar build` (emits). They expand macros first and filter out
the phantom errors the unexpanded source produces. To also type-check the expanded
output, add `--strict` (experimental).

### Declarations

TypeScript emits `.d.ts` files from the program it type-checked, so a patched `tsc`
declares the **unexpanded** types: an exported function that returns a fluent
`match()` is declared `: any`. `typesugar build` emits declarations from the expanded
program instead. Build a library with it:

```json
{
  "scripts": {
    "build": "typesugar build"
  }
}
```

With `declaration: true` in the tsconfig, `typesugar build` writes both the `.js` and the
`.d.ts` files. To write only the declarations (the JavaScript comes from a bundler), run
`typesugar build --emitDeclarationOnly`.

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

typesugar provides its own CLI, built on the TypeScript API (recommended over plain
`tsc`; see [Typechecking](#typechecking)):

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
npx typesugar build
# or, with ts-patch installed
npx tsc
```

3. Check `dist/test.js` for the expanded timestamp.

## Multiple tsconfig Files

For different build configurations:

```bash
# Development build
npx typesugar build --project tsconfig.dev.json

# Production build
npx typesugar build --project tsconfig.prod.json
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
  - run: npx typesugar check
  - run: npm run build
```

Or rely on the `prepare` script (runs automatically after `npm ci`).

## Next Steps

- [Editor Setup](../editor-setup.md)
- [Vitest Setup](./vitest.md) for testing
- [Monorepo Setup](./monorepo.md) for workspace configurations
