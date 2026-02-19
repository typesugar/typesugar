# @ttfx/contracts-refined

> Refinement type integration for @ttfx/contracts.

## Overview

`@ttfx/contracts-refined` bridges `@ttfx/type-system` refinement types with `@ttfx/contracts` compile-time verification. Import this module once to enable the prover to understand and verify refinement type predicates automatically.

## Installation

```bash
npm install @ttfx/contracts-refined
# or
pnpm add @ttfx/contracts-refined
```

## Usage

```typescript
// In your entry point or setup file:
import "@ttfx/contracts-refined";

// Now refined types work seamlessly with contracts:
import { Positive, Byte, Port } from "@ttfx/type-system";
import { contract } from "@ttfx/contracts";

@contract
function add(a: Positive, b: Positive): number {
  requires: { a > 0 && b > 0 } // Proven by type, eliminated at compile-time
  ensures: { result > 0 }      // Also provable: sum of positives is positive
  return a + b;
}
```

## What Gets Registered

All built-in refinement types from `@ttfx/type-system`:

| Category | Types |
|----------|-------|
| **Numeric** | `Positive`, `NonNegative`, `Negative`, `Int`, `Byte`, `Port`, `Percentage`, `Finite` |
| **String** | `NonEmpty`, `Trimmed`, `Lowercase`, `Uppercase`, `Email`, `Url`, `Uuid` |
| **Array** | `NonEmptyArray` |
| **Dependent** | `Vec<N>` (length-indexed vectors) |

## Subtyping Coercions

The integration registers subtyping rules that enable safe widening:

- `Positive` → `NonNegative` (x > 0 implies x >= 0)
- `Byte` → `NonNegative`, `Int`
- `Port` → `Positive`, `NonNegative`, `Int`
- `Percentage` → `NonNegative`

This allows the prover to verify safe coercions at compile time.

## Custom Refinements

Register predicates for custom refinement types:

```typescript
import { registerRefinementPredicate } from "@ttfx/contracts-refined";

// Register your custom refinement
registerRefinementPredicate("PositiveEven", "$ > 0 && $ % 2 === 0");

// Now the prover knows about your custom type
type PositiveEven = Refined<number, "PositiveEven">;

@contract
function halve(n: PositiveEven): number {
  ensures: { result > 0 }  // Provable: n/2 where n > 0 is positive
  return n / 2;
}
```

## API Reference

### Functions

- `registerRefinementPredicate(brand, predicate, decidability?)` — Register a custom refinement predicate
- `getRegisteredPredicates()` — Get all registered predicates (built-in + custom)
- `hasRefinementPredicate(brand)` — Check if a predicate is registered

### Re-exports from @ttfx/contracts

- `getRefinementPredicate()`, `registerSubtypingRule()`, `canWiden()`
- `registerDecidability()`, `getDecidability()`, `isCompileTimeDecidable()`
- `registerDynamicPredicateGenerator()` — For parameterized types like `Vec<N>`

### Re-exports from @ttfx/type-system

- All refinement types and their utilities
- `Vec`, `isVec`, `extractVecLength`, `generateVecPredicate`
- `widen()`, `widenTo()`, `isSubtype()`

## License

MIT
