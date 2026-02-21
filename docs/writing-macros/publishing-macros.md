# Publishing Macros

This guide covers packaging and distributing typesugar macros.

## Package Structure

```
my-macro-package/
  package.json
  tsconfig.json
  tsup.config.ts
  src/
    index.ts          # Runtime exports (placeholders)
    macros/
      my-macro.ts     # Macro definitions
  tests/
    my-macro.test.ts
  dist/
    index.js
    index.d.ts
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
    }
  },
  "files": ["dist", "src"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "prepublishOnly": "npm run build && npm test"
  },
  "keywords": ["typesugar", "macro", "typescript"],
  "peerDependencies": {
    "@typesugar/transformer": ">=0.1.0",
    "typescript": ">=5.0.0"
  },
  "dependencies": {
    "@typesugar/core": "^0.1.0"
  },
  "devDependencies": {
    "@typesugar/testing": "^0.1.0",
    "tsup": "^8.0.0",
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
```

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
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["@typesugar/core", "typescript"],
});
```

## Source Structure

### src/index.ts

```typescript
// Re-export runtime placeholders
export { myMacro } from "./macros/my-macro.js";

// Re-export types
export type { MyMacroOptions } from "./macros/my-macro.js";
```

### src/macros/my-macro.ts

```typescript
import { defineExpressionMacro, type MacroContext } from "@typesugar/core";
import * as ts from "typescript";

export interface MyMacroOptions {
  verbose?: boolean;
}

// Register the macro
defineExpressionMacro("myMacro", {
  expand(ctx: MacroContext, callExpr: ts.CallExpression): ts.Expression {
    const arg = callExpr.arguments[0];

    if (!arg) {
      ctx.reportError(callExpr, "myMacro() requires an argument");
      return callExpr;
    }

    // Transform...
    return ctx.factory.createBinaryExpression(arg, ts.SyntaxKind.PlusToken, arg);
  },
});

// Runtime placeholder
export function myMacro<T>(value: T): T {
  throw new Error(
    "myMacro() should be compiled away. " + "Make sure @typesugar/transformer is configured."
  );
}
```

## Documentation

### README.md

````markdown
# my-macro-package

Custom typesugar macros for X.

## Installation

```bash
npm install my-macro-package
```

## Requirements

Requires `@typesugar/transformer` to be configured.

## Usage

```typescript
import { myMacro } from "my-macro-package";

const result = myMacro(21); // Compiles to: 21 + 21
```

## API

### myMacro(value)

Doubles the value at compile time.

**Parameters:**

- `value` - Any numeric expression

**Returns:** The doubled value

**Example:**

```typescript
myMacro(5); // → 10
myMacro(x); // → x + x
```

## Requirements

- TypeScript >= 5.0
- @typesugar/transformer >= 0.1.0
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
```

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

### 2. Wrong Peer Dependencies

```json
// Bad: dependency (bundled, version conflicts)
"dependencies": {
  "@typesugar/transformer": "^0.1.0"
}

// Good: peerDependency (user provides)
"peerDependencies": {
  "@typesugar/transformer": ">=0.1.0"
}
```

### 3. Missing Type Exports

```typescript
// Bad: Types not exported
interface Options {}

// Good: Export types
export interface Options {}
```

### 4. No Documentation

Always document:

- Installation
- Requirements
- Usage examples
- API reference

## Examples in the Wild

Look at typesugar's own packages for reference:

- `@typesugar/comptime`
- `@typesugar/derive`
- `@typesugar/sql`

## Checklist

Before publishing:

- [ ] All tests pass
- [ ] README.md is complete
- [ ] Types are exported
- [ ] Runtime placeholder throws helpful error
- [ ] Peer dependencies are correct
- [ ] `files` in package.json includes necessary files
- [ ] Version number is updated
- [ ] CHANGELOG is updated (if applicable)
