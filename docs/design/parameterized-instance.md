# Parameterized Instance Syntax for @instance

## Status: Design Draft

## Problem Statement

Effect-TS types like `Effect<A, E, R>` have multiple type parameters. When defining typeclass instances, we need to fix some parameters (E, R) while varying others (A for Functor/Monad).

### Current Approach

The current implementation uses factory functions:

```typescript
// In packages/effect/src/instances.ts
export function effectFunctor<E = never, R = never>(): Functor<EffectF<E, R>> {
  return {
    map: (fa, f) => Effect.map(fa, f),
  };
}
```

Usage requires explicit factory calls:

```typescript
const F = effectFunctor<HttpError, DbConnection>();
F.map(myEffect, fn);

// With specialize
const doubled = specialize(double, effectFunctor<never, never>());
```

### Issues with Current Approach

1. **Awkward syntax**: Factory calls look different from normal instances
2. **Type parameter noise**: Must specify `<never, never>` at every call site
3. **Not unified**: Simple instances use `@instance`, HKT instances use factory functions
4. **Manual registration**: Methods must be separately registered in `specialize.ts`

## Goal

A unified `@instance` syntax that handles type-parameterized instances naturally:

```typescript
// Desired syntax
@instance
const effectFunctor: Functor<Effect<_, E, R>> = {
  map: (fa, f) => Effect.map(fa, f),
};
```

Or with explicit parameter declaration:

```typescript
@instance<E, R>
const effectFunctor: Functor<Effect<_, E, R>> = {
  map: (fa, f) => Effect.map(fa, f),
};
```

## Design

### Syntax Options

#### Option A: Wildcard in Type Position (Recommended)

Use `_` as a wildcard to mark the "varying" type parameter:

```typescript
@instance
const effectFunctor: Functor<Effect<_, E, R>> = {
  map: (fa, f) => Effect.map(fa, f),
};
```

- `_` marks the position that varies (the `A` in `Functor<F>` where `F.map: (fa: F<A>, f: A → B) => F<B>`)
- `E` and `R` are inferred as free type parameters of the instance
- Familiar to Scala/Haskell users (`_` is a common wildcard)

**Pros:**

- Visually clear which position varies
- Type parameters are implicit (inferred from annotation)
- Matches Scala syntax

**Cons:**

- `_` is a valid identifier in TypeScript
- May conflict with lodash import convention

#### Option B: Explicit Parameter Declaration

Declare type parameters on the decorator:

```typescript
@instance<E, R>
const effectFunctor: Functor<EffectF<E, R>> = {
  map: (fa, f) => Effect.map(fa, f),
};
```

- Uses existing `EffectF<E, R>` type-level function
- Type parameters are explicit on the decorator
- No new syntax (uses existing HKT encoding)

**Pros:**

- No new syntax constructs
- Works with existing HKT types
- Explicit is clear

**Cons:**

- Requires pre-defined type-level functions (`EffectF`, `ChunkF`)
- Duplicate declaration of type params (on decorator and in type)

#### Option C: Kind Marker Type

Use a special `$` or `Kind` marker:

```typescript
@instance
const effectFunctor: Functor<Effect<$A, E, R>> = {
  map: (fa, f) => Effect.map(fa, f),
};
```

- `$A` indicates "this is the kind slot, named A"
- Avoids collision with `_` identifier

**Pros:**

- Unambiguous syntax
- Can name the kind slot

**Cons:**

- New syntax to learn
- May look unusual

### Recommended: Option A with Fallback to Option B

1. Primary syntax uses `_` wildcard (ergonomic for new code)
2. Option B continues to work (backward compatible)
3. Preprocessor rewrites `Effect<_, E, R>` to `EffectF<E, R>` when needed

### Semantics

#### 1. Instance Type Parameter Extraction

When processing `@instance` on a type like `Functor<Effect<_, E, R>>`:

1. Parse the type annotation
2. Find `_` wildcard positions (must be exactly one for Functor)
3. Extract remaining type parameters as instance parameters
4. Generate the appropriate factory function or registration

```
Functor<Effect<_, E, R>>
        ^^^^^^^^^^^^^
        Type constructor: Effect
              ^ _ marks the kind slot (position 0)
                 ^ E is instance type parameter
                    ^ R is instance type parameter
```

#### 2. Code Generation

**Input:**

```typescript
@instance
const effectFunctor: Functor<Effect<_, E, R>> = {
  map: (fa, f) => Effect.map(fa, f),
};
```

**Generated Output:**

```typescript
// Factory function with type parameters
function effectFunctor<E = never, R = never>(): Functor<EffectF<E, R>> {
  return {
    map: (fa, f) => Effect.map(fa, f),
  };
}

// Runtime registration
Functor.registerParameterizedInstance("Effect", {
  factory: effectFunctor,
  params: ["E", "R"],
});

// Method registration for specialize()
registerInstanceMethods("effectFunctor", "Effect", {
  map: { source: "(fa, f) => Effect.map(fa, f)", params: ["fa", "f"] },
});
```

#### 3. Summon Resolution

When resolving `summon<Functor<Effect<_, Error, Deps>>>()`:

1. Identify outer typeclass: `Functor`
2. Identify type constructor: `Effect` (from first type argument)
3. Look up parameterized instance: find `effectFunctor`
4. Unify type parameters: `E = Error`, `R = Deps`
5. Generate: `effectFunctor<Error, Deps>()`

**Unification algorithm:**

```
Target: Functor<Effect<A, Error, Deps>>  (where A varies)
Pattern: Functor<Effect<_, E, R>>

Match:
  - Effect<A, Error, Deps> ~ Effect<_, E, R>
  - Position 0 (_) is the kind slot — skip
  - Position 1: E = Error
  - Position 2: R = Deps

Result: effectFunctor<Error, Deps>()
```

#### 4. Specialize Integration

The `specialize()` macro currently uses `registerInstanceMethods` with fixed dictionary names.

For parameterized instances, we need:

1. **Single registration works**: Method implementations like `(fa, f) => Effect.map(fa, f)` are polymorphic in E, R. The same source string works regardless of concrete E, R types.

2. **Dictionary name resolution**: When specializing `specialize(fn, effectFunctor<Error, Deps>())`, the macro should:
   - Recognize `effectFunctor<...>()` as a call to a registered parameterized instance
   - Look up methods under the base name `"effectFunctor"`
   - Inline as usual

No changes to `registerInstanceMethods` are required — the key is recognizing parameterized instance calls at specialize time.

### Instance Registry Changes

Current registry structure:

```typescript
interface InstanceEntry {
  typeclassName: string;
  forType: string; // "number", "Array", "Effect"
  instanceName: string; // variable name
  derived: boolean;
}
```

New structure for parameterized instances:

```typescript
interface InstanceEntry {
  typeclassName: string;
  forType: string;
  instanceName: string;
  derived: boolean;
  typeParams?: string[]; // ["E", "R"] for parameterized instances
  factory?: boolean; // true if this is a factory function
}
```

### Resolution Priority

When multiple instances match, use this priority:

1. **Exact match**: `@instance("Effect<string, never>")` matches `Effect<string, never>` exactly
2. **Parameterized match**: `@instance` with `Effect<_, E, R>` matches any `Effect<A, E, R>`
3. **Auto-derivation**: If no explicit instance, derive if possible

### Edge Cases

#### Multiple Wildcards

For typeclasses with multiple varying parameters (e.g., `Bifunctor`):

```typescript
@instance
const effectBifunctor: Bifunctor<Effect<_A, _E, R>> = {
  bimap: (fa, f, g) => Effect.mapBoth(fa, { onFailure: f, onSuccess: g }),
  mapLeft: (fa, f) => Effect.mapError(fa, f),
};
```

Here `_A` and `_E` both vary. The macro extracts:

- Kind positions: 0 (`_A`), 1 (`_E`)
- Instance parameters: R

#### Nested Type Constructors

For complex types:

```typescript
@instance
const taskEitherFunctor: Functor<Task<Either<E, _>>> = {
  map: (fa, f) => fa.then(e => Either.map(e, f)),
};
```

The `_` is inside `Either`, but the outer type is `Task<Either<E, _>>`. The macro should:

- Identify the full pattern
- Generate appropriate HKT type function if needed

#### Constraint Type Parameters

Some instances need constraints:

```typescript
// Hypothetical: if E extends Error
@instance<E extends Error, R>
const effectMonadError: MonadError<Effect<_, E, R>, E> = { ... };
```

**For v1**: Skip constraint support; document limitation
**Future**: Parse constraint syntax and propagate to factory function

### Backward Compatibility

1. **Existing `@instance("Type")` syntax**: Unchanged
2. **Existing `@instance("Typeclass<Type>")` syntax**: Unchanged
3. **Existing factory functions**: Continue to work as imports
4. **Manual `registerInstanceMethods`**: Continue to work

New syntax is additive — no breaking changes.

## Implementation Plan

### Phase 1: Parser Support

1. Recognize `_` in type annotations
2. Extract type parameters from `Type<_, P1, P2>` patterns
3. Build `ParameterizedInstanceInfo` structure

### Phase 2: Code Generation

1. Generate factory functions from `@instance` with wildcards
2. Generate registration calls with `typeParams` metadata
3. Register methods for `specialize()`

### Phase 3: Summon Resolution

1. Modify `summon` to handle parameterized instances
2. Implement type unification for matching
3. Generate factory calls with inferred type arguments

### Phase 4: Specialize Integration

1. Recognize parameterized factory calls in `specialize`
2. Look up methods under base instance name
3. Inline as usual

## Example: Full Effect Integration

After implementation, Effect instances would be declared as:

```typescript
// packages/effect/src/instances.ts

@instance
const effectFunctor: Functor<Effect<_, E, R>> = {
  map: (fa, f) => Effect.map(fa, f),
};

@instance
const effectApply: Apply<Effect<_, E, R>> = {
  map: (fa, f) => Effect.map(fa, f),
  ap: (fab, fa) => Effect.flatMap(fab, f => Effect.map(fa, f)),
};

@instance
const effectApplicative: Applicative<Effect<_, E, R>> = {
  map: (fa, f) => Effect.map(fa, f),
  ap: (fab, fa) => Effect.flatMap(fab, f => Effect.map(fa, f)),
  pure: (a) => Effect.succeed(a),
};

@instance
const effectMonad: Monad<Effect<_, E, R>> = {
  map: (fa, f) => Effect.map(fa, f),
  ap: (fab, fa) => Effect.flatMap(fab, f => Effect.map(fa, f)),
  pure: (a) => Effect.succeed(a),
  flatMap: (fa, f) => Effect.flatMap(fa, f),
};

@instance
const effectMonadError: MonadError<Effect<_, E, R>, E> = {
  map: (fa, f) => Effect.map(fa, f),
  ap: (fab, fa) => Effect.flatMap(fab, f => Effect.map(fa, f)),
  pure: (a) => Effect.succeed(a),
  flatMap: (fa, f) => Effect.flatMap(fa, f),
  raiseError: (e) => Effect.fail(e),
  handleErrorWith: (fa, f) => Effect.catchAll(fa, f),
};
```

Usage:

```typescript
import { summon, specialize } from "typesugar";
import { effectMonad } from "@typesugar/effect";

// Summon with specific types
const monad = summon<Monad<Effect<_, HttpError, DbConnection>>>();

// Or use the constant directly (becomes factory call)
const result = effectMonad.flatMap(myEffect, fn);

// Specialize generic functions
const doubled = specialize(double, effectMonad);
// Becomes: (fa) => Effect.map(fa, x => x * 2)
```

## Alternatives Considered

### 1. Type-Level Only (No Factory Functions)

Store a single instance and use type assertions:

```typescript
@instance
const effectFunctor: Functor<EffectF<unknown, unknown>> = { ... };

// Usage
const F = effectFunctor as Functor<EffectF<HttpError, Deps>>;
```

**Rejected because**: Requires manual casts; loses type safety at usage site.

### 2. Instance per Concrete Type

Register separate instances for each E, R combination:

```typescript
@instance("Functor<Effect<_, never, never>>")
const effectFunctorPure = { ... };

@instance("Functor<Effect<_, Error, Deps>>")
const effectFunctorWithErrorAndDeps = { ... };
```

**Rejected because**: Combinatorial explosion; can't cover all possibilities.

### 3. Lazy Instance Generation

Generate instances at `summon` time via macro:

```typescript
// No @instance needed
// summon<Functor<Effect<_, E, R>>>() generates instance inline
```

**Rejected because**: No explicit declaration; harder to trace; can't customize.

## Open Questions

1. **Default type parameters**: Should E, R default to `never` or `unknown`?
   - `never` is more restrictive (recommended)
   - `unknown` is more permissive

2. **Instance uniqueness**: Can there be multiple parameterized instances for the same typeclass/type constructor?
   - Current design: No, one per typeclass+type combination
   - Could allow with priority annotations

3. **Cross-file instances**: How to handle instances defined in different files?
   - Registration must happen at import time
   - Ensure consistent ordering

4. **Incremental compilation**: How to cache parameterized instance metadata?
   - Factory functions are stable across compilations
   - Method source strings are stable

## References

- Scala 3 given/using: https://docs.scala-lang.org/scala3/book/ca-given-using-clauses.html
- Haskell instance contexts: https://wiki.haskell.org/Instance
- fp-ts HKT encoding: https://gcanti.github.io/fp-ts/guides/HKT.html
- typesugar HKT: `packages/type-system/src/hkt.ts`
