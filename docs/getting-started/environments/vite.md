# Vite Setup

This guide covers setting up typesugar with Vite projects, including frameworks like SvelteKit, Nuxt, and Remix that use Vite under the hood.

## Installation

```bash
npm install --save-dev unplugin-typesugar @typesugar/transformer ts-patch
npm install typesugar @typesugar/std   # the macros and runtime you import
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
  // Type-check the expanded output at build end and fail the build on errors
  // (experimental; "incremental" re-checks only changed files)
  strict: false,

  // Enable verbose logging for debugging
  verbose: false,

  // Files to transform: globs (picomatch) or RegExps; default /\.[jt]sx?$/.
  // Relative globs resolve against Vite's root.
  include: ["src/**/*.ts", "src/**/*.tsx"],

  // Files to skip. node_modules is always skipped unless `include` names it.
  exclude: ["**/*.d.ts"],

  // Path to tsconfig.json (auto-detected by default)
  tsconfig: "./tsconfig.json",

  // Conditions for cfg() / @cfgAttr
  cfgConfig: { debug: true },
});
```

### Typechecking

**Vite does NOT typecheck your code** — it only transforms. To get type errors:

```typescript
// vite.config.ts — Option 1: Strict mode (type-checks expanded output, experimental)
typesugar({
  strict: true, // fails `vite build` if the expanded code has type errors
});
```

```bash
# Option 2: Run typesugar check separately (recommended for CI)
typesugar check && vite build
```

Use `typesugar check`, not `tsc --noEmit`: plain `tsc --noEmit` never runs the
macros, so it type-checks the unexpanded source and reports errors like
`TS1206: Decorators are not valid here` on `@derive`.

```typescript
// Option 3: Use vite-plugin-checker for dev server type errors.
// Note: it runs plain tsc, so it has the same limitation as `tsc --noEmit`.
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
      { "name": "@typesugar/transformer/language-service" },
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
- Check that the file is included (matches `include` patterns — globs are matched
  against the absolute path, so prefer `"src/**/*.ts"` or `"**/*.ts"`)
- Run with `verbose: true` to see expansion logs

### Type errors in editor but build works

- Add the language service plugin to `tsconfig.json`
- Restart your editor/TypeScript server

### SSR issues

typesugar macros expand at build time, so they work the same in SSR and client builds. If you're seeing differences, check that both builds use the same config.

## Next Steps

- [Editor Setup](../editor-setup.md)
- [Vitest Setup](./vitest.md) for testing
