# PEP-004: Source-Based Typeclass Features

**Status:** Complete (All Waves)
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

| Pattern                                          | Indicates                     |
| ------------------------------------------------ | ----------------------------- |
| `/** @op ... */` in interface method             | Operator syntax definition    |
| `/** @impl ... */ const x = {`                   | Typeclass instance            |
| `/** @specialize */` on instance                 | Auto-specialization candidate |
| Binary expr with typed operands + `@op` in scope | Operator rewrite site         |
| Call with `@specialize` instance arg             | Auto-specialize site          |

This enables:

- Static analysis for oxc `needsTypescriptTransformer` heuristic
- Explicit, import-based behavior ("import what you need")
- IDE support (can show operator mappings, specialization sites)

## Waves

### Wave 1: TypeScript Backend - Operator Syntax

Port operator-rewrite from registry-based to source-based for the TS transformer.

**Tasks:**

- [x] Parse `@op` annotations from typeclass method JSDoc
- [x] Store operator mappings in typeclass metadata (alongside existing `@typeclass` handling)
- [x] Update operator-rewrite transformer to query source-based mappings
- [x] Deprecate `registerTypeclassSyntax()` (keep for backwards compat, emit warning)
- [x] Migrate existing tests to use `@op` annotations
- [x] Update documentation

**Gate:**

- [x] `a + b` rewrites to `numeric.add(a, b)` using `@op +` annotation
- [x] No runtime registry calls needed for operator rewriting
- [x] Existing tests pass with new source-based approach

**Implementation Notes (2026-03-13):**

- `extractOpsFromInterface()` in transformer now uses `extractOpFromJSDoc()` (preferred) with fallback to `extractOpFromReturnType()` (deprecated)
- `registerTypeclassSyntax()` now emits a deprecation warning when called directly (not from internal processing)
- Added new source-based tests that define typeclasses with `@op` JSDoc annotations inline
- Legacy tests kept for backwards compatibility verification

### Wave 2: TypeScript Backend - Auto-Specialization

Port auto-specialize from registry-based to source-based for the TS transformer.

**Tasks:**

- [x] Parse `@specialize` annotation from instance JSDoc
- [x] Extract method sources from instance object literal at transform time
- [x] Update auto-specialize transformer to use source-based method extraction
- [x] Deprecate `registerInstanceMethods()` (keep for backwards compat, emit warning)
- [x] Migrate existing tests to use `@specialize` annotations
- [x] Update documentation

**Gate:**

- [x] `fn(instance, args)` auto-specializes using `@specialize` annotation
- [x] No runtime registry calls needed for auto-specialization
- [x] Method inlining works from parsed instance definition

**Implementation Notes (2026-03-13):**

- `tryExtractInstanceFromSource()` in transformer detects `@specialize` JSDoc annotation on variable declarations
- Methods are extracted from object literal initializers using `extractMethodsFromObjectLiteral()`
- Source-based detection runs before registry fallback for backwards compatibility
- JSDoc parsing handles both `VariableDeclaration` and parent `VariableStatement` for tag extraction
- `registerInstanceMethods()` now emits deprecation warning after internal built-in registrations complete
- Added 6 new tests for source-based auto-specialization in `auto-specialize.test.ts`

### Wave 3: Oxc Detection Patterns

Add source pattern detection to `needsTypescriptTransformer` heuristic, enabling PEP-002 Wave 6.

**Depends on:** Waves 1-2

**Tasks:**

- [x] Add `@op` pattern detection to `needsTypescriptTransformer`
- [x] Add `@specialize` pattern detection
- [x] Add `@impl` pattern detection (instances may trigger operator rewrite)
- [x] Verify oxc correctly falls back for files with these patterns
- [x] Re-attempt PEP-002 Wave 6 (oxc as default)

**Gate:** ✅ PASSED (2026-03-13)

- [x] Files with `@op`, `@specialize`, `@impl` trigger TS fallback
- [x] PEP-002 Wave 6 gate passes (full test suite with oxc default)

**Implementation Notes (2026-03-13):**

- Created `needsTypescriptTransformer()` function in `packages/transformer/src/needs-ts-transformer.ts`
- Detects JSDoc patterns via regex: `@op`, `@impl`, `@specialize`, `@typeclass`, `@deriving`
- Exported from `@typesugar/transformer` and `unplugin-typesugar` for oxc integration
- Fast path `needsTs()` function returns boolean without pattern details
- Regex patterns use `(?:[^*]|\*(?!\/))*` to prevent matching across JSDoc comment boundaries
- 21 comprehensive tests added covering all pattern types and edge cases
- Full test suite passes (5006 tests)

### Wave 4: Registry Removal (Optional)

Remove deprecated registry APIs from public API surface.

**Tasks:**

- [x] Remove `registerTypeclassSyntax()` from public exports (`@typesugar/typeclass`)
- [x] Remove `registerInstanceMethods()` from public exports (`@typesugar/specialize`)
- [x] Remove `syntaxRegistry` from public exports
- [x] Keep internal registry functions for transformer and built-in instances
- [x] Update all examples and documentation

**Gate:** ✅ PASSED (2026-03-13)

- [x] No registry APIs in public package exports
- [x] All features work via source-based annotations only
- [x] Full test suite passes (4995 tests)

**Implementation Notes (2026-03-13):**

- Removed `registerTypeclassSyntax` and `syntaxRegistry` exports from `@typesugar/typeclass`
- Removed `registerInstanceMethods` export from `@typesugar/specialize`
- Internal registry functions remain in `@typesugar/macros` for transformer use
- Built-in typeclass definitions and instance registrations continue to work
- Deprecation warnings guide users to source-based `@op` annotations
- `@specialize` annotation removed from design — auto-specialization is automatic for all `@impl` instances

## Migration Path

### For Operator Syntax

Before:

```typescript
// In module initialization or test setup
registerTypeclassSyntax("Numeric", [
  ["+", "add"],
  ["-", "sub"],
]);

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
  map: (fa, f) => fa.map(f), // Source extracted at transform time
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

- Auto-specialization only works for object literal instances (method bodies must be parseable)
- Operator syntax must be declared in typeclass definition (can't add operators to third-party typeclasses without wrapper)

## Files Changed

| File                                                 | Change                                          |
| ---------------------------------------------------- | ----------------------------------------------- |
| `packages/transformer/src/index.ts`                  | Parse `@op` from JSDoc, auto-specialize `@impl` |
| `packages/macros/src/specialize.ts`                  | Deprecate `registerInstanceMethods()`           |
| `packages/macros/src/typeclass.ts`                   | Deprecate `registerTypeclassSyntax()`           |
| `packages/transformer/src/needs-ts-transformer.ts`   | Detection heuristic for oxc fallback            |
| `packages/transformer/tests/auto-specialize.test.ts` | Tests for auto-specialization                   |
| `packages/transformer/tests/needs-ts-transformer.ts` | Tests for detection heuristic                   |
| `packages/unplugin-typesugar/src/index.ts`           | Re-export detection functions                   |
| `docs/guides/typeclasses.md`                         | Document `@op` (no `@specialize` needed)        |
