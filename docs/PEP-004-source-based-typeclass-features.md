# PEP-004: Source-Based Typeclass Features

**Status:** Draft
**Date:** 2026-03-13
**Author:** Dan Povey
**Depends on:** None
**Enables:** PEP-002 Wave 6 (oxc as default)

## Context

Two typeclass features currently depend on runtime registries rather than source code:

1. **Auto-specialize**: `registerInstanceMethods(dictName, brand, methods)` populates a registry that the transformer queries to inline method calls
2. **Operator-rewrite**: `registerTypeclassSyntax("Numeric", [["+", "add"], ...])` populates a registry that the transformer queries to rewrite `a + b` to `numeric.add(a, b)`

This violates the "import what you need" principle. Behavior is determined by runtime state rather than source imports, making it:
- Implicit and hard to reason about
- Undetectable via static source analysis (blocking PEP-002 oxc-as-default)
- Order-dependent (registry must be populated before transform runs)

## Proposal

Move typeclass feature configuration into source code via JSDoc annotations:

### Operator Syntax (`@op`)

Typeclass methods can declare their operator mapping:

```typescript
/** @typeclass */
interface Numeric<A> {
  /** @op + */ add(a: A, b: A): A;
  /** @op - */ sub(a: A, b: A): A;
  /** @op * */ mul(a: A, b: A): A;
}

/** @typeclass */
interface Eq<A> {
  /** @op === */ equals(a: A, b: A): boolean;
  /** @op !== */ notEquals(a: A, b: A): boolean;
}

/** @typeclass */
interface Ord<A> {
  /** @op < @op <= @op > @op >= */ compare(a: A, b: A): -1 | 0 | 1;
}
```

When the transformer sees `a + b` where `a: Point` and `Numeric<Point>` is in scope:
1. Look up `Numeric` typeclass definition (from imports or local)
2. Find method with `@op +` annotation → `add`
3. Find instance for `Point` → `numericPoint`
4. Rewrite to `numericPoint.add(a, b)`

### Instance Specialization (`@specialize`)

Instance definitions carry inline method sources for auto-specialization:

```typescript
/** 
 * @impl Numeric<Point>
 * @specialize
 */
const numericPoint: Numeric<Point> = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
  mul: (a, b) => ({ x: a.x * b.x, y: a.y * b.y }),
};
```

When the transformer sees `genericFn(numericPoint, p1, p2)`:
1. Detect `numericPoint` is a `@specialize` instance
2. Parse method bodies from the instance definition
3. Create specialized version with inlined methods
4. Hoist and cache the specialization

### Detection from Source

With this design, the transformer can detect features from source patterns:

| Pattern | Indicates |
|---------|-----------|
| `/** @op ... */` in interface method | Operator syntax definition |
| `/** @impl ... */ const x = {` | Typeclass instance |
| `/** @specialize */` on instance | Auto-specialization candidate |
| Binary expr with typed operands + `@op` in scope | Operator rewrite site |
| Call with `@specialize` instance arg | Auto-specialize site |

This enables:
- Static analysis for oxc `needsTypescriptTransformer` heuristic
- Explicit, import-based behavior ("import what you need")
- IDE support (can show operator mappings, specialization sites)

## Waves

### Wave 1: TypeScript Backend - Operator Syntax

Port operator-rewrite from registry-based to source-based for the TS transformer.

**Tasks:**
- [ ] Parse `@op` annotations from typeclass method JSDoc
- [ ] Store operator mappings in typeclass metadata (alongside existing `@typeclass` handling)
- [ ] Update operator-rewrite transformer to query source-based mappings
- [ ] Deprecate `registerTypeclassSyntax()` (keep for backwards compat, emit warning)
- [ ] Migrate existing tests to use `@op` annotations
- [ ] Update documentation

**Gate:**
- [ ] `a + b` rewrites to `numeric.add(a, b)` using `@op +` annotation
- [ ] No runtime registry calls needed for operator rewriting
- [ ] Existing tests pass with new source-based approach

### Wave 2: TypeScript Backend - Auto-Specialization

Port auto-specialize from registry-based to source-based for the TS transformer.

**Tasks:**
- [ ] Parse `@specialize` annotation from instance JSDoc
- [ ] Extract method sources from instance object literal at transform time
- [ ] Update auto-specialize transformer to use source-based method extraction
- [ ] Deprecate `registerInstanceMethods()` (keep for backwards compat, emit warning)
- [ ] Migrate existing tests to use `@specialize` annotations
- [ ] Update documentation

**Gate:**
- [ ] `fn(instance, args)` auto-specializes using `@specialize` annotation
- [ ] No runtime registry calls needed for auto-specialization
- [ ] Method inlining works from parsed instance definition

### Wave 3: Oxc Detection Patterns

Add source pattern detection to `needsTypescriptTransformer` heuristic, enabling PEP-002 Wave 6.

**Depends on:** Waves 1-2

**Tasks:**
- [ ] Add `@op` pattern detection to `needsTypescriptTransformer`
- [ ] Add `@specialize` pattern detection
- [ ] Add `@impl` pattern detection (instances may trigger operator rewrite)
- [ ] Verify oxc correctly falls back for files with these patterns
- [ ] Re-attempt PEP-002 Wave 6 (oxc as default)

**Gate:**
- [ ] Files with `@op`, `@specialize`, `@impl` trigger TS fallback
- [ ] PEP-002 Wave 6 gate passes (full test suite with oxc default)

### Wave 4: Registry Removal (Optional)

Remove deprecated registry APIs once ecosystem has migrated.

**Tasks:**
- [ ] Remove `registerTypeclassSyntax()` 
- [ ] Remove `registerInstanceMethods()`
- [ ] Remove `instanceMethodRegistry` and `syntaxRegistry`
- [ ] Update all examples and documentation

**Gate:**
- [ ] No registry APIs in codebase
- [ ] All features work via source-based annotations only

## Migration Path

### For Operator Syntax

Before:
```typescript
// In module initialization or test setup
registerTypeclassSyntax("Numeric", [["+", "add"], ["-", "sub"]]);

// Typeclass definition (no operator info)
interface Numeric<A> {
  add(a: A, b: A): A;
  sub(a: A, b: A): A;
}
```

After:
```typescript
// Typeclass definition carries operator info
/** @typeclass */
interface Numeric<A> {
  /** @op + */ add(a: A, b: A): A;
  /** @op - */ sub(a: A, b: A): A;
}

// No runtime registration needed
```

### For Auto-Specialization

Before:
```typescript
// In module initialization or test setup
registerInstanceMethods("arrayFunctor", "Array", {
  map: { source: "(fa, f) => fa.map(f)", params: ["fa", "f"] },
});

// Instance definition (no specialization info)
const arrayFunctor: Functor<Array<any>> = {
  map: (fa, f) => fa.map(f),
};
```

After:
```typescript
// Instance definition carries specialization info
/** 
 * @impl Functor<Array>
 * @specialize
 */
const arrayFunctor: Functor<Array<any>> = {
  map: (fa, f) => fa.map(f),  // Source extracted at transform time
};

// No runtime registration needed
```

## Consequences

### Benefits

1. **"Import what you need"**: Behavior is explicit from source, not hidden runtime state
2. **Static analyzability**: IDE tools, linters, and oxc heuristic can detect features
3. **Unblocks PEP-002**: oxc can become default backend once detection is in place
4. **Simpler mental model**: No need to understand when registries are populated
5. **Better error messages**: Can point to source location of typeclass/instance definition

### Trade-offs

1. **More verbose typeclass definitions**: `@op` annotations add JSDoc to each method
2. **Migration effort**: Existing code using registries needs updating
3. **Parse-time extraction**: Method sources must be extractable from AST (no computed properties)

### Limitations

- `@specialize` only works for object literal instances (method bodies must be parseable)
- Operator syntax must be declared in typeclass definition (can't add operators to third-party typeclasses without wrapper)

## Files Changed

| File | Change |
|------|--------|
| `packages/transformer/src/typeclass-transformer.ts` | Parse `@op` from method JSDoc |
| `packages/transformer/src/operator-rewrite.ts` | Use source-based operator lookup |
| `packages/transformer/src/auto-specialize.ts` | Use source-based method extraction |
| `packages/macros/src/runtime-stubs.ts` | Deprecate registry functions |
| `packages/transformer/src/pipeline.ts` | Add detection patterns to heuristic |
| `docs/guides/typeclasses.md` | Document `@op` and `@specialize` |
