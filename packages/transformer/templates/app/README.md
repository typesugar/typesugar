# typesugar App Template

A minimal application using typesugar features.

## Features Demonstrated

- `comptime()` — Compile-time evaluation
- `@derive()` — Auto-generated implementations
- `sql` — Type-safe SQL queries

## Getting Started

```bash
# Install dependencies
npm install

# Run ts-patch (required once)
npx ts-patch install

# Development
npm run dev

# Build
npm run build

# Type check
npm run typecheck
```

## Structure

```
src/
  main.ts     # Application entry point
```

## Next Steps

1. Add more models with `@derive()`
2. Use `@typesugar/contracts` for validation
3. Add `@typesugar/fp` for functional utilities
4. Set up testing with Vitest

## Documentation

- [Getting Started](https://typesugar.dev/getting-started)
- [Comptime Guide](https://typesugar.dev/guides/comptime)
- [Derive Guide](https://typesugar.dev/guides/derive)
