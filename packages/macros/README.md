# @typesugar/macros

> 📖 **Full documentation:** [Compile-Time Eval guide](https://typesugar.org/guides/comptime). The microsite is the canonical reference; this README is a quickstart.

Built-in macro implementations for the typesugar transformer.

## Overview

This package contains the core macro implementations that power typesugar's compile-time features. Most users import these from `typesugar` or a feature package (like `@typesugar/derive` or `@typesugar/reflect`) rather than from here. Macro authors use it directly for the quasiquote helpers (`quote`, `quoteStatements`, `ident`, ...) and the derive helpers (`defineCustomDerive`, `defineFieldDerive`); see [Writing Macros](https://typesugar.org/writing-macros/).

## Installation

```bash
npm install @typesugar/macros
```

## Contents

This package provides implementations for:

- **Typeclass system**: `@typeclass`, `@impl`, `@derive`, `summon()`, `derived()`, `extend()`
- **Derivation**: `@derive()`, built-in derives (Eq, Ord, Clone, Debug, Hash, Default, Json, TypeGuard, Show, Semigroup, Monoid), and `derived<TC<T>>()` for types you don't own
- **Specialization**: always-on compile-time dictionary inlining (no API — `// @no-specialize` to opt out)
- **Compile-time evaluation**: `comptime()`
- **Reflection**: `@reflect`, `typeInfo<T>()`, `fieldNames<T>()`, `validator<T>()`
- **Operators**: `@op` JSDoc on typeclass methods, `pipe()`, `compose()`
- **HKT support**: `@hkt`, HKT parameter transformation
- **Conditional compilation**: `cfg()`, `@cfgAttr`
- **Static assertions**: `staticAssert()`, `compileError()`, `compileWarning()`
- **File inclusion**: `includeStr()`, `includeJson()`, `includeBytes()`
- **Tail recursion**: `@tailrec`
- **Extensions**: `registerExtensions()`, `registerExtension()`

## Usage

Most of these macros are automatically available when using `typesugar` with the transformer enabled:

```typescript
import { derive, Eq, Clone, comptime, pipe } from "typesugar";
import * as fs from "node:fs";

@derive(Eq, Clone)
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}

// File access inside comptime needs an explicit permission
const config = comptime({ fs: "read" }, () => JSON.parse(fs.readFileSync("./config.json", "utf8")));

const result = pipe(
  5,
  (n: number) => n + 1,
  (n: number) => n * 2,
  String
); // "12"
```

`@derive(Eq, Clone)` generates `Point.Eq` and `Point.Clone` companions, `comptime` inlines
the parsed JSON as an object literal, and `pipe` becomes nested calls.

## What Remains at Runtime

Macros expand at compile time, but their output is ordinary code, and some of it is
runtime code by design: derives emit companion objects (`Point.Eq`), a `match` whose arms
the macro can't prove cover the value ends in a `throw new MatchError(...)` (imported from
`@typesugar/std`; a match of plain literal arms compiles to a conditional and imports
nothing), and some macros emit imports of small runtime helpers.

## API Reference

See the main [typesugar documentation](https://github.com/typesugar/typesugar) for detailed API documentation.

## License

MIT
