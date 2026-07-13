<!-- generated:begin — do not edit inside this block; regenerate with `node scripts/generate-error-docs.mjs` -->
<!-- prettier-ignore-start -->

# EFFECT020

**Category:** layer-dependency · **Severity:** Error

## Message

```
Circular layer dependency detected
```

## Explanation

The layer dependency graph contains a cycle:

{cycleVisualization}

Layers cannot be composed when they depend on each other (directly or transitively).

To fix:
1. Identify the unnecessary dependency in the cycle
2. Extract shared functionality into a separate layer
3. Use Layer.passthrough for optional dependencies

<!-- prettier-ignore-end -->
<!-- generated:end -->
