# Design by Contract

The `@typesugar/contracts` package provides Eiffel/Dafny-style Design by Contract for TypeScript: preconditions, postconditions, and invariants, backed by a multi-layer proof engine that eliminates runtime checks when conditions can be proven at compile time.

## Basic Usage

```typescript
import "@typesugar/contracts/syntax"; // activate requires:/ensures: block syntax
import { requires, ensures, invariant, old } from "@typesugar/contracts";

function divide(a: number, b: number): number {
  requires: {
    (b !== 0, "divisor must not be zero");
  }
  ensures: {
    (result * b === a, "result * b must equal a");
  }
  return a / b;
}
```

### Activation

The bare block form is import-scoped (PEP-052): `requires:`/`ensures:` blocks
only apply `@contract` in files that import the activation marker,
`import "@typesugar/contracts/syntax";`. Without it the labels are left as
ordinary JavaScript and the compiler warns (TS9224) with a hint naming the
import. The explicit `@contract` decorator needs no marker — importing the
`contract` symbol is the opt-in.

### Block form vs. inline form

A function containing `requires:`/`ensures:` labeled blocks is treated as if it
were decorated with [`@contract`](#block-style) — no decorator is required
(in files that import `@typesugar/contracts/syntax`). The
block form is the recommended way to write postconditions:

```typescript
import "@typesugar/contracts/syntax";
import { old } from "@typesugar/contracts";
import { Positive } from "@typesugar/type-system";

function withdraw(account: Account, amount: Positive): number {
  requires: {
    (account.balance >= amount, "Insufficient funds");
  }
  ensures: {
    account.balance === old(account.balance) - amount;
  }
  account.balance -= amount;
  return account.balance;
}
```

Postconditions (`ensures:`) and `old()` use the block form because the check
must run at function exit and `old()` must be snapshotted at entry. The inline
`ensures(condition)` call form cannot capture pre-state with `old()` — the check
runs where it is written, not at function exit — so use a block for any
postcondition.

## Preconditions (requires)

`requires:` blocks validate inputs before execution:

```typescript
function withdraw(account: Account, amount: number): void {
  requires: {
    (amount > 0, "amount must be positive");
    (amount <= account.balance, "insufficient funds");
  }
  account.balance -= amount;
}
```

### Multiple Conditions

```typescript
function transfer(from: Account, to: Account, amount: number): void {
  requires: {
    (from !== to, "cannot transfer to same account");
    (amount > 0, "amount must be positive");
    (amount <= from.balance, "insufficient funds");
  }
  // ...
}
```

### Inline Style

Inline `requires(...)` calls are a shorthand for simple preconditions (checked
at function entry). Postconditions and `old()` need the [block style](#block-style)
below, because the check must run at function exit and `old()` must be snapshotted
at entry.

```typescript
import { requires } from "@typesugar/contracts";

function deposit(account: Account, amount: Positive): void {
  requires(amount > 0); // PROVEN: Positive type
  account.balance += amount;
}
```

## Postconditions (ensures)

`ensures:` blocks validate outputs after execution:

```typescript
function abs(n: number): number {
  ensures: {
    (result >= 0, "result must be non-negative");
    (result === n || result === -n, "result must be |n|");
  }
  return n < 0 ? -n : n;
}
```

### The `result` Variable

Inside `ensures:`, `result` refers to the return value:

```typescript
function double(n: number): number {
  ensures: {
    result === n * 2;
  }
  return n * 2;
}
```

### The `old()` Function

Capture values from before execution:

```typescript
function increment(counter: { value: number }): void {
  ensures: {
    counter.value === old(counter.value) + 1;
  }
  counter.value++;
}
```

### Block Style

The `@contract` decorator is an optional explicit marker for `requires:`/`ensures:`
blocks (functions containing those blocks are auto-detected even without it, in
files that import `@typesugar/contracts/syntax` — see [Activation](#activation)).
The `ensures:` block may also be written as an arrow taking the result:

```typescript
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

## Class Invariants

`@invariant` decorators enforce class-level constraints:

```typescript
import { invariant } from "@typesugar/contracts";

@invariant((self) => self.min <= self.max, "min must be <= max")
class Range {
  constructor(
    public min: number,
    public max: number
  ) {}

  expand(delta: number): void {
    this.min -= delta;
    this.max += delta;
  }
}
```

The invariant is checked:

- After construction
- After each public method

Another example, guarding a balance:

```typescript
@invariant((self) => self.balance >= 0, "Balance must be non-negative")
class BankAccount {
  balance = 0;

  deposit(amount: Positive): void {
    this.balance += amount;
  }
}
```

## Assertions

For inline assertions:

```typescript
import { assert, assertNever } from "@typesugar/contracts";

function process(status: "pending" | "done"): void {
  assert(status !== "pending" || canProcess(), "cannot process pending");

  switch (status) {
    case "pending":
      /* ... */ break;
    case "done":
      /* ... */ break;
    default:
      assertNever(status);
  }
}
```

## Type Narrowing

Contracts narrow types in subsequent code:

```typescript
function process(value: string | null): string {
  requires: {
    value !== null;
  }
  // value is narrowed to string here
  return value.toUpperCase();
}
```

## Compile-Time Proof Elimination

The prover attempts to discharge each contract condition at compile time. When it
succeeds, the runtime check is eliminated entirely — there is zero runtime overhead
for proven conditions.

### Proof Engine Layers

The prover runs layers in order, stopping at the first success:

1. **Constant evaluation** — Static values, `comptime()` results
2. **Type deduction** — Facts from `Refined<T, Brand>` types
3. **Algebraic rules** — Pattern matching (`a > 0 ∧ b > 0 → a + b > 0`)
4. **Linear arithmetic** — Fourier-Motzkin elimination

### Compile-Time Evaluation with `comptime()`

The `comptime()` macro evaluates expressions at build time:

```typescript
import { requires, comptime } from "@typesugar/contracts";

// Complex computations at build time
const BUFFER_SIZE = comptime(() => 1024 * 16); // Becomes: 16384
const FACTORIALS = comptime(() => {
  const result = [1];
  for (let i = 1; i <= 10; i++) result.push(result[i - 1] * i);
  return result;
}); // Becomes: [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800]

function allocate(size: number) {
  // Prover can verify this when size is BUFFER_SIZE
  requires(size > 0 && size <= BUFFER_SIZE);
  return new ArrayBuffer(size);
}
```

`comptime()` integrates with the prover's constant evaluation layer, enabling
complex computations (loops, recursion, array methods) while benefiting from
proof elimination.

## Decidability Annotations

Mark predicates with their decidability level to control proof strategy and
warnings:

```typescript
import { decidable, registerDecidability } from "@typesugar/contracts";

// Decorator form
@decidable("compile-time", "constant")
type Literal42 = Refined<number, "Literal42">;

// Programmatic form
registerDecidability({
  brand: "Positive",
  predicate: "$ > 0",
  decidability: "compile-time",
  preferredStrategy: "algebra",
});
```

| Level            | Meaning                           |
| ---------------- | --------------------------------- |
| `"compile-time"` | Always provable at compile time   |
| `"decidable"`    | Decidable, may need SMT solver    |
| `"runtime"`      | Must check at runtime             |
| `"undecidable"`  | Cannot be decided algorithmically |

### Decidability Warnings

Configure warnings when proofs fall back to runtime:

```typescript
// typesugar.config.ts
export default {
  contracts: {
    decidabilityWarnings: {
      warnOnFallback: "warn", // "off" | "warn" | "error"
      warnOnSMT: "info",
      ignoreBrands: ["DynamicCheck"],
    },
  },
};
```

## Subtyping Coercions

Register safe type coercions for automatic widening:

```typescript
import { registerSubtypingRule, canWiden } from "@typesugar/contracts";

registerSubtypingRule({
  from: "Positive",
  to: "NonNegative",
  proof: "positive_implies_non_negative",
  justification: "x > 0 implies x >= 0",
});

canWiden("Positive", "NonNegative"); // true
```

## Linear Arithmetic Solver

Proves linear inequalities via Fourier-Motzkin elimination:

```typescript
import { tryLinearArithmetic, trySimpleLinearProof } from "@typesugar/contracts";

// Given: x > 0, y >= 0
// Proves: x + y >= 0
const result = trySimpleLinearProof("x + y >= 0", [
  { variable: "x", predicate: "x > 0" },
  { variable: "y", predicate: "y >= 0" },
]);
// result.proven === true
```

Supported patterns:

- Transitivity: `x > y ∧ y > z → x > z`
- Sum bounds: `x >= a ∧ y >= b → x + y >= a + b`
- Positive implies non-negative: `x > 0 → x >= 0`
- Equality bounds: `x === c → x >= c ∧ x <= c`

## Proof Certificates

Generate structured proof traces for debugging:

```typescript
import { createCertificate, succeedCertificate, formatCertificate } from "@typesugar/contracts";

const facts = [{ variable: "x", predicate: "x > 0" }];
let cert = createCertificate("x >= 0", facts);

// Add proof steps...
cert = succeedCertificate(cert, "linear", {
  rule: "positive_implies_nonneg",
  description: "x > 0 implies x >= 0",
});

console.log(formatCertificate(cert));
// Certificate for: x >= 0
// Status: PROVEN (linear)
// Steps:
//   1. [positive_implies_nonneg] x > 0 implies x >= 0
```

## Custom Algebraic Rules

Extend the algebraic layer with your own pattern-matching rules:

```typescript
import { registerAlgebraicRule } from "@typesugar/contracts";

registerAlgebraicRule({
  name: "percentage_bounds",
  description: "Percentage is 0-100",
  match(goal, facts) {
    const m = goal.match(/^(\w+)\s*<=\s*100$/);
    if (!m) return false;
    return facts.some((f) => f.variable === m[1] && f.predicate.includes("Percentage"));
  },
});
```

## Refinement Types

Combine with refinement types for stronger guarantees:

```typescript
import { Refined, Positive, NonEmpty } from "@typesugar/contracts-refined";

type PositiveNumber = Refined<number, Positive>;
type NonEmptyString = Refined<string, NonEmpty>;

function divide(a: number, b: PositiveNumber): number {
  // b is guaranteed to be > 0
  return a / b;
}
```

### Integration with `@typesugar/type-system`

Import `@typesugar/contracts-refined` to connect the prover with refined types.
This registers all built-in predicates so the prover can discharge conditions
directly from refined type brands:

```typescript
// REQUIRED: Registers all built-in predicates
import "@typesugar/contracts-refined";

import { Positive, Byte, Port } from "@typesugar/type-system";

function processPort(port: Port): void {
  requires(port >= 1); // PROVEN: Port guarantees >= 1
  requires(port <= 65535); // PROVEN: Port guarantees <= 65535
}
```

Install both packages together:

```bash
npm install @typesugar/contracts-refined @typesugar/type-system
```

## Configuration

### Runtime modes via `configure()`

```typescript
import { configure } from "@typesugar/contracts";

configure({
  // "enabled" | "disabled" | "assume"
  mode: "enabled",
});
```

| Mode       | Behavior                                |
| ---------- | --------------------------------------- |
| `enabled`  | Check all contracts at runtime          |
| `disabled` | Remove all contract checks (production) |
| `assume`   | Use contracts for type narrowing only   |

#### Conditional Compilation

```typescript
import { cfg } from "@typesugar/core";

configure({
  mode: cfg("production", "disabled", "enabled"),
});
```

### Build configuration via `typesugar.config.ts`

The build-time configuration controls which classes of check are emitted and
enables compile-time proving:

```typescript
export default {
  contracts: {
    mode: "full", // "full" | "assertions" | "none"
    proveAtCompileTime: true,
    decidabilityWarnings: {
      warnOnFallback: "warn",
      warnOnSMT: "off",
      ignoreBrands: [],
    },
  },
};
```

| Mode           | Preconditions | Postconditions | Invariants |
| -------------- | ------------- | -------------- | ---------- |
| `"full"`       | Emitted       | Emitted        | Emitted    |
| `"assertions"` | Stripped      | Stripped       | Emitted    |
| `"none"`       | Stripped      | Stripped       | Stripped   |

### Via Environment Variable

```bash
TYPESUGAR_CONTRACTS_MODE=none npm run build  # Production: strip all checks
```

## Error Messages

Contracts produce clear error messages:

```
ContractViolation: requires: amount must be positive
  at withdraw (account.ts:5:3)

  Condition: amount > 0
  Values: { amount: -50 }
```

## Performance

### Development

All contracts checked at runtime.

### Production

With `mode: "disabled"`, contracts compile away:

```typescript
// Source
function divide(a: number, b: number): number {
  requires: {
    b !== 0;
  }
  return a / b;
}

// Compiled (production)
function divide(a: number, b: number): number {
  return a / b;
}
```

Zero runtime overhead.

## Best Practices

### Do

- Use `requires:` for all public function inputs
- Use `ensures:` for complex algorithms
- Use `@invariant` for data integrity
- Disable in production after thorough testing

### Don't

- Use contracts for user input validation (use proper validation)
- Put side effects in contract conditions
- Rely on contracts for security (they can be disabled)

## Comparison

| Feature             | typesugar | Eiffel  | D   | Ada/SPARK |
| ------------------- | --------- | ------- | --- | --------- |
| Preconditions       | Yes       | Yes     | Yes | Yes       |
| Postconditions      | Yes       | Yes     | Yes | Yes       |
| Invariants          | Yes       | Yes     | Yes | Yes       |
| `old()`             | Yes       | Yes     | Yes | Yes       |
| Static verification | Yes       | Partial | No  | Yes       |
| Zero-cost disable   | Yes       | No      | Yes | Yes       |

## API Reference

### Core Functions

- `requires(condition, message?)` — Precondition check
- `ensures(condition, message?)` — Postcondition check
- `old(expression)` — Capture pre-call value
- `comptime(() => expr)` — Compile-time expression evaluation
- `assert(condition, message?)` / `assertNever(value)` — Inline assertions

### Construct Reference

| Construct                      | Description                                                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `requires:` / `ensures:` block | Pre/postcondition blocks — auto-detected, no decorator needed (requires `import "@typesugar/contracts/syntax";`) |
| `requires(condition, msg?)`    | Inline precondition shorthand — checked at function entry                                                        |
| `old(expr)`                    | Capture pre-call value (inside an `ensures:` block)                                                              |
| `@contract`                    | Optional explicit marker for `requires:`/`ensures:` blocks (no activation import needed)                         |
| `@invariant(predicate)`        | Class invariant — checked after public methods                                                                   |

### Prover API

- `tryProve(ctx, condition, fn)` — Attempt compile-time proof
- `tryAlgebraicProof(goal, facts)` — Algebraic pattern matching
- `tryLinearArithmetic(goal, facts)` — Fourier-Motzkin solver
- `trySimpleLinearProof(goal, facts)` — Fast linear patterns
- `registerAlgebraicRule(rule)` — Register a custom algebraic rule

### Decidability API

- `registerDecidability(info)` — Register decidability for a brand
- `getDecidability(brand)` — Get decidability info
- `isCompileTimeDecidable(brand)` — Check if compile-time provable
- `canProveAtCompileTime(level)` — Check decidability level
- `emitDecidabilityWarning(info)` — Emit configured warning

### Subtyping API

- `registerSubtypingRule(rule)` — Register widening rule
- `canWiden(from, to)` — Check if subtyping exists
- `getSubtypingRule(from, to)` — Get rule details
- `getWidenTargets(from)` — Get all widen targets

### Certificate API

- `createCertificate(goal, assumptions)` — Start certificate
- `succeedCertificate(cert, method, step)` — Mark proven
- `failCertificate(cert, reason)` — Mark failed
- `addStep(cert, step)` — Add proof step
- `formatCertificate(cert)` — Human-readable output

## Package Structure

```
packages/contracts/src/
  index.ts              # Public API
  config.ts             # Configuration + decidability warnings
  macros/
    requires.ts         # requires() expression macro
    ensures.ts          # ensures() expression macro
    old.ts              # old() capture + hoisting
    contract.ts         # @contract attribute macro
    invariant.ts        # @invariant attribute macro
    decidable.ts        # @decidable annotation macro
  prover/
    index.ts            # tryProve() orchestration
    type-facts.ts       # Type fact extraction + subtyping
    algebra.ts          # Algebraic proof rules
    linear.ts           # Fourier-Motzkin solver
    certificate.ts      # Proof certificates
  parser/
    contract-block.ts   # Parse requires:/ensures: blocks
    predicate.ts        # Normalize predicates
```

## See Also

- [Refined Contracts guide](/guides/contracts-refined) — bridging contracts with the type system
- `@typesugar/contracts-refined` — Bridges contracts with type-system
- `@typesugar/type-system` — Refined types (Positive, Byte, etc.)
