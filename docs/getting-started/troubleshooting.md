# Troubleshooting

This guide covers common issues and how to resolve them.

## Quick Diagnostics

Run the doctor command first:

```bash
npx typesugar doctor
```

This checks your configuration and provides actionable fixes.

## Installation Issues

### "…declare a "typesugar.macros" entry but are not @typesugar/\*-scoped and have not been approved"

**Cause:** A library you depend on ships macros, and it is outside the auto-trusted
`@typesugar/*` scope. typesugar won't run a third-party package's macros until you
approve them.

**Fix:** Run `npx typesugar approve-macros` and commit the `typesugar.config.ts` it
writes (see [End User Guide](./end-user.md#step-5-approve-the-library-s-macros)).

### "TypeScript 7.x is not supported" {#typescript-7}

The full message starts `[typesugar] TypeScript 7.0.2 is not supported: TypeScript 7 removed
the JavaScript compiler API that typesugar's transformer needs.`

**Cause:** typesugar's transformer, bundler plugin, language-service plugin and
ESLint plugin are built on TypeScript's JavaScript compiler API (`ts.factory`,
`ts.createProgram`, transformers, the type checker). TypeScript 5.x and 6.x have it.
TypeScript 7 (the native port, `typescript@latest` since July 2026) does not: its package
root exports only the version, so typesugar checks the version when it starts and stops
with this message instead of failing later with an opaque `Cannot read properties of
undefined`. The same message, with different wording, appears for a `typescript` older
than 5.9 or a module missing `ts.factory` / `ts.createProgram`. (Before 5.5, Node's ESM
loader sees none of TypeScript's named exports; 5.5 to 5.8 lack checker methods typesugar
uses to resolve `@impl X<object>` and `@impl X<unknown>` instances.)

**Fix:** install TypeScript 6 (or 5.9) as the project's `typescript`:

```bash
npm install --save-dev typescript@6
```

typesugar supports `typescript` `>=5.9.0 <7.0.0`. If you also want TypeScript 7's compiler
for your own type-checking, install it under an npm alias (for example
`"typescript-7": "npm:typescript@^7"`) so that the name `typescript` still resolves to 6.x.
Note that typesugar's suppression of sugar-specific diagnostics (operators, extension
methods) only runs inside the TypeScript that typesugar hosts, not inside TypeScript 7's
compiler; use `npx typesugar check` for the type-check that understands typesugar.

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
npm update @typesugar/transformer @typesugar/core @typesugar/macros
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

### @derive Methods Missing ("user.clone is not a function")

**Cause #1 (most common): the method syntax isn't activated in this file.** Since
PEP-052, `@derive(Clone)` generates a `User.Clone` companion, but `user.clone()` is
only rewritten to `User.Clone.clone(user)` in files that import the syntax marker.
Without it the call is left alone, nothing is reported, and it fails at runtime.

**Fix:** import the marker for each method you call:

```typescript
import "@typesugar/std/syntax/eq"; // .equals()   (`/ops` adds ===, !==)
import "@typesugar/std/syntax/ord"; // .compare()  (`/ops` adds <, <=, >, >=)
import "@typesugar/std/syntax/clone"; // .clone()
import "@typesugar/std/syntax/debug"; // .debug()
import "@typesugar/std/syntax/json"; // .toJson(), User.fromJson()
```

**Cause #2: the receiver's type isn't known.** The type checker sees the unexpanded
source. typesugar recovers the type of a value that comes from another sugared call
(`const c = p.clone(); c.equals(p)`, `const r = (0).to(9).step(3); r.toArray()`) when
that call is an imported extension function or a typeclass method that returns its
own type parameter (`clone(a: A): A`). For anything else, annotate the variable:
`const c: Point = p.clone();`.

**Other causes:**

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
    "plugins": [{ "name": "@typesugar/transformer/language-service" }]
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
3. Restart the TypeScript server after changing `tsconfig.json`.

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

2. Check file is included. `include`/`exclude` strings are globs matched against
   the absolute module path (relative ones resolve against Vite's root), and the
   default is every `.ts/.tsx/.js/.jsx` file, so the simplest fix is often to remove
   a custom `include`:

```typescript
typesugar({
  include: ["src/**/*.ts", "src/**/*.tsx"],
});
```

3. Check console for errors during build.

### Webpack: "typesugar is not a function"

In a CommonJS config, the plugin is the module's `default` export:

```javascript
const typesugar = require("unplugin-typesugar/webpack").default;
```

### Jest

There is no working Jest (ts-jest) integration; use [Vitest](./environments/vitest.md).
See [Jest](./environments/jest.md).

### Next.js: Macros Work in Build but Not Dev

**Cause:** Turbopack is in use. It doesn't run Webpack plugins.

**Fix:** Use Webpack mode. In Next.js 16 and later, Turbopack is the default, so pass
`--webpack` (`next dev --webpack`, `next build --webpack`); in Next.js 13–15, don't
pass `--turbo`. See [Webpack Setup](./environments/webpack.md#important-turbopack-limitation).

### esbuild: No Type Checking

**Cause:** esbuild doesn't type-check.

**Fix:** Run `typesugar check` separately. (Plain `tsc --noEmit` doesn't expand
macros, so it type-checks the unexpanded source and reports phantom errors.)

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
export default [typesugar.configs.recommended];
```

### ESLint Very Slow

**Cause:** Using the `full` processor.

**Fix:** Use `recommended` (lightweight) processor:

```javascript
export default [typesugar.configs.recommended];
```

## Performance Issues

### Slow Initial Build

**Cause:** All macros compile on first run.

**Mitigations:**

1. Enable the disk cache: `typesugar build --cache` (or `diskCache: true` in the
   bundler plugin)
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
