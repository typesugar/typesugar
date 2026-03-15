# PEP-012: Type Macros

**Status:** Draft
**Date:** 2026-03-15
**Author:** Dean Povey
**Depends on:** PEP-011 (SFINAE Diagnostic Resolution)

## Context

typesugar's macro system operates on expressions, statements, and declarations. What's missing is macros that operate on **types** -- defining how a type appears to the type checker while controlling its runtime representation.

The motivating problem is extension methods on FP data types. `Option<A>` is defined as `A | null` for zero-cost runtime representation. But `A | null` has no methods -- you can't write `Some(5).map(n => n * 2)` because TypeScript sees `number` (which has no `.map()`), reports TS2339, and infers the return type as `any`. This breaks type inference and makes extension methods unusable.

The same problem affects newtypes (`UserId = number & { __brand }` has no methods), effect types (`IO<A> = () => A` has no `.map()`), and any type where the developer wants a rich API surface with a cheap runtime representation.

### The Solution: Type Macros

A **type macro** annotates a type definition and tells the transformer:

1. **What TypeScript sees** -- An interface with methods (for type checking, IDE completions, type inference)
2. **What gets emitted** -- A simpler underlying type (for zero-cost runtime)
3. **How to rewrite** -- Method calls become standalone function calls, constructors erase, accessors simplify

This is Scala 3's opaque types generalized: the type checker sees a rich interface, the runtime sees the bare representation, and the compiler bridges the gap.

### Relationship to PEP-011

PEP-011 (SFINAE) handles the diagnostic side: when TypeScript reports errors at type rewrite boundaries (e.g., assigning `T | null` to `Option<T>`), SFINAE suppresses them because the types are runtime-identical. PEP-012 handles the structural side: defining the types, registering rewrites, and performing method erasure.

Together they enable:

```typescript
import { Option, Some, None, isSome } from "@typesugar/fp";

// TypeScript sees Option<number> with .map(), .flatMap(), etc.
// Type inference works correctly throughout.
const result = Some(5)
  .map((n) => n * 2) // Option<number> -- inferred correctly
  .filter((n) => n > 5) // Option<number>
  .getOrElse(() => 0); // number

// Implicit conversion via SFINAE (PEP-011 Rule 2):
const nullable: number | null = getFromDatabase();
const opt: Option<number> = nullable; // No error -- runtime identity
```

Emitted JavaScript:

```javascript
const result = getOrElse(
  filter(
    map(5, (n) => n * 2),
    (n) => n > 5
  ),
  () => 0
);

const nullable = getFromDatabase();
const opt = nullable;
```

## Design

### Type Rewrite Registry

New registry in `@typesugar/core`:

```typescript
interface TypeRewriteEntry {
  /** The type name as seen by the type checker */
  typeName: string;

  /** The module where the type and its companion functions are defined */
  sourceModule: string;

  /** The runtime representation type (e.g., "A | null") */
  underlying: string;

  /** Method name → standalone function that implements it */
  methods: Map<string, string>;

  /** Constructor name → rewrite rule */
  constructors: Map<string, ConstructorRewrite>;

  /** Property name → rewrite rule (e.g., .value → identity) */
  accessors: Map<string, AccessorRewrite>;

  /** Whether the type is transparent within its defining file */
  transparent: boolean;
}

interface ConstructorRewrite {
  /** "identity" = erase to argument, "constant" = erase to a constant value */
  kind: "identity" | "constant" | "custom";
  value?: string;
}

interface AccessorRewrite {
  /** "identity" = erase to receiver, "custom" = custom rewrite */
  kind: "identity" | "custom";
  value?: string;
}
```

The registry is populated by attribute macros (like `@opaque`) and consulted by:

- The transformer (for method/constructor/accessor erasure)
- PEP-011's SFINAE Rule 2 (for implicit conversion diagnostics)
- The language service plugin (for completions and quick info)

### `@opaque` -- First Built-in Type Macro

JSDoc syntax on interfaces:

```typescript
/** @opaque A | null */
export interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
  flatMap<B>(f: (a: A) => Option<B>): Option<B>;
  fold<B>(onNone: () => B, onSome: (a: A) => B): B;
  getOrElse(defaultValue: () => A): A;
  filter(predicate: (a: A) => boolean): Option<A>;
  contains(value: A): boolean;
  exists(predicate: (a: A) => boolean): boolean;
  orElse(alternative: () => Option<A>): Option<A>;
  toArray(): A[];
}
```

The `@opaque` attribute macro:

1. Parses the underlying type from the JSDoc argument (`A | null`)
2. Scans the interface for method signatures
3. For each method, finds a standalone function with matching name in the same module
4. Registers a `TypeRewriteEntry`

Implemented as `defineAttributeMacro` -- no new macro kind needed.

### Companion Functions

The defining module exports both the interface and standalone implementations:

```typescript
/** @opaque A | null */
export interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
  // ...
}

// Companion functions -- the transformer targets for method erasure
export function map<A, B>(o: Option<A>, f: (a: A) => B): Option<B> {
  return (o as any) === null ? null : f(o as any);
}

export function flatMap<A, B>(o: Option<A>, f: (a: A) => Option<B>): Option<B> {
  return (o as any) === null ? null : f(o as any);
}

// Constructors
export function Some<A>(a: A): Option<A> {
  return a as unknown as Option<A>;
}

export const None: Option<never> = null as unknown as Option<never>;

// Type guards
export function isSome<A>(o: Option<A>): o is Option<A> & { value: A } {
  return (o as any) !== null;
}
```

The `as unknown as` casts bridge the type gap in the defining module. At runtime, these are no-ops (identity returns, null constants). The `as any` in implementations is needed because the type checker sees `Option<A>` as an interface, not `A | null`.

### Transparent Scope

Within the file that declares the `@opaque` type, the transformer treats the type as transparent -- it does NOT rewrite method calls, and it allows the underlying representation to be used directly. This is Scala 3 semantics: inside the companion, the opaque type equals its underlying type.

The `@opaque` macro sets `transparent: true` on the `TypeRewriteEntry`. The transformer checks this flag and skips rewriting within the defining file.

This means the standalone function implementations can use natural patterns (`=== null`, direct returns) without fighting the type system through casts.

### Auto-Resolution

Key UX requirement: `import { Option, Some, None } from "@typesugar/fp"` is sufficient to activate extension methods. No `import * as O from "..."` needed.

The transformer resolves methods via the `TypeRewriteEntry`:

1. See `x.map(f)` where `x: Option<A>`
2. Look up `Option` in `typeRewriteRegistry`
3. Find that `map` resolves to the standalone function in `@typesugar/fp/data/option`
4. Rewrite to `map(x, f)`, injecting an import if needed

This is a new resolution path in `tryRewriteExtensionMethod`, checked BEFORE the existing extension/import scanning. The type rewrite registry is authoritative -- if the type is registered, the method resolves without import scanning.

### Implicit Conversions via SFINAE

Assignment between an `@opaque` type and its underlying representation is handled by PEP-011's TypeRewriteAssignment rule. No `fromNullable()` or `toNullable()` needed:

```typescript
// Both directions are implicit:
const opt: Option<number> = nullableValue;    // SFINAE suppresses TS2322
const raw: number | null = opt;               // SFINAE suppresses TS2322

// Function arguments too:
function takesNullable(n: number | null): void { ... }
takesNullable(opt);                           // SFINAE suppresses TS2345

function takesOption(o: Option<number>): void { ... }
takesOption(nullableValue);                   // SFINAE suppresses TS2345
```

At runtime, all of these are no-ops -- the values are the same representation.

`fromNullable()` and `toNullable()` can still exist as explicit documentation functions (erased to identity by the transformer), but they're never required.

### Generalizable for User-Defined Type Macros

The `typeRewriteRegistry` API is public. Any attribute macro can register entries:

```typescript
/** @opaque () => A */
export interface IO<A> {
  map<B>(f: (a: A) => B): IO<B>;
  flatMap<B>(f: (a: A) => IO<B>): IO<B>;
  run(): A;
}

/** @opaque Base */
export interface Meters {
  add(other: Meters): Meters;
  toNumber(): number;
}
```

`@opaque` is the first built-in, but the infrastructure supports any "rich interface, cheap runtime" pattern.

## Waves

### Wave 1: Type Rewrite Registry

**Tasks:**

- [ ] Define `TypeRewriteEntry`, `ConstructorRewrite`, `AccessorRewrite` interfaces in `@typesugar/core`
- [ ] Create `typeRewriteRegistry` with registration and lookup functions
- [ ] Lookup by type name, by type symbol, and by source module
- [ ] Unit tests for registry operations

**Gate:**

- [ ] `pnpm build` passes
- [ ] `pnpm vitest run packages/core` passes

### Wave 2: `@opaque` Attribute Macro

**Tasks:**

- [ ] Implement `@opaque` macro in `@typesugar/macros`
- [ ] Parse JSDoc `@opaque <underlying-type>` annotation
- [ ] Scan interface for method signatures
- [ ] Find companion standalone functions in the same module (via type checker)
- [ ] Register `TypeRewriteEntry` with methods, constructors, accessors
- [ ] Tests: verify registry population for a sample `@opaque` interface

**Gate:**

- [ ] `pnpm build` passes
- [ ] `pnpm vitest run packages/macros` passes
- [ ] Registry contains correct entries after macro expansion

### Wave 3: Transformer Method Erasure

**Tasks:**

- [ ] Add type rewrite registry resolution path to `tryRewriteExtensionMethod`
- [ ] Check registry BEFORE existing extension/import resolution
- [ ] Rewrite `x.method(args)` → `method(x, args)` using registry info
- [ ] Handle import injection (add import for the standalone function if not present)
- [ ] Tests: `Some(5).map(n => n * 2)` rewrites to `map(Some(5), n => n * 2)`

**Gate:**

- [ ] `pnpm build` passes
- [ ] Method erasure tests pass
- [ ] Existing extension method behavior not broken

### Wave 4: Constructor and Accessor Erasure

**Tasks:**

- [ ] Implement constructor erasure: `Some(a)` → `a`, `None` → `null`
- [ ] Implement accessor erasure: `x.value` (after narrowing) → `x`
- [ ] Register constructor/accessor rewrites in the `@opaque` macro
- [ ] Tests: full Option pipeline erases to null-check code

**Gate:**

- [ ] `pnpm build` passes
- [ ] Constructor/accessor erasure tests pass
- [ ] End-to-end: `Some(5).map(f).getOrElse(() => 0)` emits `getOrElse(map(5, f), () => 0)`

### Wave 5: Transparent Scope

**Tasks:**

- [ ] Implement transparent scope detection in the transformer
- [ ] Skip method/constructor/accessor rewriting within the defining file
- [ ] Allow underlying representation usage in implementations
- [ ] Tests: the option module's `map` function can use `=== null` directly

**Gate:**

- [ ] `pnpm build` passes
- [ ] Transparent scope tests pass
- [ ] Option module builds without `as any` casts in implementations

### Wave 6: SFINAE Integration

**Tasks:**

- [ ] Wire PEP-011 Rule 2 (TypeRewriteAssignment) to consult `typeRewriteRegistry`
- [ ] Verify implicit conversions work at assignment and argument boundaries
- [ ] Tests: `Option<T> ↔ T | null` assignments produce no diagnostics

**Gate:**

- [ ] `pnpm build` passes
- [ ] SFINAE integration tests pass
- [ ] Both directions of implicit conversion work

### Wave 7: Redefine `@typesugar/fp` Types

**Tasks:**

- [ ] Rewrite `Option` as `@opaque A | null` interface with methods
- [ ] Rewrite `Either` as `@opaque Left<E> | Right<A>` interface with methods
- [ ] Rewrite `List` as `@opaque Cons<A> | Nil` interface with methods
- [ ] Update constructors (`Some`, `None`, `Left`, `Right`, `Cons`, `Nil`)
- [ ] Update type guards (`isSome`, `isNone`, `isLeft`, `isRight`, `isCons`)
- [ ] Update all standalone functions to work with transparent scope
- [ ] Update all existing tests

**Gate:**

- [ ] `pnpm build` passes
- [ ] `pnpm --filter @typesugar/fp test` passes
- [ ] `pnpm --filter @typesugar/fp typecheck` passes
- [ ] All FP showcase assertions pass

### Wave 8: Global Augmentation for Std Extensions

**Tasks:**

- [ ] Add `declare global { interface Number { clamp(...): number; abs(): number; ... } }` in `@typesugar/std`
- [ ] Add augmentations for `String`, `Array`, `Map`, `Promise`, `Date`, etc.
- [ ] Method signatures match the standalone extension functions
- [ ] Transformer still rewrites augmented methods to function calls (existing `forceRewrite` path)
- [ ] Tests: `(42).clamp(0, 100)` type-checks and compiles

**Gate:**

- [ ] `pnpm build` passes
- [ ] `pnpm --filter @typesugar/std test` passes
- [ ] `pnpm --filter @typesugar/std typecheck` passes
- [ ] No TS2339 for extension methods with augmentation

### Wave 9: Update Showcases and Docs

**Tasks:**

- [ ] Rewrite `packages/fp/examples/showcase.ts` to use dot syntax (`x.map(f)` instead of `O.map(x, f)`)
- [ ] Rewrite `packages/std/examples/showcase.ts` to use dot syntax (`(42).clamp(0, 100)`)
- [ ] Update `packages/fp/src/index.ts` barrel exports (remove namespace-import guidance)
- [ ] Update package READMEs
- [ ] Update `AGENTS.md` with type macro and SFINAE information
- [ ] Update `docs/guides/` with extension method usage

**Gate:**

- [ ] `pnpm build` passes
- [ ] `pnpm test` passes (full suite)
- [ ] Showcases run correctly
- [ ] Documentation accurately reflects new API

## Files Changed

| File                                         | Change                                             |
| -------------------------------------------- | -------------------------------------------------- |
| `packages/core/src/type-rewrite-registry.ts` | New: `TypeRewriteEntry`, registry, lookup          |
| `packages/core/src/index.ts`                 | Export type rewrite registry API                   |
| `packages/macros/src/opaque.ts`              | New: `@opaque` attribute macro                     |
| `packages/macros/src/index.ts`               | Register `@opaque` macro                           |
| `packages/transformer/src/index.ts`          | New resolution path in `tryRewriteExtensionMethod` |
| `packages/fp/src/data/option.ts`             | Redefine as `@opaque` interface                    |
| `packages/fp/src/data/either.ts`             | Redefine as `@opaque` interface                    |
| `packages/fp/src/data/list.ts`               | Redefine as `@opaque` interface                    |
| `packages/std/src/extensions/*.ts`           | Add global augmentations                           |
| `packages/fp/examples/showcase.ts`           | Rewrite with dot syntax                            |
| `packages/std/examples/showcase.ts`          | Rewrite with dot syntax                            |
| `AGENTS.md`                                  | Document type macros and SFINAE                    |

## Consequences

**Benefits:**

- Universal dot-syntax extension methods: `x.map(f)`, `(42).clamp(0, 100)`
- Full type inference and IDE completions -- no `any` leakage
- Zero-cost runtime -- all methods erased to function calls
- Implicit conversions at opaque type boundaries -- no `fromNullable()` ceremony
- General infrastructure -- enables newtypes with methods, effect types, DSLs
- Aligns with Scala 3 opaque types and Rust newtype pattern

**Trade-offs:**

- `Option<A>` is no longer literally `A | null` at the TypeScript type level (implicit conversions via SFINAE mitigate this)
- Transformer must be present for erased methods to work at runtime
- Additional transformer complexity (mitigated by building on existing extension method infrastructure)
- Global augmentations for std extensions add methods to all numbers/strings/arrays (scoped to projects that import `@typesugar/std`)

**Alternatives rejected:**

- Diagnostic suppression alone: can't fix return type inference
- Class-based wrappers: not zero-cost (wrapper object allocation)
- Branded intersection types: `null & Methods` is `never` in TypeScript
- Proxy interception: not zero-cost

**Future work:**

- `opaque type` keyword in `.sts` files (syntactic sugar for `@opaque`)
- Typeclass method dispatch via type macros
- Effect system types (IO, Task, Stream) with dot syntax
- User-defined type macros beyond `@opaque`
- `.d.sts` declaration files for opaque types
