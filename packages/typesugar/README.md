# typesugar

> TypeScript that F\*cks! Compile-time macros for TypeScript.

## Overview

typesugar brings Scala 3-style metaprogramming to TypeScript. Write macros that transform code at compile time, eliminating runtime overhead while maintaining full type safety.

This is the umbrella package that re-exports all core typesugar functionality. Install this if you want everything.

## Installation

```bash
npm install typesugar
# or
pnpm add typesugar
```

## Quick Start

### 1. Configure your bundler

```typescript
// vite.config.ts
import typesugar from "typesugar/vite";

export default {
  plugins: [typesugar()],
};
```

### 2. Use macros in your code

```typescript
import { comptime, derive, ops, pipe } from "typesugar";

// Compile-time evaluation
const factorial5 = comptime(() => {
  let result = 1;
  for (let i = 1; i <= 5; i++) result *= i;
  return result;
});
// Compiles to: const factorial5 = 120;

// Auto-derived implementations
@derive(Eq, Debug, Clone)
interface User {
  id: number;
  name: string;
}
// Generates: userEq(), debugUser(), cloneUser()

// Operator overloading
@operators({ "+": "add", "*": "scale" })
class Vec2 {
  constructor(public x: number, public y: number) {}
  add(other: Vec2) { return new Vec2(this.x + other.x, this.y + other.y); }
  scale(n: number) { return new Vec2(this.x * n, this.y * n); }
}

const result = ops((v1 + v2) * 3);
// Compiles to: v1.add(v2).scale(3)

// Function composition
const process = pipe(data, parse, validate, transform);
// Compiles to: transform(validate(parse(data)))
```

## Features

### Compile-Time Evaluation (`@typesugar/comptime`)

Evaluate expressions during compilation — constants, computed values, complex logic.

### Derive Macros (`@typesugar/derive`)

Auto-generate implementations: Eq, Ord, Clone, Debug, Hash, Default, Json, Builder, TypeGuard.

### Type Reflection (`@typesugar/reflect`)

Compile-time type introspection: `typeInfo<T>()`, `fieldNames<T>()`, `validator<T>()`.

### Operator Overloading (`@typesugar/operators`)

Transform `+`, `-`, `*`, `/` into method calls on your custom types.

### Typeclasses (`@typesugar/typeclass`)

Scala 3-style typeclass system with `@typeclass`, `@instance`, `@deriving`, and `summon()`.

### Zero-Cost Abstractions (`@typesugar/specialize`)

Eliminate typeclass dictionary passing at compile time for true zero-cost abstractions.

## Package Structure

| Package                  | Description                         |
| ------------------------ | ----------------------------------- |
| `typesugar`              | Umbrella package (this one)         |
| `@typesugar/core`        | Foundation types, registry, context |
| `@typesugar/transformer` | TypeScript transformer              |
| `@typesugar/comptime`    | Compile-time evaluation             |
| `@typesugar/derive`      | Derive macros                       |
| `@typesugar/reflect`     | Type reflection                     |
| `@typesugar/operators`   | Operator overloading                |
| `@typesugar/typeclass`   | Typeclass system                    |
| `@typesugar/specialize`  | Zero-cost specialization            |
| `unplugin-typesugar`     | Bundler plugins                     |
| `@typesugar/vscode`      | IDE extension                       |

## Bundler Integration

```typescript
// Vite
import typesugar from "typesugar/vite";

// Webpack
const typesugar = require("typesugar/webpack").default;

// esbuild
import typesugar from "typesugar/esbuild";

// Rollup
import typesugar from "typesugar/rollup";
```

## CLI

```bash
# Build with macro expansion
npx typesugar build

# Watch mode
npx typesugar watch

# Type-check only
npx typesugar check

# Show expanded output
npx typesugar expand src/file.ts
```

## API Reference

### Re-exported from `@typesugar/core`

All core types: `MacroKind`, `MacroContext`, `MacroDefinition`, etc.

### Re-exported Namespaces

- `comptime` — from `@typesugar/comptime`
- `reflect` — from `@typesugar/reflect`
- `derive` — from `@typesugar/derive`
- `operators` — from `@typesugar/operators`
- `typeclass` — from `@typesugar/typeclass`
- `specialize` — from `@typesugar/specialize`

### Functions

- `registerAllMacros()` — Register all built-in macros

## License

MIT
