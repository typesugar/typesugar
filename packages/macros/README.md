# @typesugar/macros

Built-in macro implementations for the typesugar transformer.

## Overview

This package contains the core macro implementations that power typesugar's compile-time features. It is an **internal package** - most users should import from `typesugar` or specific feature packages (like `@typesugar/derive`, `@typesugar/reflect`, etc.) rather than directly from this package.

## Installation

```bash
npm install @typesugar/macros
```

## Contents

This package provides implementations for:

- **Typeclass system**: `@typeclass`, `@instance`, `@deriving`, `summon()`, `extend()`
- **Derivation**: `@derive()`, built-in derives (Eq, Ord, Clone, Debug, Hash, Default, Json, Builder, TypeGuard)
- **Specialization**: `specialize()`, `inlineMethod()`
- **Compile-time evaluation**: `comptime()`
- **Reflection**: `@reflect`, `typeInfo<T>()`, `fieldNames<T>()`, `validator<T>()`
- **Operators**: `@operators`, `ops()`, `pipe()`, `compose()`
- **HKT support**: `@hkt`, HKT parameter transformation
- **Conditional compilation**: `cfg()`, `@cfgAttr`
- **Static assertions**: `static_assert()`, `compileError()`, `compileWarning()`
- **File inclusion**: `includeStr()`, `includeJson()`, `includeBytes()`
- **Tail recursion**: `@tailrec`
- **Extensions**: `registerExtensions()`, `registerExtension()`

## Usage

Most of these macros are automatically available when using `typesugar` with the transformer enabled:

```typescript
import { derive, comptime, pipe } from "typesugar";

@derive(Eq, Clone)
class Point {
  constructor(public x: number, public y: number) {}
}

const config = comptime(() => JSON.parse(fs.readFileSync("./config.json", "utf8")));

const result = pipe(value, transform1, transform2, transform3);
```

## Zero-Cost Guarantee

All macros in this package compile away completely. At runtime, there is no overhead - just the optimized code that would result from manually writing the implementation.

## API Reference

See the main [typesugar documentation](https://github.com/typesugar/typesugar) for detailed API documentation.

## License

MIT
