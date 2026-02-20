# RFC 001: Macro Composition API Placement

**Status**: Proposed  
**Created**: 2026-02-20  
**Related**: Phase 1e of the Typesugar Dogfooding Plan

## Summary

This RFC decides whether macro composition primitives belong in `MacroContext` or the transformer/pipeline layer.

## Background

Currently, macro composition happens in three ways:

1. **MacroPipeline (pipeline.ts)** - Build-time composition of expression macros into new macros
2. **Ad-hoc via globalRegistry** - Macros directly lookup and invoke others (e.g., `typeclass.ts:2286`)
3. **expandAfter declarations** - Declarative ordering in macro definitions

The ad-hoc pattern (2) is problematic:
```typescript
// typeclass.ts:2286-2288 - Current ad-hoc composition
const deriveMacro = globalRegistry.getDerive(`${tcName}TC`);
if (deriveMacro) {
  const stmts = deriveMacro.expand(ctx, target, typeInfo);
}
```

This bypasses any composition abstraction and creates implicit dependencies.

## Options Considered

### Option A: MacroContext API

Add composition primitives directly to MacroContext:

```typescript
interface MacroContext {
  // ... existing methods ...
  
  /** Invoke another macro by name */
  invokeMacro<K extends MacroKind>(
    kind: K,
    name: string,
    ...args: MacroArgs<K>
  ): MacroResult<K>;
  
  /** Compose multiple macros */
  composeMacros(macros: MacroDefinition[]): MacroDefinition;
}
```

**Pros:**
- Discoverable API available to all macro authors
- Consistent access pattern
- Can add validation/tracing at invocation point

**Cons:**
- Expands MacroContext surface area
- Runtime composition harder to type correctly
- Still couples macros to specific names

### Option B: Pipeline-Only (Recommended)

Keep composition at the definition layer. Macros that need to invoke others should use `MacroPipeline` to define composed macros explicitly.

```typescript
// Instead of ad-hoc invocation:
const deriveMacro = globalRegistry.getDerive(`${tcName}TC`);
deriveMacro.expand(ctx, target, typeInfo);

// Define the composition relationship statically:
const typeClassDeriveMacro = pipeline("typeclass-derive")
  .pipe(validateDeriveMacro)
  .pipe((ctx, expr) => {
    // Main typeclass logic
  })
  .build();
```

For cases where dynamic dispatch is needed (derive by name), use explicit registry queries but document the dependency:

```typescript
interface MacroDefinitionBase {
  // ... existing fields ...
  
  /** Macros this macro may invoke dynamically (documentation only) */
  invokes?: string[];
}
```

**Pros:**
- No API surface expansion
- Composition relationships are explicit at definition time
- Easier to analyze/visualize macro dependencies
- Simpler MacroContext

**Cons:**
- Can't compose purely at runtime
- Ad-hoc invocations remain unsanctioned

### Option C: Hybrid

Add a minimal `ctx.expandDerive()` helper for the common case:

```typescript
interface MacroContext {
  /** Expand a derive macro. Returns undefined if not found. */
  expandDerive(
    name: string,
    target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo,
  ): ts.Statement[] | undefined;
}
```

This acknowledges the common pattern without generalizing.

**Pros:**
- Addresses the most common composition case
- Minimal API expansion
- Type-safe for derives

**Cons:**
- Partial solution (only derives)
- Still adds to MacroContext

## Decision

**Recommended: Option B (Pipeline-Only)** with documentation improvements.

### Rationale

1. **MacroPipeline already exists** and handles static composition well
2. **Dynamic dispatch (derive by name)** is inherently stringly-typed; legitimizing it with API doesn't fix the coupling
3. **Expanding MacroContext** adds complexity for a rare use case
4. The ad-hoc pattern in `typeclass.ts` can be refactored to use explicit pipeline composition

### Migration Path

1. Keep existing `globalRegistry.getDerive()` calls but add `invokes: ["...TC"]` documentation
2. For new macros requiring composition, use `MacroPipeline`
3. Consider extracting common patterns into reusable pipeline steps

### Future Considerations

If runtime composition becomes common, revisit with:
- A `ComposableMacro` trait/interface
- Explicit `ctx.getComposableMacro()` with verified interface

## API Changes

None required. Document the `invokes` field convention:

```typescript
export const instanceMacro = defineAttributeMacro({
  name: "instance",
  description: "...",
  invokes: ["ShowTC", "EqTC", "OrdTC"], // Documents dynamic dispatch
  // ...
});
```

## Appendix: Current Composition Usage

Searched `ctx.expandMacro|globalRegistry.get`:

1. `typeclass.ts:2286` - Invokes `{tcName}TC` derive macros dynamically
2. `macro-transformer.ts` - Registry lookups for macro resolution (not composition)

Only one true composition case exists, supporting the Pipeline-Only approach.
