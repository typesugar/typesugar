# Troubleshooting

This guide covers common issues and how to resolve them.

## Quick Diagnostics

Run the doctor command first:

```bash
npx typesugar doctor
```

This checks your configuration and provides actionable fixes.

## Installation Issues

### "Cannot find module '@typesugar/transformer'"

**Cause:** Package not installed or not in dependencies.

**Fix:**

```bash
npm install --save-dev @typesugar/transformer
```

### "ts-patch: TypeScript is not patched"

**Cause:** ts-patch hasn't been run, or was reset after `npm install`.

**Fix:**

```bash
npx ts-patch install
```

Add to your `prepare` script to persist:

```json
{
  "scripts": {
    "prepare": "ts-patch install -s"
  }
}
```

### Version Mismatch Errors

**Cause:** Different versions of typesugar packages.

**Fix:** Ensure all `@typesugar/*` packages are the same version:

```bash
npm update @typesugar/transformer @typesugar/core @typesugar/comptime
```

## Macro Expansion Issues

### "comptime is not a function" (Runtime Error)

**Cause:** Macros aren't being expanded at compile time.

**Possible reasons:**

1. Transformer not configured in `tsconfig.json`
2. ts-patch not installed
3. Using Bun/Deno directly (needs build step)
4. Bundler plugin missing

**Fix:**

1. Check `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [{ "transform": "@typesugar/transformer", "type": "program" }]
  }
}
```

2. Run ts-patch:

```bash
npx ts-patch install
```

3. For bundlers, add the plugin:

```typescript
// vite.config.ts
import typesugar from "unplugin-typesugar/vite";
export default defineConfig({
  plugins: [typesugar()],
});
```

### Macros Expand But Output is Wrong

**Cause:** Bug in macro implementation or incorrect usage.

**Debug steps:**

1. Check the expanded output:

```bash
npx typesugar expand src/file.ts
```

2. Check with diff:

```bash
npx typesugar expand src/file.ts --diff
```

3. Enable verbose logging:

```json
{
  "compilerOptions": {
    "plugins": [{ "transform": "@typesugar/transformer", "verbose": true }]
  }
}
```

### @derive Methods Missing

**Cause:** Derive expansion failed silently or class not decorated correctly.

**Fix:**

1. Check decorator syntax:

```typescript
// Correct
@derive(Eq, Clone)
class User { ... }

// Wrong - derive is called as function
@derive()(Eq, Clone)
class User { ... }
```

2. Import derives explicitly:

```typescript
import { derive, Eq, Clone } from "@typesugar/derive";
```

3. Check expanded output for errors.

## Type Errors

### "Property 'equals' does not exist on type 'User'"

**Cause:** TypeScript doesn't see the derived methods.

**Fix:**

1. Add the language service plugin to `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "typesugar/language-service" }]
  }
}
```

2. Restart your TypeScript server (in VSCode: Cmd/Ctrl+Shift+P → "Restart TS Server")

3. Ensure VSCode uses workspace TypeScript, not built-in.

### Type Errors in IDE but Build Succeeds

**Cause:** IDE TypeScript and build TypeScript are different.

**Fix:**

1. Use workspace TypeScript in editor
2. Add language service plugin
3. Regenerate the manifest:

```bash
npx typesugar build --manifest
```

### Generic Type Inference Issues

**Cause:** Complex generic types confuse the type checker after expansion.

**Workaround:** Add explicit type annotations:

```typescript
// Instead of
const result = summon<Show<User>>();

// Try
const result: Show<User> = summon<Show<User>>();
```

## Build Tool Issues

### Vite: Macros Not Expanding

1. Check plugin is in the array:

```typescript
plugins: [typesugar(), ...otherPlugins];
```

2. Check file is included:

```typescript
typesugar({
  include: ["**/*.ts", "**/*.tsx"],
});
```

3. Check console for errors during build.

### Webpack: "Transform not found"

1. Ensure ts-patch is installed
2. Check astTransformers config in Jest:

```javascript
transform: {
  "^.+\\.tsx?$": [
    "ts-jest",
    {
      astTransformers: {
        before: ["@typesugar/transformer"],
      },
    },
  ],
}
```

### Next.js: Macros Work in Build but Not Dev

**Cause:** Using Turbopack (`next dev --turbo`).

**Fix:** Use webpack mode for development:

```bash
next dev  # Not: next dev --turbo
```

### esbuild: No Type Checking

**Cause:** esbuild doesn't type-check.

**Fix:** Run `tsc --noEmit` separately or use tsup with `dts: true`.

## ESLint Issues

### False Positives on Macro Syntax

**Cause:** ESLint sees unexpanded code.

**Fix:** Install and configure the ESLint plugin:

```bash
npm install --save-dev @typesugar/eslint-plugin
```

```javascript
// eslint.config.js
import typesugar from "@typesugar/eslint-plugin";
export default [...typesugar.configs.recommended];
```

### ESLint Very Slow

**Cause:** Using the `full` processor.

**Fix:** Use `recommended` (lightweight) processor:

```javascript
export default [...typesugar.configs.recommended];
```

## Performance Issues

### Slow Initial Build

**Cause:** All macros compile on first run.

**Mitigations:**

1. Use incremental builds: `"incremental": true` in tsconfig
2. Use Turborepo/Nx for caching in monorepos
3. Limit scope with `include` patterns

### Slow IDE

**Cause:** Large project or many macro expansions.

**Mitigations:**

1. Exclude generated files: `"exclude": ["dist/**"]`
2. Use project references
3. Enable `"skipLibCheck": true`

## Debug Mode

### Get Verbose Output

```bash
# CLI
npx typesugar build --verbose

# Or in tsconfig.json
{
  "compilerOptions": {
    "plugins": [
      { "transform": "@typesugar/transformer", "verbose": true }
    ]
  }
}
```

### See Expanded Code

```bash
# Full expanded file
npx typesugar expand src/main.ts

# With diff
npx typesugar expand src/main.ts --diff

# As AST
npx typesugar expand src/main.ts --ast
```

## Getting Help

If none of the above solves your issue:

1. Run `npx typesugar doctor --verbose` and note the output
2. Create a minimal reproduction
3. Open an issue at https://github.com/typesugar/typesugar/issues

Include:

- `typesugar doctor` output
- tsconfig.json
- Build tool config
- Error message / unexpected behavior
- Node.js and TypeScript versions
