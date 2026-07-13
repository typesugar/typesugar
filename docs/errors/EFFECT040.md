<!-- generated:begin — do not edit inside this block; regenerate with `node scripts/generate-error-docs.mjs` -->
<!-- prettier-ignore-start -->

# EFFECT040

**Category:** type-simplification · **Severity:** Info

## Message

```
Effect type could be simplified
```

## Explanation

The Effect type {current} can be expressed more simply as {suggested}.

Common simplifications:
- Effect<A, never, never> → Effect.Effect<A>
- Effect<A, E, never> → Effect.Effect<A, E>
- Effect<void, never, R> → Effect.Effect<void, never, R>

Simpler types improve readability and IDE performance.

<!-- prettier-ignore-end -->
<!-- generated:end -->
