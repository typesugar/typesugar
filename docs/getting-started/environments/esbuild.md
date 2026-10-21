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

**esbuild does NOT typecheck** — it only transforms. To get type errors:

```typescript
// Option 1: Strict mode (experimental)
typesugar({
  strict: true, // type-checks expanded output at build end; errors fail the build
});
```

```bash
# Option 2: Run typesugar check separately (recommended)
typesugar check && npx tsx build.ts
```

Use `typesugar check` rather than `tsc --noEmit`, which never runs the macros and so
type-checks the unexpanded source.

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

tsup uses esbuild internally. Wrap the config in `withTypesugar`, which adds the esbuild
plugin and, with `dts`, makes tsup's declaration step work on macro code:

```typescript
// tsup.config.ts
import { defineConfig } from "tsup";
import { withTypesugar } from "unplugin-typesugar/tsup"; // or "typesugar/tsup"

export default defineConfig(
  withTypesugar(
    {
      entry: ["src/index.ts"],
      format: ["cjs", "esm"],
      dts: true,
    },
    {
      /* plugin options, as for typesugar() */
    }
  )
);
```

### Declarations (`dts`)

tsup's `dts` step runs TypeScript over the **unexpanded** source. Names bound by a
pattern (`.case({ kind: "circle", radius: r })`) are undeclared there (TS2304), so
`dts: true` next to the bare esbuild plugin fails the build, and other macros' types come
out as they are before expansion.

`withTypesugar` emits the declarations from the expanded program first, into
`.tsup/typesugar-dts/`, and points tsup's `dts` step at them. tsup still bundles and names
them as usual (`index.d.ts`, `index.d.cts`, one file per entry, `dts.resolve`,
`dts.banner`), and they import nothing from typesugar. Type errors fail the build, as
tsup's own step does. In watch mode the declarations are re-emitted after each rebuild.
`experimentalDts` is not supported; use `dts`.

Without the helper, turn tsup's step off and emit the declarations with the CLI after it,
per module rather than bundled:

```json
{
  "scripts": {
    "build": "tsup && typesugar build --emitDeclarationOnly --declarationDir dist"
  }
}
```

## tsconfig.json

For IDE support:

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
npx tsx build.ts
# (or `node build.ts` on a Node version that runs TypeScript directly)
```

Check `dist/bundle.js` for expanded macros.

## Troubleshooting

### Type errors but build succeeds

esbuild doesn't type-check. Run `typesugar check` separately (plain `tsc --noEmit`
doesn't expand macros), or set `strict: true`.

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
