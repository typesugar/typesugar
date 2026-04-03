# Getting Started

This guide will help you set up typesugar in your TypeScript project.

## Installation

### 1. Install the packages

```bash
# Core packages (typescript is a required peer dependency)
npm install typesugar @typesugar/transformer typescript

# Or with pnpm
pnpm add typesugar @typesugar/transformer typescript
```

### 2. Quick Start with the CLI

The fastest way to try TypeSugar — no build tool configuration needed:

```bash
npx typesugar run src/main.ts    # compile + execute in one step
npx typesugar check              # typecheck with macro expansion
npx typesugar build              # compile to dist/
npx typesugar expand src/main.ts # show macro-expanded output
npx typesugar init               # interactive project setup wizard
```

### 3. Configure your build tool

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
    "plugins": [{ "transform": "@typesugar/transformer" }],
    "skipLibCheck": true
  }
}
```

> **Note:** `skipLibCheck: true` is recommended to avoid spurious errors from TypeSugar's generated declaration files (especially `@typesugar/fp`).

## Your First Macro

### comptime — Compile-Time Evaluation

```typescript
import { comptime } from "typesugar";

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
# Compile-time evaluation (included in typesugar umbrella)

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
      // Typecheck expanded output at build end (catches macro bugs)
      strict: false,

      // Log macro expansions (useful for debugging)
      verbose: false,

      // File patterns to include
      include: ["**/*.ts", "**/*.tsx"],

      // File patterns to exclude
      exclude: ["node_modules/**"],
    }),
  ],
});
```

### Typechecking

**Important:** Build tools (Vite, esbuild, Webpack, Rollup) do NOT typecheck your code by default — they only transform it. To get type errors:

1. **Run `tsc --noEmit` separately** (recommended for CI)
2. **Use `strict: true`** to typecheck the expanded output at build end
3. **Use tsc with ts-patch** for integrated typechecking

```bash
# Add to your CI or pre-commit hook
tsc --noEmit
```

## Pattern Matching

TypeSugar provides two forms of pattern matching:

```typescript
import { match } from "@typesugar/std";

type Shape = { kind: "circle"; radius: number } | { kind: "rect"; width: number; height: number };

// Object form (works at runtime, no macro expansion needed)
const area = match(shape, {
  circle: (s) => Math.PI * s.radius ** 2,
  rect: (s) => s.width * s.height,
});

// Fluent form (requires the TypeSugar transformer for macro expansion)
const area2 = match(shape)
  .case({ kind: "circle" })
  .then((s) => Math.PI * s.radius ** 2)
  .case({ kind: "rect" })
  .then((s) => s.width * s.height)
  .else(() => 0);
```

## Option & Either (Zero-Cost Representation)

`@typesugar/fp` uses a zero-cost representation: `Some(x)` returns the raw value `x`, and `None` is `null`. This means Option values have zero allocation overhead, but dot-syntax like `.map()` and `.flatMap()` requires the TypeSugar transformer to expand:

```typescript
import { Some, None, Option, isSome } from "@typesugar/fp";

const x: Option<number> = Some(42); // x is just 42 at runtime
const y: Option<number> = None; // y is null at runtime

// With transformer: dot-syntax works (expanded at compile time)
const doubled = x.map((n) => n * 2);

// Without transformer: use manual null checks
if (x != null) {
  console.log(x * 2); // x is narrowed to number
}
```

## Next Steps

- [Macro Types](./macro-types.md) — Learn about different kinds of macros
- [Writing Macros](./writing-macros.md) — Create your own macros
- [Package Reference](./index.md#packages) — Explore available packages
