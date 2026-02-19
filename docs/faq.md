# FAQ

Frequently asked questions about ttfx.

## General

### What is ttfx?

ttfx is a macro system for TypeScript. It lets you write code that transforms at compile time, producing efficient JavaScript without runtime overhead.

### How is this different from Babel macros?

| Feature     | ttfx                    | Babel macros           |
| ----------- | ----------------------- | ---------------------- |
| Language    | TypeScript-first        | JavaScript-first       |
| Type safety | Full type information   | Limited                |
| Syntax      | Multiple macro types    | Expression macros only |
| Integration | TypeScript compiler API | Babel plugin           |

### Does ttfx work with plain JavaScript?

No, ttfx is TypeScript-only. It uses TypeScript's compiler API and type information.

### Is there runtime overhead?

No. Macros expand at compile time. The output is plain JavaScript with no ttfx runtime dependencies (unless you're using packages like `@ttfx/fp` that provide runtime types).

## Setup

### Which bundlers are supported?

- Vite
- Webpack
- esbuild
- Rollup
- tsc (via ts-patch)

### Do I need to configure TypeScript?

For most bundlers, no. The bundler plugin handles transformation.

For `tsc`, you need [ts-patch](https://github.com/nonara/ts-patch):

```bash
npm install -D ts-patch
npx ts-patch install
```

### Can I use ttfx with Next.js?

Yes, configure the Webpack plugin in `next.config.js`:

```javascript
const ttfx = require("unplugin-ttfx/webpack");

module.exports = {
  webpack: (config) => {
    config.plugins.push(ttfx.default());
    return config;
  },
};
```

### Can I use ttfx with SWC?

Not directly. SWC doesn't support TypeScript transformers. Use ts-patch with tsc, or use a bundler plugin.

## Usage

### Why isn't my macro expanding?

Common reasons:

1. **Missing import** — Macros only expand when imported from their package:

   ```typescript
   // ✗ Won't expand — no import
   const x = comptime(1 + 1);

   // ✓ Will expand
   import { comptime } from "@ttfx/comptime";
   const x = comptime(1 + 1);
   ```

2. **Wrong package** — Make sure you're importing from the correct package.

3. **Transformer not configured** — Check your bundler configuration.

4. **File excluded** — Check that your file isn't in an excluded pattern.

### Can I use macros in type positions?

Some macros work in type positions (like `Refined<T>`), but most are expression-level.

### How do I debug macro expansions?

Enable verbose mode:

```typescript
ttfx({ verbose: true });
```

This logs every expansion to the console.

### Can macros access the file system?

Yes, `comptime()` can run arbitrary code at compile time:

```typescript
import { comptime } from "@ttfx/comptime";
import fs from "fs";

const schema = comptime(fs.readFileSync("schema.json", "utf8"));
```

Be careful with side effects — they run at compile time!

### Are macros type-safe?

Yes. Macros have access to TypeScript's type checker and can use type information in their transformations. The output is also type-checked by TypeScript.

## Packages

### What's the difference between @ttfx/ttfx and individual packages?

`@ttfx/ttfx` is an umbrella package that re-exports commonly used macros. Individual packages (`@ttfx/comptime`, `@ttfx/derive`, etc.) can be installed separately if you only need specific functionality.

### Do I need @ttfx/core?

Usually not directly. It's a dependency of other packages and provides the macro registration system. You only need it if you're writing custom macros.

### Can I use @ttfx/effect with Effect-TS?

Yes, that's exactly what it's for. It provides cleaner syntax for Effect-TS operations.

## Performance

### Does ttfx slow down compilation?

There's some overhead for macro expansion, but it's typically small compared to type checking. The `verbose` option can help identify slow macros.

### Is the output code optimized?

Macros generate code, but don't optimize it. Standard JavaScript minifiers (Terser, esbuild) work on the output.

### Can I cache macro results?

The transformer caches some internal state, but macro results themselves aren't cached across builds. Each compilation re-expands all macros.

## Troubleshooting

### "Cannot find module '@ttfx/...'"

Make sure you've installed the package:

```bash
npm install @ttfx/comptime
```

### "comptime is not a function"

The transformer isn't running. Check your bundler configuration.

### Type errors after macro expansion

Some macros generate code that needs type assertions. Check the macro's documentation for known issues.

### Source maps are wrong

Make sure source maps are enabled in your bundler. ttfx preserves source locations, but some transformations can affect mapping accuracy.

## Contributing

### How do I create a custom macro?

See [Writing Macros](./writing-macros.md).

### Where can I report bugs?

Open an issue on GitHub.

### Can I contribute new macros?

Yes! See the contribution guidelines in the repository.
