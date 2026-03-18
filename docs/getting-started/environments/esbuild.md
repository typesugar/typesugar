# esbuild Setup

This guide covers setting up typesugar with esbuild.

## Installation

```bash
npm install --save-dev unplugin-typesugar @typesugar/transformer ts-patch esbuild
```

## Configuration

### Build Script

```typescript
// build.ts
import { build } from "esbuild";
import typesugar from "unplugin-typesugar/esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/bundle.js",
  plugins: [typesugar()],
});
```

### CommonJS

```javascript
// build.js
const { build } = require("esbuild");
const typesugar = require("unplugin-typesugar/esbuild");

build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/bundle.js",
  plugins: [typesugar.default()],
});
```

### Plugin Options

```typescript
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

**esbuild does NOT typecheck** — it only transforms. To get type errors:

```typescript
// Option 1: Strict mode
typesugar({
  strict: true, // Typechecks expanded output at build end
});
```

```bash
# Option 2: Run tsc separately (recommended)
tsc --noEmit && node build.ts
```

## Watch Mode

```typescript
import { context } from "esbuild";
import typesugar from "unplugin-typesugar/esbuild";

const ctx = await context({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outdir: "dist",
  plugins: [typesugar()],
});

await ctx.watch();
console.log("Watching for changes...");
```

## With tsup

tsup uses esbuild internally. Configure it via `tsup.config.ts`:

```typescript
// tsup.config.ts
import { defineConfig } from "tsup";
import typesugar from "unplugin-typesugar/esbuild";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  esbuildPlugins: [typesugar()],
});
```

## tsconfig.json

For IDE support:

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

## External Dependencies

If you're building a library, you may want to externalize typesugar packages:

```typescript
build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/index.js",
  external: ["@typesugar/*"],
  plugins: [typesugar()],
});
```

## Verification

```bash
node build.ts
# or
npx tsx build.ts
```

Check `dist/bundle.js` for expanded macros.

## Troubleshooting

### Type errors but build succeeds

esbuild doesn't type-check. Run `tsc --noEmit` separately or use tsup with `dts: true`.

### Macros not expanding

1. Verify the plugin is in the plugins array
2. Check file extension matches `include` patterns
3. Run with `verbose: true`

### Source maps

Enable source maps for debugging:

```typescript
build({
  sourcemap: true,
  plugins: [typesugar()],
});
```

## Next Steps

- [Editor Setup](../editor-setup.md)
- [Vitest Setup](./vitest.md) for testing
