# Bun Setup

This guide covers using typesugar with Bun.

## Current Status

Bun has its own TypeScript transpiler that doesn't support TypeScript transformer plugins. This means **typesugar macros don't work with Bun's native transpiler**.

However, you can still use typesugar with Bun by using a build step.

## Workaround: Pre-compile with tsc/Vite

### Option 1: Use typesugar CLI for development

```bash
# Build with typesugar
bunx typesugar build

# Run the compiled output
bun dist/index.js
```

### Option 2: Use Vite for bundling

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import typesugar from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [
    typesugar({
      // Use fast oxc backend (default)
      backend: "oxc",
      // Typecheck expanded output (since Vite doesn't typecheck)
      strict: true,
    }),
  ],
  build: {
    target: "esnext",
    outDir: "dist",
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
    },
  },
});
```

```bash
# Build with Vite
bun run vite build

# Run with Bun
bun dist/index.js
```

## Project Setup

### package.json

```json
{
  "scripts": {
    "build": "typesugar build",
    "dev": "typesugar watch",
    "start": "bun dist/index.js"
  },
  "devDependencies": {
    "@typesugar/transformer": "^0.1.0",
    "ts-patch": "^3.0.0",
    "typescript": "^5.0.0"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "outDir": "./dist",
    "plugins": [{ "transform": "@typesugar/transformer", "type": "program" }]
  }
}
```

## Testing with Bun

For tests, you have two options:

### Option 1: Pre-compile test files

```bash
# Build tests first
typesugar build --project tsconfig.test.json

# Run compiled tests with Bun
bun test dist/
```

### Option 2: Use Vitest

Vitest works with Bun and supports the typesugar plugin:

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import typesugar from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [typesugar()],
  test: {
    include: ["src/**/*.test.ts"],
  },
});
```

```bash
bunx vitest
```

## Future Support

Bun has an open issue for supporting TypeScript transformer plugins. When this lands, typesugar will work natively with Bun's transpiler.

In the meantime, the build-step approach works reliably and maintains full type safety.

## Troubleshooting

### "comptime is not a function"

This error means Bun ran your TypeScript directly without macro expansion. Use the build step as described above.

### Slow builds

For faster iteration:

1. Use `typesugar watch` for incremental builds
2. Only rebuild changed files
3. Consider using Vite's dev server for web projects

## Next Steps

- [Vitest Setup](./vitest.md) for testing
- [Editor Setup](../editor-setup.md)
