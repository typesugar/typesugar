# @ttfx/contracts-z3

> Z3 SMT solver integration for @ttfx/contracts.

## Overview

`@ttfx/contracts-z3` provides a prover plugin that uses the Z3 theorem prover to verify contract conditions at compile time. For conditions that the built-in algebraic rules can't handle, Z3 can prove complex arithmetic, logical formulas, and array bounds.

## Installation

```bash
npm install @ttfx/contracts-z3
# or
pnpm add @ttfx/contracts-z3
```

## Usage

```typescript
import { registerProverPlugin } from "@ttfx/contracts";
import { z3ProverPlugin } from "@ttfx/contracts-z3";

// Option 1: Auto-initialize (first proof may be slower)
registerProverPlugin(z3ProverPlugin({ timeout: 2000 }));

// Option 2: Pre-initialize for faster first proof
const z3 = z3ProverPlugin({ timeout: 2000 });
await z3.init();
registerProverPlugin(z3);
```

## How it Works

1. Translates predicate strings + type facts into Z3 assertions
2. Adds the negation of the goal
3. If Z3 returns UNSAT, the goal is proven (negation is impossible)
4. If Z3 returns SAT or UNKNOWN, the goal is not proven

## Example

```typescript
import { contract } from "@ttfx/contracts";
import "@ttfx/contracts-z3"; // Registers Z3 as a prover plugin

@contract
function sqrt(x: number): number {
  requires: { x >= 0 }
  ensures: { result >= 0 && result * result <= x && (result + 1) * (result + 1) > x }
  // Complex postcondition that built-in algebra can't prove
  // Z3 handles this via SMT solving
  return Math.sqrt(x);
}
```

## Supported Syntax

The Z3 plugin parses and translates:

| Category | Operators |
|----------|-----------|
| **Arithmetic** | `+`, `-`, `*`, `/`, `%` |
| **Comparisons** | `>`, `>=`, `<`, `<=`, `===`, `!==`, `==`, `!=` |
| **Logical** | `&&`, `\|\|`, `!` |
| **Other** | Parentheses, property access (`obj.prop`), numeric/boolean literals |

## API Reference

### `z3ProverPlugin(options?)`

Create a Z3 prover plugin.

```typescript
interface Z3PluginOptions {
  /** Timeout in milliseconds for Z3 solver (default: 1000) */
  timeout?: number;
  /** Initialize Z3 eagerly on plugin creation (default: false) */
  eagerInit?: boolean;
}
```

Returns a `Z3ProverPlugin` with:
- `init()` — Pre-initialize Z3 WASM module
- `isReady()` — Check if Z3 is initialized
- `prove(goal, facts, timeout?)` — Prove a goal given type facts

### `proveWithZ3Async(goal, facts, options?)`

Standalone function for one-off proofs:

```typescript
import { proveWithZ3Async } from "@ttfx/contracts-z3";

const result = await proveWithZ3Async(
  "x + y > 0",
  [
    { variable: "x", predicate: "x > 0" },
    { variable: "y", predicate: "y >= 0" },
  ],
);

if (result.proven) {
  console.log("Goal proven via Z3");
}
```

### Types

```typescript
interface ProofResult {
  proven: boolean;
  method?: "constant" | "type" | "algebra" | "plugin";
  reason?: string;
}

interface TypeFact {
  variable: string;
  predicate: string;
}
```

## Performance Notes

- Z3 uses WebAssembly, so the first proof has initialization overhead (~100-500ms)
- Use `eagerInit: true` or call `init()` at startup to avoid first-proof latency
- Set appropriate timeouts for complex proofs (default: 1000ms)

## License

MIT
