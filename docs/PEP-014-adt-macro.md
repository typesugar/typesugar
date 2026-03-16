# PEP-014: ADT Macro for Zero-Cost Discriminated Unions

**Status:** Draft
**Date:** 2026-03-15
**Author:** Dean Povey
**Depends on:** PEP-011 (SFINAE Diagnostic Resolution), PEP-012 (Type Macros)

## Context

PEP-012 introduced `@opaque` for defining types with rich interfaces and cheap runtime representations. However, `@opaque` creates a **single interface** that hides the underlying discriminated union. This prevents TypeScript's native narrowing from exposing variant-specific fields.

The problem manifests in tests and user code:

```typescript
// Current: @opaque Either hides the Left/Right structure
const e: Either<string, number> = Right(42);

// Can't narrow to access .right directly
if (isRight(e)) {
  // e is still Either<string, number> — no .right property exposed
  const value = (e as unknown as { right: number }).right; // Ugly cast required
}
```

This design fights TypeScript's strengths. Discriminated unions with native narrowing are a core TypeScript pattern, and `@opaque` trades that away for method syntax.

### The Solution: `@adt` for Sum Types

A new `@adt` macro that:

1. **Exposes variant structure** — `Left` and `Right` are distinct types with their own fields
2. **Enables native narrowing** — `'right' in e` or `e.right !== undefined` narrows to `Right`
3. **Auto-injects `_tag` only when needed** — structurally distinguishable variants need no tag
4. **Supports null-represented variants** — `Nil = null` for zero-cost empty cases
5. **Still provides method erasure** — `e.map(f)` erases to `map(e, f)` via the existing registry

### ADT vs GADT vs Dependent Types

**ADT (Algebraic Data Type)** — what we're building:

- Sum types (union) + product types (record)
- Pattern matching narrows to a variant, but **type parameters stay the same**
- `Either<string, number>` narrowed to `Right` is still `Right<string, number>`
- TypeScript handles this perfectly with discriminated unions

**GADT (Generalized Algebraic Data Type)** — not possible in TypeScript:

- Different constructors **constrain the type parameter to specific types**
- Pattern matching **refines type parameters** based on which constructor
- Example: `Expr<A>` where `LitInt` implies `A = number`, `LitBool` implies `A = boolean`
- Requires dependent types or existential quantification that TypeScript lacks

The removed `gadt.ts` tried to fake GADT semantics but couldn't actually refine type parameters. We're building proper ADT support, which TypeScript can express naturally.

### Architectural Constraint: No Circular Dependencies

The `@adt` macro is defined in `packages/macros/`, which depends on `packages/core/`. This means:

```
✅ Can use @adt:
   packages/fp/        → depends on macros
   packages/std/       → depends on macros
   packages/contracts/ → depends on macros
   packages/symbolic/  → depends on macros
   User code           → depends on any of above

❌ Cannot use @adt (circular):
   packages/core/      → macros depends on this
   packages/macros/    → defines @adt
   packages/transformer/ → peer of macros
```

Infrastructure types in `core`/`macros`/`transformer` must use manual discriminated unions. `@adt` is for library authors and users building on typesugar.

### Relationship to PEP-012

`@adt` builds on the **`TypeRewriteRegistry`** from PEP-012:

| Aspect                   | `@opaque`                                | `@adt`                          |
| ------------------------ | ---------------------------------------- | ------------------------------- |
| **Structure**            | Single interface, hidden internal type   | Union of variant interfaces     |
| **Narrowing**            | None — type is opaque                    | Native TypeScript narrowing     |
| **Constructor handling** | Named functions in same file             | Auto-generated from variants    |
| **Use case**             | Hide representation (Option = T \| null) | Expose variants (Left vs Right) |

Both use `TypeRewriteRegistry` for method erasure. The difference is structural:

- `@opaque` creates a facade over a hidden type
- `@adt` creates a discriminated union with visible variants

## Design

### Core Principle: Structural Distinguishability

The `@adt` macro analyzes variant interfaces and determines if they can be distinguished by field presence alone:

| Variants                                      | Distinguishable? | Discriminant                              |
| --------------------------------------------- | ---------------- | ----------------------------------------- |
| `Left { left: E }` / `Right { right: A }`     | Yes              | `'right' in x` or `x.right !== undefined` |
| `Cons { head, tail }` / `Nil = null`          | Yes              | `x !== null`                              |
| `Some { value: A }` / `None = null`           | Yes              | `x !== null`                              |
| `NotAsked {}` / `Loading {}`                  | **No**           | Need `_tag`                               |
| `Add { left, right }` / `Mul { left, right }` | **No**           | Need `_tag`                               |

When variants are **not** structurally distinguishable, the macro automatically injects `_tag` via intersection types.

### `@adt` Syntax

Variants are defined as **separate interfaces**. The `@adt` JSDoc tag goes on the **type alias**:

```typescript
// User writes clean interfaces — no _tag boilerplate
interface Left<E, A> {
  readonly left: E;
  readonly right?: undefined; // For safe access on union
}

interface Right<E, A> {
  readonly left?: undefined;
  readonly right: A;
}

/** @adt */
type Either<E, A> = Left<E, A> | Right<E, A>;
```

For null-represented variants, specify the runtime representation:

```typescript
interface Cons<A> {
  readonly head: A;
  readonly tail: List<A>;
}

interface Nil {
  map<B>(f: (a: never) => B): Nil; // Declared for type-checking
}

/** @adt { Nil: null } */
type List<A> = Cons<A> | Nil;
```

### Auto-Tag Injection

When variants are ambiguous, the macro transforms the type alias:

```typescript
// User writes:
interface NotAsked {}
interface Loading {}
interface Failure<E> {
  error: E;
}
interface Success<A> {
  value: A;
}

/** @adt */
type RemoteData<E, A> = NotAsked | Loading | Failure<E> | Success<A>;

// Macro transforms to:
type RemoteData<E, A> =
  | (NotAsked & { readonly _tag: "NotAsked" })
  | (Loading & { readonly _tag: "Loading" })
  | Failure<E> // No _tag needed — unique 'error' field
  | Success<A>; // No _tag needed — unique 'value' field
```

The macro also generates constructors that include `_tag` where needed:

```typescript
// Generated by macro:
function NotAsked(): RemoteData<never, never> {
  return { _tag: "NotAsked" };
}

function Loading(): RemoteData<never, never> {
  return { _tag: "Loading" };
}

function Failure<E>(error: E): RemoteData<E, never> {
  return { error }; // No _tag — field is the discriminant
}

function Success<A>(value: A): RemoteData<never, A> {
  return { value }; // No _tag — field is the discriminant
}
```

### Narrowing Behavior

```typescript
// Either: field-based narrowing (no _tag needed)
const e: Either<string, number> = Right(42);
if (e.right !== undefined) {
  e.right; // number (narrowed to Right)
}
if ("right" in e) {
  e.right; // number (narrowed to Right)
}
e.right; // number | undefined (before narrowing)
e.left; // string | undefined (before narrowing)

// List: null-check narrowing
const list: List<number> = Cons(1, Nil);
if (list !== null) {
  list.head; // number (narrowed to Cons)
  list.tail; // List<number>
}

// Or with type guards:
if (isCons(list)) {
  /* ... */
}
if (isNil(list)) {
  /* ... */
}

// RemoteData: _tag narrowing (auto-injected)
const rd: RemoteData<Error, User> = Loading();
if (rd._tag === "Loading") {
  // narrowed to Loading
}
if ("value" in rd) {
  rd.value; // User (narrowed to Success)
}
```

### Transformer Behavior

Method calls on ADT types are erased to standalone functions (via `TypeRewriteRegistry`):

- `either.map(f)` becomes `map(either, f)`
- `list.map(f)` becomes `map(list, f)`
- `Nil.map(f)` becomes `map(null, f)` (Nil erased to null)

Unsafe accessors compile to throwing functions:

- `either.unsafeLeft` becomes `unsafeLeft(either)` which throws if Right
- `either.unsafeRight` becomes `unsafeRight(either)` which throws if Left

### SFINAE Rules

New/updated rules for ADT types:

1. **Null-variant assignment**: `null` assignable to null-represented variants (Nil)
2. **Variant construction**: `{ head, tail }` assignable to `Cons<A>`
3. **Union member return**: Returning a variant type satisfies union return type
4. **Cross-variant field access**: `either.right` on `Either<E, A>` allowed (returns `A | undefined`)

### Macro Implementation

The `@adt` macro:

1. **Parses the type alias** — extracts union members from `type X = A | B | C`
2. **Resolves variant interfaces** — finds their declarations via the type checker
3. **Builds distinguishability matrix** — for each pair of variants, checks:
   - Null vs non-null (one is `= null`)
   - Unique required field (one has a field the other doesn't)
   - Field type difference (same field name, incompatible types)
4. **Injects `_tag` where needed** — adds `& { readonly _tag: "Name" }` to ambiguous variants
5. **Generates constructors** — with `_tag` where needed, identity for null variants
6. **Generates type guards** — `isLeft`, `isRight`, `isCons`, `isNil`, etc.
7. **Registers type rewrites** — for method erasure via `TypeRewriteRegistry`

## Audit Findings

The codebase audit identified the following candidates:

### High Priority (Wave 1-2)

| Type       | Location                         | Issue                     | Benefit                                |
| ---------- | -------------------------------- | ------------------------- | -------------------------------------- |
| **Either** | `packages/fp/src/data/either.ts` | 46+ `as any` casts        | Field-based narrowing, remove `_tag`   |
| **List**   | `packages/fp/src/data/list.ts`   | Object allocation for Nil | `Nil = null` saves ~32 bytes per empty |

### Medium Priority (Wave 4)

| Type           | Location                              | Issue                              | Benefit                                               |
| -------------- | ------------------------------------- | ---------------------------------- | ----------------------------------------------------- |
| **Validated**  | `packages/fp/src/data/validated.ts`   | `_tag` is redundant                | `value`/`error` fields distinguish variants           |
| **Trampoline** | `packages/fp/src/io/io.ts` (internal) | `_tag` is redundant                | `value`/`thunk` fields distinguish variants           |
| **IO**         | `packages/fp/src/io/io.ts`            | 8 variants with overlapping fields | `@adt` would auto-inject `_tag`, auto-generate guards |

### No Change Needed

| Type               | Location                                | Reason                                                                                                                     |
| ------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Option**         | `packages/fp/src/data/option.ts`        | Already optimal: `Some(x) = x`, `None = null`. Using `@adt` would ADD overhead (`Some(x) = { value: x }`). Keep `@opaque`. |
| **ZeroCostResult** | `packages/fp/src/zero-cost/result.ts`   | Alternative pattern using `ok: boolean`. Works well, low migration priority.                                               |
| **NonEmptyList**   | `packages/fp/src/data/nonempty-list.ts` | Not a sum type, just has unnecessary `_tag`. Cleanup only (remove `_tag`).                                                 |

### Key Insight: `@opaque` vs `@adt`

- **Use `@opaque`** when the representation should be hidden and `Some(x) = x` (true zero-cost)
- **Use `@adt`** when variants should be visible for native TypeScript narrowing

Option uses `@opaque` correctly — hiding that `Some(42)` is just `42` is the point.

## Waves

### Wave 0: Codebase Audit

**Status:** COMPLETE (see Audit Findings above)

### Wave 1: Manual Either Refactor

**Status:** COMPLETE ✓ (Gate passed 2026-03-16)

**Tasks:**

- [x] Rewrite `packages/fp/src/data/either.ts` with field-based discrimination
- [x] Add `Left<E, A>` and `Right<E, A>` interfaces — no `_tag`, use `left`/`right` presence
- [x] Add `right?: undefined` on Left, `left?: undefined` on Right for safe union access
- [x] Add unsafe throwing accessors (`unsafeLeft`, `unsafeRight`)
- [x] Update narrowing to use `isRight`/`isLeft` type guards (see notes)
- [x] Fix all tests — remove `as unknown as` casts, use proper narrowing

**Implementation Notes:**

1. **Type guards over `'right' in`:** The `'right' in e` check doesn't narrow correctly in TypeScript when
   the interface has optional properties (`right?: undefined`). We use `isRight(e)` and `isLeft(e)` type
   guards internally, which properly narrow the type. Users can still use `e.right !== undefined` for
   non-void types.

2. **`Either<E, void>` support:** The `isRight`/`isLeft` implementation uses `'right' in either` internally,
   which correctly handles `Right(undefined)` for void success types.

3. **Safe union access preserved:** Both variants have optional undefined fields for safe access before
   narrowing: `e.right` returns `A | undefined`, `e.left` returns `E | undefined`.

**Gate:**

- [x] `pnpm test` passes (5688 tests)
- [x] `pnpm typecheck` passes (36 packages)
- [x] `pnpm lint` passes (no lint script in fp package)
- [x] Deep review subagent validates Either refactor

### Wave 2: Manual List Refactor

**Status:** COMPLETE ✓ (Gate passed 2026-03-16)

**Tasks:**

- [x] Rewrite `packages/fp/src/data/list.ts` with null-based Nil
- [x] Nil type is `null` at runtime (simplified from interface with method declarations)
- [x] Cons is `{ head, tail }` — no `_tag`
- [x] Add type guards `isCons`, `isNil`
- [x] Verify `Nil.map(f)` works via transformer erasure to `map(null, f)`
- [x] Update dependent modules (`nonempty-list.ts`, `validate/schema.ts`) for null-based Nil

**Implementation Notes:**

1. **Simplified Nil type:** The PEP originally specified `Nil` as an interface with method declarations
   (for transformer erasure). This caused type-checking conflicts with TypeScript's narrowing. For the
   manual refactor, `Nil` is simply `type Nil = null`. Method declarations will be handled by the `@adt`
   macro in Wave 3.

2. **Null-check narrowing:** List uses `list !== null` for narrowing to Cons. The `isCons` and `isNil`
   type guards provide explicit narrowing when preferred.

3. **Cascading updates:** The null-based Nil required updates to:
   - `nonempty-list.ts`: `fromList` and `unsafeFromList` now check `list === null`
   - `validate/schema.ts`: List traversal in `nativeSafeParseAll` uses `!== null` checks
   - Test files: Mock error structures use `tail: null` instead of `{ _tag: "Nil" as const }`

4. **SFINAE rules deferred:** The SFINAE rule for null-variant assignment will be added with the `@adt`
   macro in Wave 3, as it requires macro-level awareness of null-represented variants.

**Gate:**

- [x] `pnpm test` passes (5691 tests)
- [x] `pnpm typecheck` passes (36 packages)
- [x] `pnpm lint` passes (no lint script configured)

### Wave 3: `@adt` Macro Implementation

**Tasks:**

- [ ] Create `packages/macros/src/adt.ts`
- [ ] Implement distinguishability analysis
- [ ] Implement auto-tag injection via intersection types
- [ ] Generate constructors with proper `_tag` inclusion
- [ ] Generate type guards
- [ ] Register type rewrites for method erasure

**Gate:**

- [ ] `pnpm test` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] Deep review subagent validates macro correctness, edge cases, and generated code quality

### Wave 4: Migrate Audited ADT Types

**Tasks:**

- [ ] Migrate **Validated** (`packages/fp/src/data/validated.ts`) — remove `_tag`, use `value`/`error` fields
- [ ] Migrate **Trampoline** (`packages/fp/src/io/io.ts`) — internal, remove `_tag`, use `value`/`thunk` fields
- [ ] Migrate **IO** (`packages/fp/src/io/io.ts`) — 8 variants, `@adt` auto-injects `_tag`, auto-generates guards
- [ ] Cleanup **NonEmptyList** (`packages/fp/src/data/nonempty-list.ts`) — remove unnecessary `_tag` (not a sum type)
- [ ] Create **RemoteData** example (`packages/fp/src/data/remote-data.ts`) — demonstrates auto-tag injection for ambiguous variants

**Gate:**

- [ ] `pnpm test` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] Deep review subagent validates each migration

### Types NOT Migrated (by design)

- **Option** — Keep `@opaque`. `Some(x) = x` is optimal; `@adt` would add object overhead.
- **ZeroCostResult** — Alternative pattern with `ok: boolean`. Works well as-is.

### Types CANNOT Use `@adt` (circular dependencies)

The `@adt` macro is defined in `packages/macros/`, which depends on `packages/core/`. Types in these packages cannot use `@adt` without creating circular dependencies:

| Package                 | Types                                                                      | Status                               |
| ----------------------- | -------------------------------------------------------------------------- | ------------------------------------ |
| `packages/core/`        | `ComptimeValue`, `DeriveTypeInfo`, `ConstructorRewrite`, `AccessorRewrite` | Manual unions (11, 3, 3, 2 variants) |
| `packages/macros/`      | `GenericMeta`, `TypeInfo`, `DoStep`                                        | Manual unions                        |
| `packages/transformer/` | `Edit`, `DetectedPattern`                                                  | Manual unions                        |

These infrastructure types will continue using manual discriminated unions. `@adt` is for **library authors and users** building on top of typesugar.

### Future Migration Candidates (non-core packages)

These packages CAN use `@adt` and have good candidates:

| Package               | Type                    | Variants | Benefit                                |
| --------------------- | ----------------------- | -------- | -------------------------------------- |
| `packages/symbolic/`  | `Expression<T>`         | 11       | Auto-generate 11 type guards           |
| `packages/contracts/` | `LawVerificationResult` | 3        | Textbook ADT                           |
| `packages/contracts/` | `ProofResult`           | 2        | Clarify boolean-conditional fields     |
| `packages/fp/`        | `IO<A>`                 | 8        | Auto-generate guards, exhaustive match |

## Files to Modify

| File                                         | Change                                   |
| -------------------------------------------- | ---------------------------------------- |
| `packages/fp/src/data/either.ts`             | Wave 1: Field-based discrimination       |
| `packages/fp/src/data/list.ts`               | Wave 2: Null-based Nil                   |
| `packages/macros/src/adt.ts`                 | Wave 3: New `@adt` attribute macro       |
| `packages/macros/src/index.ts`               | Wave 3: Export `@adt` macro              |
| `packages/macros/src/sfinae-rules.ts`        | Wave 3: ADT SFINAE rules                 |
| `packages/core/src/type-rewrite-registry.ts` | Wave 3: Variant support                  |
| `packages/fp/src/data/validated.ts`          | Wave 4: Remove `_tag`, field-based       |
| `packages/fp/src/io/io.ts`                   | Wave 4: Migrate Trampoline, IO to `@adt` |
| `packages/fp/src/data/nonempty-list.ts`      | Wave 4: Remove unnecessary `_tag`        |
| `packages/fp/src/data/remote-data.ts`        | Wave 4: New file, demonstrates auto-tag  |
| Test files                                   | Remove `as unknown as` casts             |
| `docs/PEP-014-adt-macro.md`                  | This document                            |

## Memory Considerations

Property names (`left`, `right`, `head`, `tail`) are interned strings in V8 — stored once globally, not per object. Short names like `l:` or `r:` provide no meaningful memory savings.

Real memory wins come from:

- **Removing `_tag`**: Saves 8 bytes per object when field-based discrimination suffices
- **Null for empty**: `Nil = null` saves ~32 bytes vs `{ _tag: "Nil" }`

## Consequences

**Benefits:**

- Native TypeScript narrowing — no casts needed in tests or user code
- Zero boilerplate — no manual `_tag` when variants are structurally distinguishable
- Zero-cost variants — Nil/None can be `null` at runtime (no allocation)
- Method syntax preserved — `list.map(f)` still works via type rewrite registry
- Unsafe accessors — `.left`/`.right` available on union (typed as `E | undefined`)

**Trade-offs:**

- More complex macro implementation than `@opaque`
- Must handle the distinguishability matrix
- Auto-tag injection adds complexity to type definitions

**Alternatives rejected:**

- Manual `_tag` on all variants: boilerplate, memory overhead
- Keep `@opaque` for everything: no native narrowing
- Class-based variants: not zero-cost (class allocation)

**Future work:**

- Phantom type method syntax (deferred — conditional method availability is complex)
- True dependent types (deferred — requires TypeScript compiler changes)

## Related Work

Typesugar already has a practical approximation of advanced type features:

| Feature                    | Module                   | Capability                                             |
| -------------------------- | ------------------------ | ------------------------------------------------------ |
| **Refinement types**       | `@typesugar/type-system` | `Refined<number, "Port">`, predicates, subtyping rules |
| **Length-indexed vectors** | `Vec<T, N>`              | Type-level arithmetic (Add, Sub, Min) for small N      |
| **Contracts**              | `@typesugar/contracts`   | Formal verification with decidability annotations      |
| **Phantom types**          | `Phantom<Data, State>`   | Type-level state machines                              |
| **Comptime**               | `comptime()`             | Compile-time evaluation                                |

This PEP adds proper ADT support to complete the functional programming type toolkit.
