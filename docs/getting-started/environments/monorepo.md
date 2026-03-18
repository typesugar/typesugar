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
    "prepare": "ts-patch install -s"
  },
  "devDependencies": {
    "@typesugar/transformer": "^0.1.0",
    "ts-patch": "^3.0.0",
    "typescript": "^5.0.0"
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
      { "name": "typesugar/language-service" },
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

## Turborepo

### turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
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
        "command": "tsc --build",
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

```json
{
  "name": "@myorg/macros",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "dependencies": {
    "@typesugar/core": "^0.1.0"
  },
  "peerDependencies": {
    "@typesugar/transformer": ">=0.1.0"
  }
}
```

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

For faster incremental builds, use project references:

### tsconfig.json (root)

```json
{
  "files": [],
  "references": [{ "path": "packages/core" }, { "path": "packages/app" }]
}
```

### Build Command

```bash
# Build all with project references
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
      strict: true, // Typecheck expanded output (Vite doesn't typecheck)
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

Vite doesn't typecheck. For monorepos, common patterns:

```json
// turbo.json — separate typecheck task
{
  "pipeline": {
    "typecheck": {
      "dependsOn": ["^build"],
      "command": "tsc --noEmit"
    }
  }
}
```

```bash
# Run typecheck across all packages
turbo typecheck
```

## ts-patch in Monorepos

ts-patch needs to patch the TypeScript installation. In monorepos:

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

1. Use TypeScript project references
2. Enable incremental builds: `"incremental": true`
3. Use Turborepo or Nx for caching

### IDE issues

Each package should extend the base tsconfig with the language service plugin configured.

## Next Steps

- [Editor Setup](../editor-setup.md)
- [Vitest Setup](./vitest.md) for testing
- [Troubleshooting](../troubleshooting.md)
