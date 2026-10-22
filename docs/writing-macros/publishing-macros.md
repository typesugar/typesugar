# Publishing Macros

This guide covers packaging and distributing typesugar macros. For the full background
(runtime vs. macro entries, `.d.ts` metadata, zero-cost runtime libraries), see
[Authoring & Shipping a typesugar Library](../guides/authoring-libraries.md).

## Package Structure

A macro package has two entries:

- `.` (the runtime entry): the placeholders users import. It must not import
  `typescript` or `@typesugar/core`, or they end up in the app bundle.
- `./macros` (the macro entry): the definitions and their `globalRegistry.register(...)`
  calls. Only the transformer loads it, at build time.

```
my-macro-package/
  package.json
  tsconfig.json
  tsup.config.ts
  src/
    index.ts          # Runtime entry: placeholders
    macros.ts         # Macro entry: definitions + registration
  tests/
    my-macro.test.ts
  dist/
    index.js / index.cjs / index.d.ts
    macros.js / macros.cjs / macros.d.ts
```

## Package Configuration

### package.json

```json
{
  "name": "my-macro-package",
  "version": "1.0.0",
  "description": "My custom typesugar macros",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./macros": {
      "types": "./dist/macros.d.ts",
      "import": "./dist/macros.js",
      "require": "./dist/macros.cjs"
    }
  },
  "typesugar": {
    "macros": "./macros"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "prepublishOnly": "npm run build && npm test"
  },
  "keywords": ["typesugar", "macro", "typescript"],
  "peerDependencies": {
    "@typesugar/core": ">=0.1.0",
    "typescript": ">=5.9.0 <7.0.0"
  },
  "devDependencies": {
    "@typesugar/core": "^0.1.0",
    "@typesugar/testing": "^0.1.0",
    "@typesugar/transformer": "^0.1.0",
    "tsup": "^8.0.0",
    "typescript": "^6.0.0",
    "vitest": "^2.0.0"
  }
}
```

The `typesugar.macros` field is what makes the transformer load your `./macros` entry.
See [Getting Discovered](#getting-discovered).

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### tsup.config.ts

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/macros.ts"],
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["@typesugar/core", "typescript"],
});
```

Build both formats. The transformer loads the macro entry with `require()`, so the
`require` condition of `./macros` must work.

This config doesn't expand macros: the macro entry defines them and the runtime entry
holds placeholders. If your runtime entry also _uses_ macros (a `/** @typeclass */`, a
`@derive`), wrap the config in `withTypesugar()` from `typesugar/tsup`, so the JavaScript
and the `.d.ts` files are expanded ([With tsup](../getting-started/environments/esbuild.md#with-tsup)).

## Source Structure

### src/index.ts

```typescript
// The runtime entry: placeholders only. No typescript, no @typesugar/core.

export interface MyMacroOptions {
  verbose?: boolean;
}

export function myMacro(value: number, options?: MyMacroOptions): number {
  throw new Error(
    "myMacro() should be compiled away. Make sure the typesugar transformer is configured."
  );
}
```

### src/macros.ts

```typescript
// The macro entry: loaded by the transformer at build time.
import { defineExpressionMacro, globalRegistry } from "@typesugar/core";
import * as ts from "typescript";

export const myMacro = defineExpressionMacro({
  name: "myMacro",
  module: "my-macro-package", // only expand myMacro() imported from this package
  expand(ctx, callExpr, args) {
    const arg = args[0];
    if (!arg) {
      ctx.reportError(callExpr, "myMacro() requires an argument");
      return callExpr;
    }
    // value + value
    return ctx.factory.createBinaryExpression(
      ctx.factory.createParenthesizedExpression(arg),
      ts.SyntaxKind.PlusToken,
      ctx.factory.createParenthesizedExpression(arg)
    );
  },
});

globalRegistry.register(myMacro);
```

Set `module` to your package name. A user who imports `myMacro` from
`"my-macro-package"` (or from a barrel that re-exports it) gets the expansion; an
unrelated function that happens to be called `myMacro` is left alone.

## Getting Discovered

The transformer only `require()`s a package's macro entry if that package's own
`package.json` declares it:

```json
{ "typesugar": { "macros": "./macros" } }
```

`"./macros"` resolves through your own `exports` map, to `my-macro-package/macros`. There
is no other way for a published package to get its macros loaded: no list to be added to,
no naming convention, and no transformer option that names macro modules. The transformer
finds your package when a file it compiles imports it, so the user's
`import { myMacro } from "my-macro-package"` is what triggers loading.

What happens next depends on your package's name:

- **`@typesugar/*` packages** (and the `typesugar` umbrella package) are trusted and load
  automatically. This scope is reserved for typesugar's own packages.
- **Any other name** must be approved by the consumer. The first build that sees your
  package fails with:

  ```
  The following package(s) declare a "typesugar.macros" entry but are not @typesugar/*-scoped and have not been approved:
    - my-macro-package

  Run `typesugar approve-macros` to review and approve them.
  ```

  Running `typesugar approve-macros` lists the new packages, asks for confirmation and
  records them in the consumer's `typesugar.config.ts`:

  ```typescript
  import { defineConfig } from "@typesugar/core";

  export default defineConfig({
    security: {
      allowedMacroPackages: ["my-macro-package"], // exact names, or "@scope/*"
    },
  });
  ```

  The file is committed, so later builds (local or CI) don't ask again. This is
  deliberate: compiling code that imports your package runs your package's code at build
  time. See [Security](../SECURITY.md).

Say this in your README, so consumers aren't surprised by the first failed build.

The same mechanism works for macros inside your own repository: put them in a workspace
package with a `typesugar.macros` field, depend on it from the app, and approve it once.

An import by relative path counts too: when `import { myMacro } from "../src/index.js"`
(your package's own examples or tests) or `"../my-macro-package/src"` lands in a package
whose `package.json` declares `typesugar.macros`, that package's macro entry is loaded.

Either way, the name in a `package.json` is only a claim, so a package's name is trusted
only for the package the _project_ resolves it to. The transformer resolves names from the
directories the project owns, and nowhere else:

- the project itself: the tsconfig's directory, the build's current directory, and the
  package root (nearest `package.json`) at or above each — so building inside your package
  (its own build, examples and tests) makes it the project;
- the workspace packages those declare (`pnpm-workspace.yaml` `packages:`, or `package.json`
  `workspaces`).

A bare import resolves from the owned directory containing the importing file (a pnpm
workspace package's own `node_modules`), then from the project. A relatively imported
package is trusted under its name when it is one of those directories, or when the name,
looked up in `node_modules` from one of them, lands in that same directory (a workspace
link, or a `"my-macro-package": "file:../my-macro-package"` dependency). A package's own
`exports` self-reference never counts, and neither does a `node_modules` directory below a
vendored package: a package reached only by following imports into code the project doesn't
own is not loaded, whatever its name, and each importing file gets a warning naming its
path. `typesugar approve-macros` lists those separately, since approving a name cannot help.

Then the usual rules apply to the name: `@typesugar/*` is trusted, anything else must be
approved, and `typesugar approve-macros` lists it. Nothing fails for an unverified package;
an unapproved verified one fails the build as above. The entry is the built one
(`./macros` through your `exports` map), so build the package first; in a file inside the
package itself a missing build is silent (it is the package's own build), anywhere else it
is a warning.

## Documentation

### README.md

````markdown
# my-macro-package

Custom typesugar macros for X.

## Installation

```bash
npm install my-macro-package
npx typesugar approve-macros   # once: allow this package's macros to run at build time
```

## Requirements

Requires the typesugar transformer to be configured (for example `unplugin-typesugar`).

## Usage

```typescript
import { myMacro } from "my-macro-package";

const result = myMacro(21); // Compiles to: (21) + (21)
```

## API

### myMacro(value)

Doubles the value at compile time.

**Parameters:**

- `value` - Any numeric expression

**Returns:** The doubled value

**Example:**

```typescript
myMacro(5); // → (5) + (5)
myMacro(x); // → (x) + (x)
```

## Requirements

- TypeScript `>=5.9.0 <7.0.0` (5.9 or 6.x; TypeScript 7 is not supported)
- @typesugar/core and the typesugar transformer
````

## Testing Before Publish

```bash
# Build
npm run build

# Test
npm test

# Check package contents
npm pack --dry-run

# Local install test
npm link
cd /path/to/test/project
npm link my-macro-package
npx typesugar approve-macros
```

In the test project, check that a call actually expands. If a build leaves `myMacro(21)`
in the output and the placeholder throws at runtime, the macro entry was not loaded: check
the `typesugar.macros` field and the `./macros` export.

## Publishing

### First Time

```bash
npm login
npm publish
```

### Updates

```bash
# Patch version (1.0.0 -> 1.0.1)
npm version patch

# Minor version (1.0.0 -> 1.1.0)
npm version minor

# Major version (1.0.0 -> 2.0.0)
npm version major

# Publish
npm publish
```

### Scoped Package

```json
{
  "name": "@myorg/my-macro-package",
  "publishConfig": {
    "access": "public"
  }
}
```

Consumers can approve every package in your scope at once with `"@myorg/*"` in
`allowedMacroPackages`.

## Monorepo Setup

For packages within a larger monorepo:

```json
{
  "dependencies": {
    "@typesugar/core": "workspace:*"
  }
}
```

Use `workspace:*` for internal dependencies, `^x.y.z` for external.

## Versioning

Follow semver:

- **Patch**: Bug fixes, no API changes
- **Minor**: New features, backward compatible
- **Major**: Breaking changes

Breaking changes for macros:

- Changing expansion output format
- Removing macro functions
- Changing required arguments
- Changing behavior significantly

## Common Mistakes

### 1. Missing Runtime Placeholder

Users get confusing errors if the macro doesn't expand:

```typescript
// Bad: No placeholder
export function myMacro() {}

// Good: Throws helpful error
export function myMacro() {
  throw new Error("myMacro() should be compiled away");
}
```

### 2. Macros in the Runtime Entry

```typescript
// Bad: src/index.ts re-exports from the file that registers the macros.
// Every app that imports a placeholder now bundles typescript and @typesugar/core.
export { myMacro } from "./macros.js";

// Good: placeholders live in src/index.ts; definitions live only in src/macros.ts.
export function myMacro(value: number): number {
  throw new Error("myMacro() should be compiled away");
}
```

### 3. Missing `typesugar.macros` Field

Without it, nothing loads your `./macros` entry, macro calls are left as they are, and the
placeholders throw at runtime.

### 4. Wrong Dependencies

```json
// Bad: a regular dependency (duplicate copies, version conflicts)
"dependencies": {
  "@typesugar/core": "^0.1.0"
}

// Good: peerDependency (the user's install provides it)
"peerDependencies": {
  "@typesugar/core": ">=0.1.0",
  "typescript": ">=5.9.0 <7.0.0"
}
```

### 5. Missing Type Exports

```typescript
// Bad: Types not exported
interface Options {}

// Good: Export types
export interface Options {}
```

### 6. No Documentation

Always document:

- Installation, including the one-time `typesugar approve-macros`
- Requirements
- Usage examples
- API reference

## Examples in the Wild

Look at typesugar's own packages for reference:

- `@typesugar/strings` (a small macro package with separate `.` and `./macros` entries)
- `@typesugar/sql`
- `@typesugar/macros` (comptime, derive, operators, etc.)

## Checklist

Before publishing:

- [ ] All tests pass, including ones that run the expanded code
- [ ] `./macros` entry exists, with a `require` build
- [ ] `"typesugar": { "macros": "./macros" }` is in package.json
- [ ] The `.` entry doesn't import `typescript` or `@typesugar/core`
- [ ] Each macro sets `module` to the package name
- [ ] README.md is complete, and mentions `typesugar approve-macros`
- [ ] Types are exported
- [ ] Runtime placeholder throws helpful error
- [ ] Peer dependencies are correct
- [ ] `files` in package.json includes necessary files
- [ ] Version number is updated
- [ ] CHANGELOG is updated (if applicable)
