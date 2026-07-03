# Refined Types Integration

Bridge refinement types with compile-time contract verification. Import once to enable the prover to understand refinement predicates.

`@typesugar/contracts-refined` bridges `@typesugar/type-system` refinement types with `@typesugar/contracts` compile-time verification. Import this module once to enable the prover to understand and verify refinement type predicates automatically.

## Quick Start

```bash
npm install @typesugar/contracts-refined
```

```typescript
// Enable refined type predicates for the prover
import "@typesugar/contracts-refined";

import { Positive, Byte } from "@typesugar/type-system";
import { contract } from "@typesugar/contracts";

@contract
function add(a: Positive, b: Positive): number {
  requires: { a > 0 && b > 0 } // Proven by type!
  ensures: { result > 0 }      // Also provable
  return a + b;
}
```

The explicit `@contract` decorator needs no extra activation — importing the
`contract` symbol is the opt-in. To use bare `requires:`/`ensures:` blocks
without the decorator, add `import "@typesugar/contracts/syntax";` to the file
(PEP-052 label-syntax activation; see the [Contracts Guide](/guides/contracts#activation)).

## What Gets Registered

All built-in refinement types from `@typesugar/type-system`:

| Category      | Types                                                                                |
| ------------- | ------------------------------------------------------------------------------------ |
| **Numeric**   | `Positive`, `NonNegative`, `Negative`, `Int`, `Byte`, `Port`, `Percentage`, `Finite` |
| **String**    | `NonEmpty`, `Trimmed`, `Lowercase`, `Uppercase`, `Email`, `Url`, `Uuid`              |
| **Array**     | `NonEmptyArray`                                                                      |
| **Dependent** | `Vec<N>` (length-indexed vectors)                                                    |

## Subtyping Rules

The integration registers safe widening rules, allowing the prover to verify safe coercions at compile time:

- `Positive` → `NonNegative` (x > 0 implies x >= 0)
- `Byte` → `NonNegative`, `Int`
- `Port` → `Positive`, `NonNegative`, `Int`
- `Percentage` → `NonNegative`

## Custom Refinements

```typescript
import { registerRefinementPredicate } from "@typesugar/contracts-refined";

registerRefinementPredicate("PositiveEven", "$ > 0 && $ % 2 === 0");

type PositiveEven = Refined<number, "PositiveEven">;

@contract
function halve(n: PositiveEven): number {
  ensures: { result > 0 }  // Provable!
  return n / 2;
}
```

## API Reference

### Functions

- `registerRefinementPredicate(brand, predicate, decidability?)` — Register a custom refinement predicate
- `getRegisteredPredicates()` — Get all registered predicates (built-in + custom)
- `hasRefinementPredicate(brand)` — Check if a predicate is registered

### Re-exports from `@typesugar/contracts`

- `getRefinementPredicate()`, `registerSubtypingRule()`, `canWiden()`
- `registerDecidability()`, `getDecidability()`, `isCompileTimeDecidable()`
- `registerDynamicPredicateGenerator()` — For parameterized types like `Vec<N>`

### Re-exports from `@typesugar/type-system`

- All refinement types and their utilities
- `Vec`, `isVec`, `extractVecLength`, `generateVecPredicate`
- `widen()`, `widenTo()`, `isSubtype()`

## Learn More

- [Contracts Guide](/guides/contracts)
- [Type System Guide](/guides/type-system)
- [API Reference](/reference/packages#contracts-refined)
