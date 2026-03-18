# Configuration Reference

All configuration options for typesugar.

## tsconfig.json

### Transformer Plugin

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "transform": "@typesugar/transformer",
        "type": "program",
        "verbose": false
      }
    ]
  }
}
```

**Options:**

| Option      | Type    | Default     | Description                        |
| ----------- | ------- | ----------- | ---------------------------------- |
| `transform` | string  | —           | Must be `"@typesugar/transformer"` |
| `type`      | string  | `"program"` | Plugin type (use `"program"`)      |
| `verbose`   | boolean | `false`     | Enable verbose logging             |

### Language Service Plugin

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "typesugar/language-service"
      }
    ]
  }
}
```

Provides IDE integration for macro expansion previews.

## Vite Plugin (unplugin-typesugar)

```typescript
// vite.config.ts
import typesugar from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [
    typesugar({
      strict: false,
      verbose: false,
      include: ["**/*.ts", "**/*.tsx"],
      exclude: ["node_modules/**", "**/*.d.ts"],
      tsconfig: "./tsconfig.json",
      macroModules: [],
      config: {},
    }),
  ],
});
```

**Options:**

| Option         | Type     | Default                   | Description                    |
| -------------- | -------- | ------------------------- | ------------------------------ |
| `strict`       | boolean  | `false`                   | Typecheck expanded output      |
| `verbose`      | boolean  | `false`                   | Enable verbose logging         |
| `include`      | string[] | `["**/*.ts", "**/*.tsx"]` | File patterns to process       |
| `exclude`      | string[] | `["node_modules/**"]`     | File patterns to ignore        |
| `tsconfig`     | string   | Auto-detected             | Path to tsconfig.json          |
| `macroModules` | string[] | `[]`                      | Additional macro module paths  |
| `config`       | object   | `{}`                      | Conditional compilation config |

## Webpack Plugin

```javascript
// webpack.config.js
const typesugar = require("unplugin-typesugar/webpack");

module.exports = {
  plugins: [
    typesugar({
      strict: false,
      verbose: false,
      include: ["**/*.ts"],
      exclude: ["node_modules/**"],
    }),
  ],
};
```

Same options as Vite plugin.

## esbuild Plugin

```typescript
// build.ts
import { build } from "esbuild";
import typesugar from "unplugin-typesugar/esbuild";

build({
  plugins: [
    typesugar({
      strict: false,
      verbose: false,
    }),
  ],
});
```

Same options as Vite plugin.

## Rollup Plugin

```javascript
// rollup.config.js
import typesugar from "unplugin-typesugar/rollup";

export default {
  plugins: [
    typesugar({
      strict: false, // typecheck expanded output
      verbose: false,
    }),
  ],
};
```

Same options as Vite plugin.

**Typechecking:** Rollup does NOT typecheck. Use `strict: true` or run `tsc --noEmit` separately.

## Conditional Compilation Config

Pass configuration for `cfg()` and `@cfgAttr`:

```typescript
typesugar({
  config: {
    debug: process.env.NODE_ENV === "development",
    production: process.env.NODE_ENV === "production",
    platform: "web",
    "feature.experimental": false,
    "feature.analytics": true,
  },
});
```

Or in tsconfig.json:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "transform": "@typesugar/transformer",
        "config": {
          "debug": true,
          "production": false
        }
      }
    ]
  }
}
```

## ESLint Plugin

### Flat Config (eslint.config.js)

```javascript
import typesugar from "@typesugar/eslint-plugin";

export default [
  // Recommended: lightweight processor
  ...typesugar.configs.recommended,

  // Or: full transformer (slower, more accurate)
  // ...typesugar.configs.full,

  // Or: strict mode
  // ...typesugar.configs.strict,
];
```

### Legacy Config (.eslintrc)

```json
{
  "extends": ["plugin:@typesugar/recommended"],
  "plugins": ["@typesugar"]
}
```

## VSCode Extension

Settings in `.vscode/settings.json` or user settings:

```json
{
  "typesugar.enableCodeLens": true,
  "typesugar.enableInlayHints": true,
  "typesugar.enableDiagnostics": true,
  "typesugar.manifestPath": "typesugar.manifest.json"
}
```

| Setting             | Type    | Default                     | Description             |
| ------------------- | ------- | --------------------------- | ----------------------- |
| `enableCodeLens`    | boolean | `true`                      | Show expansion previews |
| `enableInlayHints`  | boolean | `true`                      | Show type hints         |
| `enableDiagnostics` | boolean | `true`                      | Show macro errors       |
| `manifestPath`      | string  | `"typesugar.manifest.json"` | Path to manifest file   |

## ts-patch

### Installation

```bash
npx ts-patch install
```

### Persistence

Add to package.json:

```json
{
  "scripts": {
    "prepare": "ts-patch install -s"
  }
}
```

### Verification

```bash
npx ts-patch check
```

## Jest (ts-jest)

```javascript
// jest.config.js
module.exports = {
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        astTransformers: {
          before: [
            {
              path: "@typesugar/transformer",
              options: { verbose: false },
            },
          ],
        },
      },
    ],
  },
};
```

## Package-Specific Config

### @typesugar/contracts

```typescript
import { configure } from "@typesugar/contracts";

configure({
  mode: "enabled", // "enabled" | "disabled" | "assume"
});
```

### Comptime Configuration

Timeout for compile-time evaluation (default: 5000ms):

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "transform": "@typesugar/transformer",
        "comptimeTimeout": 10000
      }
    ]
  }
}
```

## Environment Detection

typesugar auto-detects:

- **Package manager**: npm, pnpm, yarn, bun (from lock files)
- **Bundler**: Vite, Webpack, esbuild, Rollup, Next.js (from dependencies)
- **TypeScript**: From node_modules

Use `typesugar doctor` to verify detection.
