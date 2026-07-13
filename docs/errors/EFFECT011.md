<!-- generated:begin — do not edit inside this block; regenerate with `node scripts/generate-error-docs.mjs` -->
<!-- prettier-ignore-start -->

# EFFECT011

**Category:** error-completeness · **Severity:** Info

## Message

```
Redundant error handler for `{errorType}` — this error cannot occur
```

## Explanation

The error handler for {errorType} will never be triggered because
the Effect's error type doesn't include {errorType}.

Current error type: {actualErrorType}

This could indicate:
1. Dead code that should be removed
2. An earlier handler already caught this error
3. The error was eliminated by a previous operation

<!-- prettier-ignore-end -->
<!-- generated:end -->
