# FAQ

Frequently asked questions about typesugar.

## General

### What is typesugar?

typesugar is a macro system for TypeScript. It lets you write code that transforms at compile time, producing efficient JavaScript without runtime overhead.

### How is this different from Babel macros?

| Feature     | typesugar               | Babel macros           |
| ----------- | ----------------------- | ---------------------- |
| Language    | TypeScript-first        | JavaScript-first       |
| Type safety | Full type information   | Limited                |
| Syntax      | Multiple macro types    | Expression macros only |
| Integration | TypeScript compiler API | Babel plugin           |

### Does typesugar work with plain JavaScript?

No, typesugar is TypeScript-only. It uses TypeScript's compiler API and type information.

### Is there runtime overhead?

No. Macros expand at compile time. The output is plain JavaScript with no typesugar runtime dependencies (unless you're using packages like `@typesugar/fp` that provide runtime types).

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

### Can I use typesugar with Next.js?

Yes, configure the Webpack plugin in `next.config.js`:

```javascript
const typesugar = require("unplugin-typesugar/webpack");

module.exports = {
  webpack: (config) => {
    config.plugins.push(typesugar.default());
    return config;
  },
};
```

### Can I use typesugar with SWC?

Not directly. SWC doesn't support TypeScript transformers. Use ts-patch with tsc, or use a bundler plugin.

## Usage

### Why isn't my macro expanding?

Common reasons:

1. **Missing import** — Macros only expand when imported from their package:

   ```typescript
   // ✗ Won't expand — no import
   const x = comptime(1 + 1);

   // ✓ Will expand
   import { comptime } from "@typesugar/comptime";
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
typesugar({ verbose: true });
```

This logs every expansion to the console.

### Can macros access the file system?

Yes, `comptime()` can run arbitrary code at compile time:

```typescript
import { comptime } from "@typesugar/comptime";
import fs from "fs";

const schema = comptime(fs.readFileSync("schema.json", "utf8"));
```

Be careful with side effects — they run at compile time!

### Are macros type-safe?

Yes. Macros have access to TypeScript's type checker and can use type information in their transformations. The output is also type-checked by TypeScript.

## Packages

### What's the difference between @typesugar/typesugar and individual packages?

`@typesugar/typesugar` is an umbrella package that re-exports commonly used macros. Individual packages (`@typesugar/comptime`, `@typesugar/derive`, etc.) can be installed separately if you only need specific functionality.

### Do I need @typesugar/core?

Usually not directly. It's a dependency of other packages and provides the macro registration system. You only need it if you're writing custom macros.

### Can I use @typesugar/effect with Effect-TS?

Yes, that's exactly what it's for. It provides cleaner syntax for Effect-TS operations.

## Performance

### Does typesugar slow down compilation?

There's some overhead for macro expansion, but it's typically small compared to type checking. The `verbose` option can help identify slow macros.

### Is the output code optimized?

Macros generate code, but don't optimize it. Standard JavaScript minifiers (Terser, esbuild) work on the output.

### Can I cache macro results?

The transformer caches some internal state, but macro results themselves aren't cached across builds. Each compilation re-expands all macros.

## Troubleshooting

### "Cannot find module '@typesugar/...'"

Make sure you've installed the package:

```bash
npm install @typesugar/comptime
```

### "comptime is not a function"

The transformer isn't running. Check your bundler configuration.

### Type errors after macro expansion

Some macros generate code that needs type assertions. Check the macro's documentation for known issues.

### Source maps are wrong

Make sure source maps are enabled in your bundler. typesugar preserves source locations, but some transformations can affect mapping accuracy.

## Contributing

### How do I create a custom macro?

See [Writing Macros](./writing-macros.md).

### Where can I report bugs?

Open an issue on GitHub.

### Can I contribute new macros?

Yes! See the contribution guidelines in the repository.
