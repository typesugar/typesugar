# My typesugar Macros

Custom macros for typesugar.

## Features

- `logged()` — Wraps functions with logging
- `memo()` — Memoizes pure functions
- `@derive(Validation)` — Generates validation methods

## Installation

```bash
npm install my-typesugar-macros
```

**Requires:** Users need `@typesugar/transformer` configured.

## Usage

```typescript
import { logged, memo, Validation } from "my-typesugar-macros";
import { derive } from "@typesugar/derive";

// logged - adds console logging
const add = logged((a: number, b: number) => a + b);
add(1, 2); // logs: "Call: 1 2" and "Result: 3"

// memo - caches results
const fib = memo((n: number): number => {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
});
fib(50); // Fast! Uses memoization

// @derive(Validation) - generates validate()
@derive(Validation)
class User {
  name: string;
  age: number;
}

const user = new User("Alice", 30);
user.isValid(); // true
user.validate(); // []
```

## Development

```bash
npm install
npm run build
npm test
```

## Project Structure

```
src/
  index.ts         # Runtime placeholders & exports
  macros/
    index.ts       # Macro implementations (for transformer)
tests/
  logged.test.ts
  memo.test.ts
  validation.test.ts
```

## How It Works

1. **Runtime placeholders** (`src/index.ts`): TypeScript declarations that provide types
2. **Macro implementations** (`src/macros/index.ts`): Actual compile-time transformations

The transformer loads `my-typesugar-macros/macros` and replaces placeholder calls.

## Publishing

```bash
npm version patch
npm publish
```

## See Also

- [Writing Macros Guide](https://typesugar.dev/writing-macros/)
- [Testing Macros](https://typesugar.dev/writing-macros/testing-macros)
- [Publishing Macros](https://typesugar.dev/writing-macros/publishing-macros)
