# Getting Started

This guide will help you set up typesugar in your TypeScript project.

## Installation

### 1. Install the packages

```bash
# Core packages
npm install @typesugar/typesugar @typesugar/transformer

# Or with pnpm
pnpm add @typesugar/typesugar @typesugar/transformer
```

### 2. Configure your build tool

#### Vite

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import typesugar from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [typesugar()],
});
```

#### esbuild

```javascript
// build.js
import { build } from "esbuild";
import typesugar from "unplugin-typesugar/esbuild";

build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/bundle.js",
  plugins: [typesugar()],
});
```

#### Webpack

```javascript
// webpack.config.js
const typesugar = require("unplugin-typesugar/webpack");

module.exports = {
  plugins: [typesugar.default()],
};
```

#### ts-patch (for tsc)

```bash
npm install -D ts-patch
npx ts-patch install
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "plugins": [{ "transform": "@typesugar/transformer" }]
  }
}
```

## Your First Macro

### comptime — Compile-Time Evaluation

```typescript
import { comptime } from "@typesugar/comptime";

// This runs at compile time, not runtime!
const buildTime = comptime(new Date().toISOString());
const answer = comptime(21 * 2);

console.log(`Built at: ${buildTime}`);
console.log(`The answer is: ${answer}`);
```

After compilation:

```javascript
const buildTime = "2024-01-15T10:30:00.000Z";
const answer = 42;

console.log(`Built at: ${buildTime}`);
console.log(`The answer is: ${answer}`);
```

### @derive — Auto-Generate Implementations

```typescript
import { derive } from "@typesugar/derive";

@derive(Eq, Clone, Debug, Json)
class User {
  constructor(
    public id: number,
    public name: string,
    public email: string
  ) {}
}

// Now User has:
// - equals(other: User): boolean
// - clone(): User
// - debug(): string
// - toJson(): string
// - static fromJson(json: string): User
```

### sql — Type-Safe SQL

```typescript
import { sql } from "@typesugar/sql";

const userId = 42;
const query = sql`SELECT * FROM users WHERE id = ${userId}`;

console.log(query.text); // "SELECT * FROM users WHERE id = $1"
console.log(query.params); // [42]
```

## Installing Individual Packages

Install only what you need:

```bash
# Compile-time evaluation
npm install @typesugar/comptime

# Auto-derive implementations
npm install @typesugar/derive

# Type reflection
npm install @typesugar/reflect

# Type-safe SQL
npm install @typesugar/sql

# And more...
```

## Configuration Options

```typescript
// vite.config.ts
import typesugar from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [
    typesugar({
      // Log macro expansions (useful for debugging)
      verbose: false,

      // Timeout for comptime() evaluation (ms)
      timeout: 5000,

      // File patterns to include
      include: ["**/*.ts", "**/*.tsx"],

      // File patterns to exclude
      exclude: ["node_modules/**"],
    }),
  ],
});
```

## Next Steps

- [Macro Types](./macro-types.md) — Learn about different kinds of macros
- [Writing Macros](./writing-macros.md) — Create your own macros
- [Package Reference](./index.md#packages) — Explore available packages
