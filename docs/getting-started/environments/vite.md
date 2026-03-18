# Vite Setup

This guide covers setting up typesugar with Vite projects, including frameworks like SvelteKit, Nuxt, and Remix that use Vite under the hood.

## Installation

```bash
npm install --save-dev unplugin-typesugar @typesugar/transformer ts-patch
```

## Configuration

### vite.config.ts

```typescript
import { defineConfig } from "vite";
import typesugar from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [typesugar()],
});
```

### With Other Plugins

typesugar should typically come first in the plugin array:

```typescript
import { defineConfig } from "vite";
import typesugar from "unplugin-typesugar/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [typesugar(), react()],
});
```

### Plugin Options

```typescript
typesugar({
  // Typecheck expanded output at build end (catches macro bugs)
  strict: false,

  // Enable verbose logging for debugging
  verbose: false,

  // File patterns to include (default: TypeScript files)
  include: ["**/*.ts", "**/*.tsx"],

  // File patterns to exclude
  exclude: ["node_modules/**", "**/*.d.ts"],

  // Path to tsconfig.json (auto-detected by default)
  tsconfig: "./tsconfig.json",
});
```

### Typechecking

**Vite does NOT typecheck your code** — it only transforms. To get type errors:

```typescript
// vite.config.ts — Option 1: Strict mode (typechecks expanded output)
typesugar({
  strict: true, // Runs tsc on expanded code at build end
});
```

```bash
# Option 2: Run tsc separately (recommended for CI)
tsc --noEmit && vite build
```

```typescript
// Option 3: Use vite-plugin-checker for dev server type errors
import checker from "vite-plugin-checker";

export default defineConfig({
  plugins: [typesugar(), checker({ typescript: true })],
});
```

## Framework-Specific Notes

### SvelteKit

```typescript
// vite.config.ts
import { sveltekit } from "@sveltejs/kit/vite";
import typesugar from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [typesugar(), sveltekit()],
});
```

In `.svelte` files, macros work in the `<script lang="ts">` blocks.

### Nuxt 3

For Nuxt 3, configure in `nuxt.config.ts`:

```typescript
// nuxt.config.ts
import typesugar from "unplugin-typesugar/vite";

export default defineNuxtConfig({
  vite: {
    plugins: [typesugar()],
  },
});
```

### Remix (Vite mode)

```typescript
// vite.config.ts
import { vitePlugin as remix } from "@remix-run/dev";
import typesugar from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [typesugar(), remix()],
});
```

### Astro

```typescript
// astro.config.mjs
import { defineConfig } from "astro/config";
import typesugar from "unplugin-typesugar/vite";

export default defineConfig({
  vite: {
    plugins: [typesugar()],
  },
});
```

## tsconfig.json

Even with the Vite plugin, you should configure `tsconfig.json` for IDE support and type checking:

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

1. Create a test file:

```typescript
// src/test-macros.ts
import { comptime } from "typesugar";

export const buildTime = comptime(new Date().toISOString());
console.log(`Built at: ${buildTime}`);
```

2. Run `vite build` or `vite dev`

3. Check that the macro expanded (look for the literal timestamp string)

## Troubleshooting

### Macros not expanding

- Ensure `unplugin-typesugar` is installed and configured
- Check that the file is included (matches `include` patterns)
- Run with `verbose: true` to see expansion logs

### Type errors in editor but build works

- Add the language service plugin to `tsconfig.json`
- Restart your editor/TypeScript server

### SSR issues

typesugar macros expand at build time, so they work the same in SSR and client builds. If you're seeing differences, check that both builds use the same config.

## Next Steps

- [Editor Setup](../editor-setup.md)
- [Vitest Setup](./vitest.md) for testing
