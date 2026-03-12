# Migrating to `.sts` Files

This guide explains when and how to migrate TypeScript files to the `.sts` (Sugared TypeScript) extension.

## When to Use `.sts`

Use `.sts` when your file uses **custom syntax** that requires the preprocessor:

| Syntax                  | Example                          | Requires `.sts`? |
| ----------------------- | -------------------------------- | ---------------- |
| Pipeline operator       | `data \|> filter \|> map`        | Yes              |
| Cons operator           | `head :: tail`                   | Yes              |
| HKT syntax              | `type F<_> = ...` / `Kind<F, A>` | Yes              |
| Decorator on interfaces | `@typeclass interface Eq<A>`     | Yes              |
| JSDoc macros            | `/** @typeclass */`              | No               |
| Expression macros       | `comptime(() => ...)`            | No               |
| Derive decorators       | `@derive(Eq, Clone)`             | No               |
| Do-notation             | `let: { x << ... }`              | No               |

**Rule of thumb:** If your file would cause a syntax error in plain `tsc` without typesugar, use `.sts`.

## Quick Migration

### Single File

1. Rename the file:

   ```bash
   mv src/fp/functor.ts src/fp/functor.sts
   ```

2. Update imports (no changes needed — implicit resolution handles it):

   ```typescript
   // This still works when functor.ts becomes functor.sts
   import { Functor } from "./functor";
   ```

3. Update your `tsconfig.json` to include `.sts` files:
   ```json
   {
     "include": ["src/**/*.ts", "src/**/*.tsx", "src/**/*.sts", "src/**/*.stsx"]
   }
   ```

### Batch Migration

For projects with many files using custom syntax:

```bash
# Find all files using pipeline operator
grep -rl '|>' src/ --include='*.ts' | xargs -I{} sh -c 'mv "{}" "${1%.ts}.sts"' _ {}

# Find all files using HKT syntax
grep -rl '<_>' src/ --include='*.ts' | xargs -I{} sh -c 'mv "{}" "${1%.ts}.sts"' _ {}
```

### JSX Files

For React/JSX files with custom syntax, use `.stsx`:

```bash
mv src/components/DataFlow.tsx src/components/DataFlow.stsx
```

## Configuration Updates

### tsconfig.json

Add `.sts` and `.stsx` to your `include` patterns:

```json
{
  "compilerOptions": {
    "plugins": [{ "transform": "@typesugar/transformer" }]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "src/**/*.sts", "src/**/*.stsx"]
}
```

Or use the typesugar preset:

```json
{
  "extends": "@typesugar/transformer/tsconfig.preset.json",
  "compilerOptions": {
    "outDir": "dist"
  }
}
```

### ESLint

The `@typesugar/eslint-plugin` automatically processes `.sts` files:

```javascript
// eslint.config.mjs
import typesugarPlugin from "@typesugar/eslint-plugin";

export default [
  typesugarPlugin.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.sts", "**/*.stsx"],
  },
];
```

### Prettier

The `@typesugar/prettier-plugin` automatically formats `.sts` files:

```json
{
  "plugins": ["@typesugar/prettier-plugin"]
}
```

### Vite

The `unplugin-typesugar` handles `.sts` files automatically:

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import typesugar from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [typesugar()],
});
```

### Vitest

Add `.sts` to the test file patterns:

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    include: ["**/*.{test,spec}.{ts,tsx,sts,stsx}"],
  },
});
```

## Module Resolution

typesugar handles module resolution transparently:

```typescript
// In main.ts
import { double } from "./utils";

// TypeScript resolves to:
// 1. ./utils.ts (preferred)
// 2. ./utils.tsx
// 3. ./utils.sts (fallback)
// 4. ./utils.stsx
// 5. ./utils/index.ts
// 6. ./utils/index.sts
```

You don't need explicit extensions in imports.

## Mixed Projects

You can have both `.ts` and `.sts` files in the same project:

```
src/
├── types.ts        # Plain TypeScript (no custom syntax)
├── utils.ts        # Plain TypeScript
├── functor.sts     # Uses HKT: type F<_> = ...
├── pipeline.sts    # Uses |> operator
└── components/
    ├── Button.tsx  # Plain React
    └── DataFlow.stsx  # React + pipeline operator
```

## Declaration Files

When you compile `.sts` files, they emit standard `.d.ts` declarations (not `.d.sts.ts`). Consumers of your library don't need typesugar:

```
src/functor.sts → dist/functor.js + dist/functor.d.ts
```

## Troubleshooting

### "Unknown file extension .sts"

Your tsconfig.json doesn't include `.sts` files. Add them to `include`:

```json
{
  "include": ["src/**/*.sts"]
}
```

### ESLint doesn't recognize `.sts` files

Ensure you're using `@typesugar/eslint-plugin`:

```bash
npm install -D @typesugar/eslint-plugin
```

### VS Code doesn't highlight `.sts` syntax

Install the typesugar VS Code extension, which registers the `sugared-typescript` language.

### Import resolution fails

Check that:

1. The importing file can see the `.sts` file in its module resolution path
2. Your bundler/test runner is configured with the typesugar plugin

## Reverting Migration

If you need to revert a file to `.ts`:

1. Remove all custom syntax (`|>`, `::`, `<_>`, decorator-on-interface)
2. Rename the file back to `.ts`:
   ```bash
   mv src/fp/functor.sts src/fp/functor.ts
   ```
3. Replace custom syntax with JSDoc equivalents where possible:

   ```typescript
   // Before (.sts)
   @typeclass
   interface Eq<A> { ... }

   // After (.ts)
   /** @typeclass */
   interface Eq<A> { ... }
   ```
