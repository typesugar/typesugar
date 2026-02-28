# typesugar Basic Example

Demonstrates core typesugar features: compile-time evaluation, derive macros,
operator overloading, and tagged template macros.

## Setup

```bash
npm install
```

## Usage

### With the typesugar CLI

```bash
# Compile with macro expansion
npx typesugar build

# Type-check only (no output)
npx typesugar check

# Verbose mode to see macro expansion
npx typesugar build --verbose
```

### With ts-patch (alternative)

```bash
# Patch TypeScript to support transformer plugins
npx ts-patch install

# Compile with tsc (ts-patch enables the transformer)
npx tspc
```

### Run the output

```bash
node dist/main.js
```

## What to Look For

- `comptime(() => ...)` calls are replaced with their computed values
- `@derive(Eq, Clone, Debug)` generates helper functions alongside the type
- `ops(a + b)` is rewritten to `a.add(b)` based on `@operators` config
- `pipe(x, f, g)` is rewritten to `g(f(x))`

Enable `--verbose` to see each macro expansion as it happens.
