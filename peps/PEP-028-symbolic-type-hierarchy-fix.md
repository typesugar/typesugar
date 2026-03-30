# PEP-028: Fix Symbolic Expression Type Hierarchy for Operator Overloading

**Status:** Implemented
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

### Wave 1: Investigate the Type Hierarchy ✅

**Tasks:**

- [x] Confirm that `const_()` return type annotation says `Constant<T>` not `Expression<T>`
- [x] Check `var_()` return type — returns `Variable<T>`, not `Expression`
- [x] Check `pow()`, `sin()`, `diff()` return types — all return narrow types (`BinaryOp`, `FunctionCall`, `Derivative`)
- [x] Determine if changing return types to `Expression<T>` would break type narrowing — yes, it would (Option A rejected)

**Findings:**

All builder functions return narrow types. The union member fallback code already existed in both `transformer/src/index.ts` and `transformer-core/src/rewriting.ts`, but was broken because it skipped `.d.ts` files (`if (sf.isDeclarationFile) continue;`). Since `@typesugar/symbolic` is consumed as a compiled package, its `Expression` type alias only exists in `.d.ts` files — so the fallback never found it.

**Gate:**

- [x] Full understanding of which functions return narrow types vs `Expression`

### Wave 2: Fix Union Membership Check in Operator Pass (Option C) ✅

**Chosen approach:** Option C — fix the existing union membership check by:

1. Removing the `isDeclarationFile` guard so `.d.ts` type aliases are found
2. Adding a cache (`unionMemberCache`) to avoid repeated file scanning (prevents performance regression)

**Tasks:**

- [x] Fix `transformer/src/index.ts` — removed `isDeclarationFile` guard in both `inferBinaryExprResultType` and `tryRewriteTypeclassOperator`
- [x] Fix `transformer-core/src/rewriting.ts` — same fix via `findUnionMemberInstance` helper
- [x] Add `getUnionMembers()` cached lookup in both packages to avoid O(files) scan per operator
- [x] Verify no performance regression — all 20 benchmark tests pass

**Gate:**

- [x] `const_(0.5) * const_(2)` compiles to `numericExpr.mul(const_(0.5), const_(2))`
- [x] All existing symbolic tests pass
- [x] Benchmark tests pass (no regression from scanning .d.ts files)

### Wave 3: Fix the Example and Remove Skip ✅

**Tasks:**

- [x] Verify `docs/examples/symbolic/calculus.ts` runs without errors
- [x] Remove `"symbolic/calculus.ts"` from `EXECUTION_SKIP` in `tests/playground-examples.test.ts`
- [x] Verify all 157 playground example tests pass with 0 skips

**Gate:**

- [x] `EXECUTION_SKIP` is an empty set
- [x] Full test suite: 222 files passed, 6646 tests passed, 0 failures

## Files Changed

| File                                         | Change                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `packages/transformer/src/index.ts`          | Removed `isDeclarationFile` guard, added `getUnionMembers()` cache      |
| `packages/transformer-core/src/rewriting.ts` | Same fix: cached `getUnionMembers()` + `findUnionMemberInstance` helper |
| `tests/playground-examples.test.ts`          | Removed `symbolic/calculus.ts` from `EXECUTION_SKIP`                    |

## Consequences

### Benefits

- Symbolic operator overloading works end-to-end for discriminated union types
- The calculus playground example executes correctly
- Zero test skips — all 157 playground examples pass
- Generic solution: any discriminated union with a typeclass instance on the union type now works for all union members

### Trade-offs

- Scanning `.d.ts` files adds to the initial lookup cost, but the cache ensures each type alias is resolved only once per program
- The `transformer/src/index.ts` and `transformer-core/src/rewriting.ts` still have duplicated operator rewriting logic (tracked by PEP-026)

### Root Cause

The union member fallback code already existed but had a bug: `if (sf.isDeclarationFile) continue;` skipped `.d.ts` files. Since `@typesugar/symbolic` is consumed as a compiled package, its `Expression` type alias only appeared in `.d.ts` — so the fallback never found it.
