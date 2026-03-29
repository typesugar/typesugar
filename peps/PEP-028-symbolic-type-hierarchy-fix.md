# PEP-028: Fix Symbolic Expression Type Hierarchy for Operator Overloading

**Status:** Draft
**Date:** 2026-03-29
**Author:** Claude (with Dean Povey)
**Depends on:** PEP-011 (Extension Methods / Operator Overloading)

## Context

The `@typesugar/symbolic` package provides symbolic math expressions with operator overloading:

```typescript
import { var_, const_, pow } from "@typesugar/symbolic";

const t = var_("t");
const position = const_(0.5) * pow(t, const_(2)) + const_(3) * t;
// Should compile to: numericExpr.mul(const_(0.5), pow(t, const_(2)))
//                     numericExpr.add(..., numericExpr.mul(const_(3), t))
```

### Problem

The `*` and `+` operators are NOT rewritten to `numericExpr.mul()` / `numericExpr.add()` calls. The playground's `symbolic/calculus.ts` example fails at runtime with:

```
Non-exhaustive match: no handler for 'NaN'
```

This happens because:

1. `const_(0.5)` returns an object of type `Constant<number>`
2. JavaScript's `*` operator on objects returns `NaN`
3. `evaluate(NaN, ...)` hits a non-exhaustive match

### Root Cause

The operator overloading pass checks the `instanceRegistry` for a `Numeric` typeclass instance matching the operand type. The registry contains:

```
Numeric for number
Numeric for bigint
Numeric for Expression    ← this is the one we need
```

But the type checker resolves `const_(0.5)` as `Constant<number>`, NOT `Expression`. The `Constant` interface is defined as:

```typescript
// packages/symbolic/src/expression.ts
export interface Constant<T = number> {
  readonly kind: "constant";
  readonly value: T;
}
```

`Constant` does NOT extend `Expression`. It's a separate interface in a discriminated union:

```typescript
export type Expression<T = number> =
  | Constant<T>
  | Variable
  | BinaryOp<T>
  | UnaryOp<T>
  | FunctionCall<T>;
```

The operator pass looks for `Numeric` for `"Constant"` (the resolved type name), doesn't find it (only `"Expression"` is registered), and skips the rewrite.

## Waves

### Wave 1: Investigate the Type Hierarchy

**Tasks:**

- [ ] Confirm that `const_()` return type annotation says `Constant<T>` not `Expression<T>`
- [ ] Check `var_()` return type — does it return `Variable` or `Expression`?
- [ ] Check `pow()`, `sin()`, `diff()` return types
- [ ] Determine if changing return types to `Expression<T>` would break type narrowing (discriminated unions need specific types for pattern matching)

**Gate:**

- [ ] Full understanding of which functions return narrow types vs `Expression`

### Wave 2: Fix Return Types OR Register Additional Instances

Two possible approaches:

**Option A: Widen return types to `Expression<T>`**

Change `const_()`, `var_()` etc. to return `Expression<T>` instead of `Constant<T>`:

```typescript
// Before
export function const_<T>(value: T): Constant<T> { ... }
// After
export function const_<T>(value: T): Expression<T> { ... }
```

Pros: Operator overloading works immediately (Numeric is for Expression).
Cons: Users lose type narrowing — `const_(5).value` would need a type guard.

**Option B: Register Numeric for all union members**

Register `Numeric` instances for each concrete type in the union:

```typescript
registerInstanceWithMeta({ typeclassName: "Numeric", forType: "Constant", ... });
registerInstanceWithMeta({ typeclassName: "Numeric", forType: "Variable", ... });
registerInstanceWithMeta({ typeclassName: "Numeric", forType: "BinaryOp", ... });
```

Pros: Preserves type narrowing.
Cons: More registrations; must be kept in sync with the union.

**Option C: Teach the operator pass to check union membership**

When the operator pass sees `Numeric` for `Expression` but the operand type is `Constant`, check if `Constant` is a member of the `Expression` union type and use the `Expression` instance.

Pros: Most correct — works for any discriminated union pattern.
Cons: Requires type checker to resolve union membership, which adds complexity.

**Tasks:**

- [ ] Evaluate which option preserves the best DX
- [ ] Implement chosen option
- [ ] Update `packages/symbolic/src/builders.ts` or `packages/symbolic/src/expression.ts`

**Gate:**

- [ ] `const_(0.5) * const_(2)` compiles to `numericExpr.mul(const_(0.5), const_(2))`
- [ ] All existing symbolic tests pass

### Wave 3: Fix the Example and Remove Skip

**Tasks:**

- [ ] Verify `docs/examples/symbolic/calculus.ts` runs without errors
- [ ] Remove `"symbolic/calculus.ts"` from `EXECUTION_SKIP` in `tests/playground-examples.test.ts`
- [ ] Verify all 157 playground example tests pass with 0 skips

**Gate:**

- [ ] `EXECUTION_SKIP` is an empty set
- [ ] CI green on all Node versions

## Files Changed

| File                                                   | Change                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------- |
| `packages/symbolic/src/builders.ts` or `expression.ts` | Fix return types or register additional Numeric instances   |
| `tests/playground-examples.test.ts`                    | Remove symbolic/calculus.ts from EXECUTION_SKIP             |
| `packages/transformer/src/index.ts`                    | (Option C only) Add union membership check in operator pass |

## Consequences

### Benefits

- Symbolic operator overloading works end-to-end
- The calculus playground example executes correctly
- Zero test skips — all examples pass

### Trade-offs

- Option A loses type narrowing (significant DX regression)
- Option B adds maintenance burden (registrations must match union members)
- Option C adds complexity to the operator pass

### Recommendation

**Option C** is the most robust long-term solution — it handles any discriminated union pattern generically. But **Option B** is the simplest immediate fix and can be replaced by Option C later.

### Future Work

- If Option C is implemented, it could benefit other packages that use discriminated unions with operator overloading
- Consider adding a `@numeric` or `@operators` decorator that auto-registers all union members
