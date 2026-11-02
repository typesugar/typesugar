# typesugar

> 📖 **Full documentation:** [Getting Started](https://typesugar.org/getting-started/). The microsite is the canonical reference; this README is a quickstart.

> Syntactic sugar for TypeScript with zero calories. Typeclasses, operator overloading, pattern matching and more through compile-time macros and zero-cost abstractions.

## Overview

typesugar brings compile-time metaprogramming to TypeScript, drawing on Rust, Scala 3 and Zig. Write macros that transform code at compile time, eliminating runtime overhead while maintaining full type safety.

This is the umbrella package. Its root entry (`typesugar`) is runtime-only: it exports the
typed placeholders you call in your code (`comptime`, `derive`, `pipe`, `summon`, ...) and
the derive markers (`Eq`, `Clone`, ...), and never loads the TypeScript compiler, so it is
safe in browser bundles. The macro-authoring APIs (`defineExpressionMacro`,
`globalRegistry`, ...) are at the `typesugar/core` subpath. The bundler plugins are at
`typesugar/vite`, `typesugar/webpack`, `typesugar/esbuild` and `typesugar/rollup`.

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
import { comptime, derive, pipe, Eq, Debug, Clone } from "typesugar";

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
// Generates companions: User.Eq, User.Debug, User.Clone
// e.g. User.Eq.equals(a, b), User.Clone.clone(a), User.Debug.debug(a)

// Operator overloading — via typeclass @op JSDoc (e.g., Numeric, Semigroup),
// turned on per file with an activation import such as
// import "@typesugar/std/syntax/semigroup/ops";
// When an instance exists: a + b compiles to a call to its combine method

// Function composition
const process = pipe(data, parse, validate, transform);
// Compiles to: transform(validate(parse(data)))
```

## Features

### Compile-Time Evaluation

Evaluate expressions during compilation — constants, computed values, complex logic.

### Derive Macros (`@typesugar/derive`)

Auto-generate implementations: Eq, Ord, Clone, Debug, Hash, Default, Json, TypeGuard.

### Type Reflection (`@typesugar/reflect`)

Compile-time type introspection: `typeInfo<T>()`, `fieldNames<T>()`, `validator<T>()`.

### Operator Overloading

Operators (`+`, `-`, `*`, `/`, etc.) dispatch to typeclass methods via `@op` JSDoc tags on typeclass method signatures. In a file that imports the typeclass's activation module (for example `import "@typesugar/std/syntax/eq/ops"`), and when an instance exists, `a === b` compiles directly to the method call — no wrapper needed.

### Typeclasses (`@typesugar/typeclass`)

Scala 3-style typeclass system with `@typeclass`, `@impl`, `@derive`, `derived()`
(for types you don't own) and `summon()`.

### Zero-Cost Abstractions

Typeclass dictionary passing is eliminated at compile time automatically — an
always-on optimization, not an API you call.

## Package Structure

| Package                  | Description                         |
| ------------------------ | ----------------------------------- |
| `typesugar`              | Umbrella package (this one)         |
| `@typesugar/core`        | Foundation types, registry, context |
| `@typesugar/transformer` | TypeScript transformer              |
| `@typesugar/macros`      | Built-in macro implementations      |
| `@typesugar/derive`      | Derive macros                       |
| `@typesugar/reflect`     | Type reflection                     |
| `@typesugar/typeclass`   | Typeclass system                    |
| `unplugin-typesugar`     | Bundler plugins                     |
| `typesugar-vscode`       | VS Code extension (not on npm)      |

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

// tsup: the esbuild plugin, plus `dts: true` from the expanded program
import { withTypesugar } from "typesugar/tsup";
export default defineConfig(withTypesugar({ entry: ["src/index.ts"], dts: true }));
```

To run TypeScript with macros in Node (scripts, tsx, `node --test`), use the module
hooks: `node --import typesugar/register src/main.ts`. See
[Node.js, tsx and node:test](https://typesugar.org/getting-started/environments/node).

## CLI

```bash
# Wire typesugar into an existing project
npx typesugar init

# Compile and run a file in one step
npx typesugar run src/main.ts

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

### Root entry (`typesugar`)

- Placeholders for the built-in macros: `comptime`, `derive`, `pipe`, `compose`, `flow`,
  `typeclass`, `impl`, `instance`, `summon`, `summonAll`, `derived`, `extend`, `implicit`,
  `extension`, `reflect`, `typeInfo`, `fieldNames`, `validator`, `cfg`, `cfgAttr`,
  `includeStr`, `includeText`, `includeBytes`, `includeJson`, `staticAssert`,
  `compileError`, `compileWarning`, `tailrec`, `hkt`. These are runtime stubs the
  transformer replaces; they are functions, not namespaces.
- `derived<TC<T>>()` declares an instance derived from a type's structure, for a type you
  can't put `@derive` on (one from a library):
  `export const cloneFeature = derived<Clone<Feature>>();`. The const is the instance, found
  by `summon`, `= implicit()` and method syntax wherever its module is imported.
- Derive markers: `Eq`, `Ord`, `Clone`, `Debug`, `Hash`, `Default`, `Json`, `TypeGuard`,
  `Show`, `Semigroup`, `Monoid`. Each one with a typeclass interface is also that
  typeclass as a type (`@typesugar/std`'s, and `@typesugar/fp`'s `Show`), so one import
  serves both `@derive(Clone)` and `summon<Clone<Point>>()`. `Default` and `TypeGuard`
  are values only.
- `defineConfig(cfg)` — typed helper for `typesugar.config.ts`.
- All `@typesugar/core` types (`MacroContext`, `MacroDefinition`, ...), as types only.
- `registerAllMacros()` — deprecated no-op, kept for compatibility. The transformer loads
  macro packages itself.

### `typesugar/core`

Everything from `@typesugar/core`, as values: `defineExpressionMacro` and the other
`define*Macro` functions, `globalRegistry`, `config`, and the rest of the macro-authoring
API. This entry loads the TypeScript compiler, so import it only from build-time code
(macro definitions, config scripts), never from app code.

## License

MIT
