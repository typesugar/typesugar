# ttfx

> TypeScript that F\*cks! Compile-time macros for TypeScript.

## Overview

ttfx brings Scala 3-style metaprogramming to TypeScript. Write macros that transform code at compile time, eliminating runtime overhead while maintaining full type safety.

This is the umbrella package that re-exports all core ttfx functionality. Install this if you want everything.

## Installation

```bash
npm install ttfx
# or
pnpm add ttfx
```

## Quick Start

### 1. Configure your bundler

```typescript
// vite.config.ts
import ttfx from "ttfx/vite";

export default {
  plugins: [ttfx()],
};
```

### 2. Use macros in your code

```typescript
import { comptime, derive, ops, pipe } from "ttfx";

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

### Compile-Time Evaluation (`@ttfx/comptime`)

Evaluate expressions during compilation — constants, computed values, complex logic.

### Derive Macros (`@ttfx/derive`)

Auto-generate implementations: Eq, Ord, Clone, Debug, Hash, Default, Json, Builder, TypeGuard.

### Type Reflection (`@ttfx/reflect`)

Compile-time type introspection: `typeInfo<T>()`, `fieldNames<T>()`, `validator<T>()`.

### Operator Overloading (`@ttfx/operators`)

Transform `+`, `-`, `*`, `/` into method calls on your custom types.

### Typeclasses (`@ttfx/typeclass`)

Scala 3-style typeclass system with `@typeclass`, `@instance`, `@deriving`, and `summon()`.

### Zero-Cost Abstractions (`@ttfx/specialize`)

Eliminate typeclass dictionary passing at compile time for true zero-cost abstractions.

## Package Structure

| Package              | Description                         |
| -------------------- | ----------------------------------- |
| `ttfx`               | Umbrella package (this one)         |
| `@ttfx/core`         | Foundation types, registry, context |
| `@ttfx/transformer`  | TypeScript transformer              |
| `@ttfx/comptime`     | Compile-time evaluation             |
| `@ttfx/derive`       | Derive macros                       |
| `@ttfx/reflect`      | Type reflection                     |
| `@ttfx/operators`    | Operator overloading                |
| `@ttfx/typeclass`    | Typeclass system                    |
| `@ttfx/specialize`   | Zero-cost specialization            |
| `@ttfx/integrations` | Bundler plugins                     |
| `@ttfx/vscode`       | IDE extension                       |

## Bundler Integration

```typescript
// Vite
import ttfx from "ttfx/vite";

// Webpack
const ttfx = require("ttfx/webpack").default;

// esbuild
import ttfx from "ttfx/esbuild";

// Rollup
import ttfx from "ttfx/rollup";
```

## CLI

```bash
# Build with macro expansion
npx ttfx build

# Watch mode
npx ttfx watch

# Type-check only
npx ttfx check

# Show expanded output
npx ttfx expand src/file.ts
```

## API Reference

### Re-exported from `@ttfx/core`

All core types: `MacroKind`, `MacroContext`, `MacroDefinition`, etc.

### Re-exported Namespaces

- `comptime` — from `@ttfx/comptime`
- `reflect` — from `@ttfx/reflect`
- `derive` — from `@ttfx/derive`
- `operators` — from `@ttfx/operators`
- `typeclass` — from `@ttfx/typeclass`
- `specialize` — from `@ttfx/specialize`

### Functions

- `registerAllMacros()` — Register all built-in macros

## License

MIT
