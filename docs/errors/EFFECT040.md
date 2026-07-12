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
- Effect&lt;A, never, never&gt; → Effect.Effect&lt;A&gt;
- Effect&lt;A, E, never&gt; → Effect.Effect&lt;A, E&gt;
- Effect&lt;void, never, R&gt; → Effect.Effect&lt;void, never, R&gt;

Simpler types improve readability and IDE performance.

<!-- prettier-ignore-end -->
<!-- generated:end -->
