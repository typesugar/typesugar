# Design by Contract for typesugar

> **Status**: Implemented (Phase 1-4). Z3 integration scaffolded. Coq-inspired extensions complete.

## Overview

`@typesugar/contracts` provides Design by Contract macros with:

- **`requires()`** — Precondition (inline or `requires:` labeled block)
- **`ensures()`** — Postcondition (inline or `ensures:` labeled block)
- **`old()`** — Capture pre-call value (inside ensures)
- **`@contract`** — Decorator enabling `requires:`/`ensures:` labeled blocks
- **`@invariant`** — Class invariant (checked after public methods)
- **Configurable stripping** — `mode: "full" | "assertions" | "none"`
- **Compile-time proofs** — Constant eval, type deduction, algebraic rules
- **Z3 plugin** — `@typesugar/contracts-z3` (separate package)

## Terminology

Aligned with modern convention (Dafny, Rust, Swift):

| Concept          | Keyword      | Used in                 |
| ---------------- | ------------ | ----------------------- |
| Precondition     | `requires`   | Dafny, Rust, Swift, JML |
| Postcondition    | `ensures`    | Dafny, Rust, Swift, JML |
| Pre-call capture | `old`        | Dafny, Eiffel, SPARK    |
| Class invariant  | `@invariant` | Eiffel, Dafny           |

## Usage

### Inline style

```typescript
import { requires, ensures, old } from "@typesugar/contracts";

function withdraw(account: Account, amount: Positive): number {
  requires(account.balance >= amount, "Insufficient funds");
  ensures(account.balance >= 0);
  account.balance -= amount;
  return account.balance;
}
```

### Block style

```typescript
import { contract, old } from "@typesugar/contracts";

@contract
function withdraw(account: Account, amount: Positive): Balance {
  requires: {
    account.balance >= amount;
    !account.frozen;
  }
  ensures: (result) => {
    result === old(account.balance) - amount;
  }
  account.balance -= amount;
  return Balance.refine(account.balance);
}
```

### Class invariants

```typescript
import { invariant } from "@typesugar/contracts";

@invariant((self) => self.balance >= 0, "Balance must be non-negative")
class BankAccount {
  balance = 0;
  deposit(amount: Positive): void {
    this.balance += amount;
  }
  withdraw(amount: Positive): void {
    this.balance -= amount;
  }
}
```

## Configuration

In `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "transform": "typesugar",
        "contracts": {
          "mode": "full",
          "proveAtCompileTime": true
        }
      }
    ]
  }
}
```

Or via environment variable:

```bash
TYPEMACRO_CONTRACTS_MODE=none npm run build  # Production
```

| Mode           | Preconditions | Postconditions | Invariants |
| -------------- | ------------- | -------------- | ---------- |
| `"full"`       | Emitted       | Emitted        | Emitted    |
| `"assertions"` | Stripped      | Stripped       | Emitted    |
| `"none"`       | Stripped      | Stripped       | Stripped   |

## Proof Engine

Layers run in order, stopping at first success:

1. **Constant evaluation** — `ctx.evaluate()` for statically known values
2. **Type deduction** — Extract facts from `Refined<T, Brand>` parameters
3. **Algebraic rules** — Pattern-match on normalized predicates
4. **Linear arithmetic** — Fourier-Motzkin elimination for inequalities
5. **Prover plugins** — SMT solver for complex formulas (via `@typesugar/contracts-z3`)

## Coq-Inspired Extensions

Phase 4 adds Coq-inspired features for finer control over proof strategies and runtime check elision.

### Decidability Annotations

Mark predicates with their decidability level:

```typescript
import { registerDecidability } from "@typesugar/contracts";

registerDecidability({
  brand: "Positive",
  predicate: "$ > 0",
  decidability: "compile-time", // Always provable at compile time
  preferredStrategy: "algebra",
});

registerDecidability({
  brand: "ValidJSON",
  predicate: "isValidJSON($)",
  decidability: "runtime", // Must check at runtime
});
```

| Level            | Meaning                       | Check Behavior           |
| ---------------- | ----------------------------- | ------------------------ |
| `"compile-time"` | Always provable statically    | Elided if proof succeeds |
| `"decidable"`    | Decidable, may need SMT       | Elided if SMT proves     |
| `"runtime"`      | Cannot prove statically       | Always emitted           |
| `"undecidable"`  | Not algorithmically decidable | Warning if used          |

### Decidability Warnings

Configure warnings when proofs unexpectedly fall back to runtime:

```typescript
// typesugar.config.ts
export default {
  contracts: {
    decidabilityWarnings: {
      warnOnFallback: "warn", // "off" | "warn" | "error"
      warnOnSMT: "info", // Warn when SMT is used
      ignoreBrands: ["DynamicCheck"],
    },
  },
};
```

### Subtyping Rules

Register safe widening relationships for automatic coercion:

```typescript
import { registerSubtypingRule, canWiden } from "@typesugar/contracts";

// Positive → NonNegative is safe
registerSubtypingRule({
  from: "Positive",
  to: "NonNegative",
  proof: "positive_implies_nonneg",
  justification: "x > 0 implies x >= 0",
});

canWiden("Positive", "NonNegative"); // true
```

Built-in rules (registered by `@typesugar/contracts-refined`):

- `Positive → NonNegative` (x > 0 → x >= 0)
- `NonNegative → NonNegativeOrZero` (x >= 0 is same)
- `Byte → NonNegative` (0-255 → >= 0)
- `Port → Positive` (1-65535 → > 0)

### Linear Arithmetic Solver

Proves linear inequalities via Fourier-Motzkin elimination:

```typescript
import { trySimpleLinearProof } from "@typesugar/contracts";

// Prove: x + y >= 0 given x > 0 and y >= 0
const result = trySimpleLinearProof("x + y >= 0", [
  { variable: "x", predicate: "x > 0" },
  { variable: "y", predicate: "y >= 0" },
]);
// result.proven === true
// result.method === "linear"
```

Fast patterns (no full FM elimination needed):

- `x > y ∧ y > z → x > z` (transitivity)
- `x > 0 ∧ y > 0 → x + y > 0` (sum positive)
- `x >= 0 ∧ y >= 0 → x + y >= 0` (sum non-negative)
- `x >= a ∧ y >= b → x + y >= a + b` (bound addition)

### Proof Certificates

Generate structured proof traces for debugging and auditing:

```typescript
import { createCertificate, succeedCertificate, formatCertificate } from "@typesugar/contracts";

const facts = [{ variable: "x", predicate: "x: Positive" }];
let cert = createCertificate("x >= 0", facts);

cert = succeedCertificate(cert, "linear", {
  rule: "positive_implies_nonneg",
  description: "Positive implies non-negative",
  justification: "x > 0 → x >= 0 by definition",
  usedFacts: facts,
  subgoals: [],
});

console.log(formatCertificate(cert));
// Certificate for: x >= 0
// Status: PROVEN (linear)
// Assumptions:
//   - x: Positive
// Steps:
//   1. [positive_implies_nonneg] Positive implies non-negative
//      Justification: x > 0 → x >= 0 by definition
```

### Custom Algebraic Rules

Extend the prover with domain-specific patterns:

```typescript
import { registerAlgebraicRule } from "@typesugar/contracts";

registerAlgebraicRule({
  name: "percentage_upper_bound",
  description: "Percentage is always <= 100",
  match(goal, facts) {
    const m = goal.match(/^(\w+)\s*<=\s*100$/);
    if (!m) return false;
    return facts.some((f) => f.variable === m[1] && f.predicate.includes("Percentage"));
  },
});
```

## Package Structure

```
packages/contracts/src/
  index.ts              # Public API + macro registration
  config.ts             # ContractConfig + decidability warnings
  macros/
    requires.ts         # requires() expression macro
    ensures.ts          # ensures() expression macro
    old.ts              # old() capture + hoisting
    contract.ts         # @contract attribute macro
    invariant.ts        # @invariant attribute macro
    decidable.ts        # @decidable annotation macro
  prover/
    index.ts            # tryProve() orchestration + fallback warnings
    type-facts.ts       # Refined type facts + decidability + subtyping
    algebra.ts          # Algebraic proof rules
    linear.ts           # Fourier-Motzkin linear arithmetic
    certificate.ts      # Proof certificates
  parser/
    contract-block.ts   # Parse requires:/ensures: blocks
    predicate.ts        # Normalize predicates
  runtime/
    errors.ts           # ContractError types

packages/contracts-refined/src/
  index.ts              # Registers built-in predicates for type-system

packages/contracts-z3/src/
  index.ts              # Z3 ProverPlugin implementation
```

## Related Packages

| Package                        | Purpose                                          |
| ------------------------------ | ------------------------------------------------ |
| `@typesugar/contracts`         | Core contracts, prover, decidability             |
| `@typesugar/contracts-refined` | Bridge to `@typesugar/type-system` refined types |
| `@typesugar/contracts-z3`      | Z3 SMT solver prover plugin                      |
| `@typesugar/type-system`       | Refined types (Positive, Byte, Port, etc.)       |

## References

- [Eiffel Design by Contract](https://www.eiffel.org/doc/eiffel/ET-_Design_by_Contract)
- [Dafny Verification](https://dafny.org/)
- [SPARK Ada Contracts](https://docs.adacore.com/spark2014-docs/html/ug/en/source/subprogram_contracts.html)
- [Z3 TypeScript Bindings](https://www.npmjs.com/package/z3-solver)
