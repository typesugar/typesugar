# @ttfx/comptime

> Compile-time expression evaluation macro.

## Overview

`@ttfx/comptime` provides the `comptime()` macro, inspired by Zig's comptime keyword. It evaluates expressions during compilation and replaces them with their computed values — zero runtime overhead, full TypeScript type safety.

## Installation

```bash
npm install @ttfx/comptime
# or
pnpm add @ttfx/comptime
```

## Usage

```typescript
import { comptime } from "@ttfx/comptime";

// Simple expression
const x = comptime(() => 5 * 5);
// Compiles to: const x = 25;

// Complex computation
const factorial5 = comptime(() => {
  let result = 1;
  for (let i = 1; i <= 5; i++) result *= i;
  return result;
});
// Compiles to: const factorial5 = 120;

// Recursion
const fib10 = comptime(() => {
  function fib(n: number): number {
    return n <= 1 ? n : fib(n - 1) + fib(n - 2);
  }
  return fib(10);
});
// Compiles to: const fib10 = 55;

// Object literals
const config = comptime(() => ({
  version: "1.0.0",
  features: ["a", "b", "c"],
  computed: Math.PI * 2,
}));
// Compiles to: const config = { version: "1.0.0", features: ["a", "b", "c"], computed: 6.283185307179586 };
```

## Supported Value Types

The `comptime()` macro can serialize these types to AST:

- **Primitives**: `number`, `string`, `boolean`, `null`, `undefined`, `bigint`
- **Arrays**: Including nested arrays
- **Objects**: Plain objects (not class instances)
- **RegExp**: Converted to `RegExp(source, flags)` constructor call

## Sandbox Environment

Compile-time evaluation runs in a sandboxed Node.js `vm` context. Only safe, side-effect-free globals are available:

**Available:**

- `Math`, `Number`, `String`, `Boolean`, `Array`, `Object`
- `Map`, `Set`, `WeakMap`, `WeakSet`
- `JSON`, `Date`, `RegExp`, `Error`
- `parseInt`, `parseFloat`, `isNaN`, `isFinite`
- `console` (output goes to build log)

**Not Available:**

- File system (`fs`, `path`)
- Network (`fetch`, `http`)
- Process (`process`, `child_process`)
- Timers (`setTimeout`, `setInterval`)

This ensures compile-time code is deterministic and safe.

## Timeout

Evaluations are limited to 5 seconds by default. Infinite loops or very expensive computations will fail with a timeout error.

## Error Messages

The macro provides detailed error messages with source location and hints:

```
Compile-time evaluation failed at src/config.ts:15:9
  Source: comptime(() => fetchData())
  Error: fetchData is not defined
  Hint: 'fetchData' is not available in the comptime sandbox. Only safe
        built-ins (Math, JSON, Array, etc.) are accessible. File I/O,
        network, and process access are intentionally blocked.
```

## API Reference

### `comptime<T>(fn: () => T): T`

Evaluate `fn` at compile time and replace the call with the resulting value.

```typescript
// Type parameter is inferred from the function return type
const x = comptime(() => 42); // x: number
const s = comptime(() => "hello"); // s: string
```

### `register(): void`

Register the comptime macro with the global registry. Called automatically when the module is imported.

## License

MIT
