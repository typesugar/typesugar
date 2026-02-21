# Design by Contract

The `@typesugar/contracts` package provides Design by Contract features: preconditions, postconditions, and invariants.

## Basic Usage

```typescript
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

## Contract Modes

Configure how contracts behave:

```typescript
import { configure } from "@typesugar/contracts";

configure({
  // "enabled" | "disabled" | "assume"
  mode: "enabled",
});
```

### Modes

| Mode       | Behavior                                |
| ---------- | --------------------------------------- |
| `enabled`  | Check all contracts at runtime          |
| `disabled` | Remove all contract checks (production) |
| `assume`   | Use contracts for type narrowing only   |

### Conditional Compilation

```typescript
import { cfg } from "@typesugar/core";

configure({
  mode: cfg("production", "disabled", "enabled"),
});
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

## Error Messages

Contracts produce clear error messages:

```
ContractViolation: requires: amount must be positive
  at withdraw (account.ts:5:3)

  Condition: amount > 0
  Values: { amount: -50 }
```

## Advanced: Proof Engine

For static verification, use `@typesugar/contracts-z3`:

```typescript
import { prove } from "@typesugar/contracts-z3";

function abs(n: number): number {
  requires: {
    prove: true; // Enable static verification
  }
  ensures: {
    result >= 0;
  }
  return n < 0 ? -n : n;
}
// Z3 proves the postcondition holds for all inputs
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
| Static verification | Yes (Z3)  | Partial | No  | Yes       |
| Zero-cost disable   | Yes       | No      | Yes | Yes       |
