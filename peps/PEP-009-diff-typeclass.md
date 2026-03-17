# PEP-009: Diff Typeclass

**Status:** Draft
**Date:** 2026-03-15
**Author:** Dean Povey
**Depends on:** PEP-008 (Pattern Matching), Product/Sum generic infrastructure, Eq typeclass

## Context

Comparing two versions of a value and understanding _what changed_ is a universal problem — state management, audit logs, event sourcing, UI reconciliation, undo/redo, API diffing. Today this requires hand-written comparison logic per type, which is tedious and drifts out of sync with the type definition.

Typesugar already has the building blocks:

- **Product/Sum generics** — structural representation of any type's fields and variants
- **Eq typeclass** — auto-derived field-wise equality for Product types
- **Destructure typeclass** (PEP-008) — auto-derived extractors for Sum type variants
- **Pattern matching** (PEP-008) — structural + extractor patterns on arbitrary types

A `Diff` typeclass that auto-derives for Product types completes the picture: compute a structural diff, then pattern match on what changed using standard match syntax. No special `match.diff()` primitive — just typeclasses composing.

### Design Validation

This feature validates the Destructure typeclass design from PEP-008. If the typeclass system is general enough, "diff matching" should emerge from composition of existing pieces with zero special-casing in the match macro:

| Piece                            | Mechanism                                        | Status       |
| -------------------------------- | ------------------------------------------------ | ------------ |
| Field-wise equality              | `Eq` typeclass (auto-derived via Product)        | Exists       |
| Structural diff                  | `Diff` typeclass (auto-derived via Product + Eq) | **This PEP** |
| Diff result type                 | `FieldDiff<T>` — standard discriminated union    | **This PEP** |
| Extractors for Changed/Unchanged | `Destructure` (auto-derived via Sum)             | PEP-008      |
| Matching on diff results         | Object + extractor patterns                      | PEP-008      |

If any of these require special match macro support, the abstraction is leaking.

## Types

### FieldDiff — What Happened to a Single Value

```typescript
type FieldDiff<T> = { _tag: "Changed"; old: T; new: T } | { _tag: "Unchanged"; value: T };
```

`FieldDiff` is a standard discriminated union. Auto-derives:

- `Destructure` for `Changed` and `Unchanged` variants (via Sum)
- `Eq` (two diffs are equal if their contents are equal)
- `Show` (for debugging: `"Changed(1, 2)"` or `"Unchanged(1)"`)

### DiffOf — Structural Diff of a Product Type

```typescript
type DiffOf<T> = { [K in keyof T]: FieldDiff<T[K]> };
```

A mapped type where each field of `T` becomes a `FieldDiff` of that field's type. For:

```typescript
interface User {
  name: string;
  age: number;
  email: string;
}
```

`DiffOf<User>` is:

```typescript
{
  name: FieldDiff<string>;
  age: FieldDiff<number>;
  email: FieldDiff<string>;
}
```

This is a plain object — matched with standard object patterns.

### SumDiff — Structural Diff of a Sum Type

```typescript
type SumDiff<T, D extends string> =
  | {
      _tag: "VariantChanged";
      oldVariant: string;
      newVariant: string;
      old: T;
      new: T;
    }
  | { _tag: "VariantSame"; variant: string; fields: DiffOf<T> };
```

For sum types, the diff first checks if the discriminant changed. If the variant is the same, it diffs the variant's fields.

## Diff Typeclass

```typescript
/** @typeclass */
interface Diff<T> {
  diff(old: T, new: T): DiffOf<T>;
}
```

### Derivation Rules

`@derive(Diff)` is valid when `@derive(Eq)` is valid (same requirement: all fields must have `Eq` instances).

**Product types** (interfaces, classes):

```typescript
@derive(Eq, Diff)
interface User { name: string; age: number; email: string }

// Auto-derived:
// const diffUser: Diff<User> = {
//   diff(old, new) {
//     return {
//       name: old.name === new.name
//         ? { _tag: "Unchanged", value: old.name }
//         : { _tag: "Changed", old: old.name, new: new.name },
//       age: old.age === new.age
//         ? { _tag: "Unchanged", value: old.age }
//         : { _tag: "Changed", old: old.age, new: new.age },
//       email: old.email === new.email
//         ? { _tag: "Unchanged", value: old.email }
//         : { _tag: "Changed", old: old.email, new: new.email },
//     };
//   }
// };
```

**Primitive types** — built-in instances:

```typescript
const diffString: Diff<string> = {
  diff: (old, new_) =>
    old === new_ ? { _tag: "Unchanged", value: old } : { _tag: "Changed", old, new: new_ },
};
// Same for number, boolean, bigint
```

**Sum types** (discriminated unions):

```typescript
@derive(Eq, Diff)
type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "square"; side: number }

// Auto-derived:
// 1. Check discriminant: if kind changed → VariantChanged
// 2. If same variant: diff the variant's fields → VariantSame with per-field FieldDiff
```

**Nested types** — transitive derivation:

```typescript
@derive(Eq, Diff)
interface Team { name: string; lead: User }

// DiffOf<Team> = {
//   name: FieldDiff<string>;
//   lead: FieldDiff<User>;   // Uses Eq<User> for comparison
// }
```

For deep structural diffs (diff the nested fields too, not just Changed/Unchanged at the top level), use `deepDiff`:

```typescript
@derive(Eq, Diff)
interface Team { name: string; lead: User }

// deepDiffOf<Team> = {
//   name: FieldDiff<string>;
//   lead: DiffOf<User>;   // Recurses into User's fields
// }
```

### canDeriveProduct / canDeriveSum

```typescript
{
  canDeriveProduct: true,   // When all fields have Eq instances
  canDeriveSum: true,       // When discriminant exists and all variants derivable
}
```

## Usage with Pattern Matching

The entire point: `Diff` produces standard types that pattern matching handles natively.

### Basic Field Diffing

```typescript
@derive(Eq, Diff)
interface Config { host: string; port: number; debug: boolean }

const changes = diff(oldConfig, newConfig);

match(changes)
  .case({ host: Changed(old, neu) }).then(`Host: ${old} → ${neu}`)
  .case({ port: Changed(_, neu) }).then(`Port updated to ${neu}`)
  .case({ debug: Changed(_, neu) }).then(`Debug ${neu ? "enabled" : "disabled"}`)
  .else("no changes")
```

### Multiple Changes

```typescript
// Match specific combinations of changes
match(changes)
  .case({ host: Changed(_, _), port: Changed(_, _) })
  .then("Connection settings changed — restart required")
  .case({ debug: Changed(_, neu) })
  .if(neu === true)
  .then("Debug mode enabled — performance may degrade")
  .else("minor config update");
```

### Audit Logging

```typescript
@derive(Eq, Diff, Show)
interface Account {
  email: string;
  role: "user" | "admin" | "superadmin";
  mfaEnabled: boolean;
}

function auditLog(actor: string, old: Account, new_: Account): string[] {
  const d = diff(old, new_);
  const logs: string[] = [];

  // Each match is independent — check all fields
  match(d.role)
    .case(Changed(_, neu)).if(neu === "superadmin")
      .then(logs.push(`CRITICAL: ${actor} escalated to superadmin`))
    .case(Changed(old, neu))
      .then(logs.push(`${actor} role: ${old} → ${neu}`))
    .case(Unchanged(_)).then(undefined)

  match(d.mfaEnabled)
    .case(Changed(_, false))
      .then(logs.push(`WARNING: ${actor} disabled MFA`))
    .case(_).then(undefined)

  match(d.email)
    .case(Changed(old, neu))
      .then(logs.push(`${actor} email: ${old} → ${neu}`))
    .case(_).then(undefined)

  return logs;
}
```

### Preprocessor Syntax

```typescript
const changes = diff(oldUser, newUser)

match(changes)
| { name: Changed(old, neu) } => `Name: ${old} → ${neu}`
| { email: Changed(_, neu) } => `Email updated to ${neu}`
| { role: Changed(_, neu) } if neu === "admin" => "ALERT: promoted to admin"
| _ => "no interesting changes"
```

### With Nested Diffs

```typescript
@derive(Eq, Diff)
interface Address { street: string; city: string; zip: string }

@derive(Eq, Diff)
interface Customer { name: string; address: Address }

// Shallow diff: address is Changed or Unchanged as a whole
const d = diff(oldCustomer, newCustomer);
match(d)
  .case({ address: Changed(_, _) }).then("address updated")
  .else("no address change")

// Deep diff: see which address fields changed
const dd = deepDiff(oldCustomer, newCustomer);
match(dd)
  .case({ address: { city: Changed(old, neu) } }).then(`Moved from ${old} to ${neu}`)
  .case({ address: { zip: Changed(_, _) } }).then("ZIP code updated")
  .else("no address change")
```

## Companion Utilities

### hasDiff — Quick Check for Any Change

```typescript
function hasDiff<T>(d: DiffOf<T>): boolean;
// Returns true if any field is Changed
// Auto-derived: checks each field's _tag
```

### changedFields — List What Changed

```typescript
function changedFields<T>(d: DiffOf<T>): (keyof T)[];
// Returns field names that are Changed
// Auto-derived via Product metadata (fieldNames)
```

### applyDiff — Reconstruct from Diff

```typescript
function applyDiff<T>(base: T, d: DiffOf<T>): T;
// For each field: if Changed, use new value; if Unchanged, keep base
// Auto-derived via Product
// Invariant: applyDiff(old, diff(old, new)) === new
```

### inverseDiff — Reverse a Diff

```typescript
function inverseDiff<T>(d: DiffOf<T>): DiffOf<T>;
// Swap old/new in every Changed field
// Invariant: applyDiff(new, inverseDiff(diff(old, new))) === old
```

## Waves

### Wave 1: Core Types + Primitive Instances (~4 files)

**Tasks:**

- [ ] Define `FieldDiff<T>` discriminated union in `packages/std/src/types/diff.ts`
- [ ] Define `DiffOf<T>` mapped type
- [ ] Define `SumDiff<T, D>` for sum type diffs
- [ ] Define `Diff<T>` typeclass interface with `@typeclass` annotation
- [ ] Built-in primitive instances: `Diff<string>`, `Diff<number>`, `Diff<boolean>`, `Diff<bigint>`
- [ ] `diff()` convenience function (summons `Diff<T>` instance)
- [ ] Tests: primitive diffs, FieldDiff construction

**Gate:**

- [ ] `diff("a", "b")` returns `Changed("a", "b")`
- [ ] `diff(1, 1)` returns `Unchanged(1)`
- [ ] `FieldDiff` auto-derives `Destructure` (via PEP-008 Sum derivation)
- [ ] `pnpm test` passes

### Wave 2: Product Auto-Derivation (~3 files)

**Depends on:** Wave 1

**Tasks:**

- [ ] Add `Diff` to `builtinDerivations` in `packages/macros/src/typeclass.ts`
  - `deriveProduct`: generate field-by-field comparison using Eq per field
  - Each field comparison produces `FieldDiff<T[K]>`
  - Return object with all field diffs
  - Requires transitive Eq instances for all fields
- [ ] Register with `canDeriveProduct: true`, `canDeriveSum: false` (sum in Wave 3)
- [ ] Tests: `@derive(Diff)` on interfaces, classes, nested types

**Gate:**

- [ ] `@derive(Eq, Diff) interface Point { x: number; y: number }` compiles
- [ ] `diff(p1, p2)` returns `{ x: FieldDiff<number>, y: FieldDiff<number> }`
- [ ] Nested: `@derive(Eq, Diff) interface Line { start: Point; end: Point }` compiles
- [ ] Missing `Eq` instance on a field produces clear error

### Wave 3: Sum Auto-Derivation + Pattern Matching Integration (~3 files)

**Depends on:** Wave 2, PEP-008 Wave 4

**Tasks:**

- [ ] Add `deriveSum` for Diff typeclass
  - Check discriminant: different variant → `VariantChanged`
  - Same variant → diff the variant's fields → `VariantSame`
- [ ] Update `canDeriveSum: true`
- [ ] End-to-end test: `@derive(Eq, Diff)` on a type, then pattern match on the diff
  - Validates Destructure typeclass composability (PEP-008 design test)
- [ ] Tests: sum type diffs, pattern matching on `Changed`/`Unchanged`

**Gate:**

- [ ] `match(diff(old, new)).case({ name: Changed(o, n) }).then(...)` works end-to-end
- [ ] Sum type diff: variant change detected, same-variant field diff works
- [ ] No special match macro support needed (pure typeclass composition)

### Wave 4: Companion Utilities + Deep Diff (~3 files)

**Depends on:** Wave 3

**Tasks:**

- [ ] `hasDiff<T>(d: DiffOf<T>): boolean` — auto-derived via Product
- [ ] `changedFields<T>(d: DiffOf<T>): (keyof T)[]` — auto-derived via Product
- [ ] `applyDiff<T>(base: T, d: DiffOf<T>): T` — auto-derived via Product
- [ ] `inverseDiff<T>(d: DiffOf<T>): DiffOf<T>` — swap old/new in Changed fields
- [ ] `deepDiff<T>` — recursive diff that produces nested `DiffOf` for Product fields
- [ ] Tests: round-trip invariants, deep diff on nested types

**Gate:**

- [ ] `applyDiff(old, diff(old, new)) === new` (round-trip via Eq)
- [ ] `applyDiff(new, inverseDiff(diff(old, new))) === old` (inverse round-trip)
- [ ] `changedFields(diff(old, new))` returns correct field names
- [ ] `deepDiff` recurses into nested Product fields

### Wave 5: Documentation (~4 files)

**Depends on:** Wave 4

**Tasks:**

- [ ] Create `docs/guides/diff-typeclass.md` with real-world examples
- [ ] Update `docs/reference/packages.md` with Diff exports
- [ ] Update `packages/std/README.md` with Diff section
- [ ] Add Diff examples to pattern matching guide (`docs/guides/pattern-matching.md`)

**Gate:**

- [ ] Guide shows audit logging, state management, and API diffing examples
- [ ] Pattern matching guide cross-references Diff as a composition showcase

## Files Changed

| File                                   | Wave | Change                                                                       |
| -------------------------------------- | ---- | ---------------------------------------------------------------------------- |
| `packages/std/src/types/diff.ts`       | 1    | **New** — `FieldDiff`, `DiffOf`, `SumDiff` types                             |
| `packages/std/src/typeclasses/diff.ts` | 1    | **New** — `Diff` typeclass + primitive instances                             |
| `packages/std/src/index.ts`            | 1    | Export Diff types and typeclass                                              |
| `packages/macros/src/typeclass.ts`     | 2–3  | Add `Diff` to `builtinDerivations`                                           |
| `packages/std/src/utils/diff.ts`       | 4    | **New** — `hasDiff`, `changedFields`, `applyDiff`, `inverseDiff`, `deepDiff` |
| `tests/diff.test.ts`                   | 1–4  | **New** — Diff typeclass tests                                               |
| `tests/diff-pattern-matching.test.ts`  | 3    | **New** — End-to-end diff + match integration                                |
| `docs/guides/diff-typeclass.md`        | 5    | **New** — Guide with examples                                                |

## Consequences

### Benefits

1. **Auto-derived** — `@derive(Eq, Diff)` is all you need; works for any Product/Sum type
2. **Composable** — Diff results are standard types; matched with standard patterns
3. **Validates PEP-008** — proves Destructure typeclass is general enough for domain patterns
4. **Round-trippable** — `applyDiff` + `inverseDiff` enable undo/redo
5. **Zero special-casing** — match macro knows nothing about diffs; it's pure typeclass composition
6. **Transitive** — nested Product types get diffs automatically

### Trade-offs

1. **Shallow by default** — `diff()` compares nested objects as wholes; `deepDiff()` is opt-in
2. **Requires Eq** — can't diff types without equality comparison
3. **Object overhead** — `DiffOf<T>` creates a `FieldDiff` wrapper per field; for hot paths, consider direct comparison instead

### Typeclass Dependency Chain

```
Product (generic infrastructure)
  └── Eq (auto-derived via Product)
        └── Diff (auto-derived via Product + Eq)
              └── DiffOf<T> (mapped type, produces FieldDiff per field)
                    └── FieldDiff (Sum type)
                          └── Destructure (auto-derived via Sum)
                                └── Pattern matching (match macro)
```

Six layers, zero special-casing, fully auto-derived. Each layer only knows about the one below it.
