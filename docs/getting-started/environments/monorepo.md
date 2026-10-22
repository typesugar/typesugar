# Monorepo Setup

This guide covers setting up typesugar in monorepo environments using pnpm workspaces, Turborepo, or Nx.

## pnpm Workspaces

### Project Structure

```
my-monorepo/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  packages/
    core/
      package.json
      tsconfig.json
    app/
      package.json
      tsconfig.json
```

### Root package.json

```json
{
  "name": "my-monorepo",
  "private": true,
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "@typesugar/transformer": "^0.1.0",
    "typescript": "^6.0.0"
  }
}
```

### pnpm-workspace.yaml

```yaml
packages:
  - "packages/*"
```

### Shared tsconfig.base.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "composite": true,
    "plugins": [
      { "name": "@typesugar/transformer/language-service" },
      { "transform": "@typesugar/transformer", "type": "program" }
    ]
  }
}
```

### Package tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "references": [{ "path": "../core" }]
}
```

### Package scripts

Build and type-check each package with the typesugar CLI. It builds one tsconfig at
a time (no `--build` mode), so let pnpm/Turborepo/Nx order the packages:

```json
{
  "scripts": {
    "build": "typesugar build",
    "typecheck": "typesugar check"
  }
}
```

## Turborepo

### turbo.json

Turborepo runs each package's own `package.json` scripts (above); `turbo.json`
only declares the task graph. Turborepo 2 uses the `tasks` key (1.x called it
`pipeline`):

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    }
  }
}
```

### Build with Turborepo

```bash
# Build all packages
turbo build

# Build specific package
turbo build --filter=@myorg/app
```

## Nx

### nx.json

```json
{
  "targetDefaults": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["{projectRoot}/dist"]
    }
  }
}
```

### project.json (per package)

```json
{
  "name": "core",
  "targets": {
    "build": {
      "executor": "nx:run-commands",
      "options": {
        "command": "typesugar build",
        "cwd": "packages/core"
      }
    }
  }
}
```

## Sharing Macro Definitions

### Central Macros Package

Create a shared package for custom macros:

```
packages/
  macros/
    package.json
    src/
      index.ts      # Re-exports all macros
      my-macro.ts   # Custom macro definition
```

### packages/macros/package.json

The `typesugar.macros` field is what makes the transformer load the package's
macros (PEP-055). Its value is a subpath of the package (`"./macros"` is loaded as
`@myorg/macros/macros`) whose module registers the macros:

```json
{
  "name": "@myorg/macros",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./macros": "./dist/macros.js"
  },
  "typesugar": {
    "macros": "./macros"
  },
  "dependencies": {
    "@typesugar/core": "^0.1.0"
  },
  "peerDependencies": {
    "@typesugar/transformer": ">=0.1.0"
  }
}
```

Because `@myorg/macros` is not under `@typesugar/*`, every package that uses it must
approve it once: run `npx typesugar approve-macros` (it writes
`security.allowedMacroPackages: ["@myorg/macros"]` into `typesugar.config.ts`, or use
`"@myorg/*"` to approve the whole scope) and commit the file. A config at the
monorepo root covers every package below it.

Macro packages resolve only from directories the project owns: the package you build
(its tsconfig's files and package root, and the current directory) and, when you
build from the monorepo root, the workspace packages its `pnpm-workspace.yaml` (or
`package.json` `workspaces`) declares, each from its own `node_modules`. A macro package
reached only through code outside those, such as a vendored directory's own
`node_modules`, is skipped with a warning naming its path (see
[Security](../../SECURITY.md)).

::: warning Known issue: `packages/<name>/` paths
typesugar maps any source file under a `/packages/<name>/` directory to the module
name `@typesugar/<name>` when it matches macro imports (PEP-059 P1 #18). A
workspace macro package whose files resolve to such a path (e.g. `packages/macros/`
reached through a pnpm symlink) can be mistaken for `@typesugar/macros`, so a macro
declared with `module: "@myorg/macros"` may not activate. This is a 1.0 bug, not
intended behaviour.
:::

### Using Shared Macros

In other packages:

```json
{
  "dependencies": {
    "@myorg/macros": "workspace:*"
  }
}
```

```typescript
// packages/app/src/index.ts
import { myMacro } from "@myorg/macros";

const result = myMacro(...);
```

## TypeScript Project References

The typesugar CLI does not support project references (`--build`) or
`.tsbuildinfo` incremental builds. A ts-patched `tsc --build` does run the
transformer when it emits, but it type-checks the unexpanded source (see
[tsc Setup](./tsc.md#typechecking)), so keep `typesugar check` as the type-check:

### tsconfig.json (root)

```json
{
  "files": [],
  "references": [{ "path": "packages/core" }, { "path": "packages/app" }]
}
```

### Build Command

```bash
# Build all with project references (ts-patch)
tsc --build

# Build specific project
tsc --build packages/app
```

## Vite Monorepo

For packages using Vite:

```typescript
// packages/app/vite.config.ts
import { defineConfig } from "vite";
import typesugar from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [
    typesugar({
      strict: false, // set true to type-check expanded output (experimental)
    }),
  ],
  resolve: {
    // Resolve workspace packages
    alias: {
      "@myorg/core": "../core/src",
    },
  },
});
```

### Typechecking in Monorepos

Vite doesn't type-check. Give each package a `"typecheck": "typesugar check"` script
(not `tsc --noEmit`, which never expands macros) and run it as a Turborepo task:

```json
// turbo.json — runs each package's "typecheck" script
{
  "tasks": {
    "typecheck": {
      "dependsOn": ["^build"]
    }
  }
}
```

```bash
# Run typecheck across all packages
turbo typecheck
```

## ts-patch in Monorepos

You only need ts-patch for a patched `tsc --build` with
[project references](#typescript-project-references); `typesugar build` and the
bundler plugins don't use it. ts-patch needs to patch the TypeScript installation. In
monorepos:

### Option 1: Root-level ts-patch

Patch once at the root:

```json
{
  "scripts": {
    "prepare": "ts-patch install -s"
  }
}
```

### Option 2: Use tspc

Use `tspc` instead of `tsc` to avoid patching:

```json
{
  "scripts": {
    "build": "tspc --build"
  },
  "devDependencies": {
    "ts-patch": "^3.0.0"
  }
}
```

## Troubleshooting

### "Transform not found" in packages

Ensure `@typesugar/transformer` is installed at the root or in each package that uses it.

### Different macro versions

Pin all typesugar packages to the same version:

```json
{
  "pnpm": {
    "overrides": {
      "@typesugar/core": "^0.1.0",
      "@typesugar/transformer": "^0.1.0"
    }
  }
}
```

### Slow builds

1. Use Turborepo or Nx for task caching
2. Enable the disk cache: `typesugar build --cache`

### IDE issues

Each package should extend the base tsconfig with the language service plugin configured.

## Next Steps

- [Editor Setup](../editor-setup.md)
- [Vitest Setup](./vitest.md) for testing
- [Troubleshooting](../troubleshooting.md)
