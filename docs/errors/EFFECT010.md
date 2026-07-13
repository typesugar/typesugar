<!-- generated:begin — do not edit inside this block; regenerate with `node scripts/generate-error-docs.mjs` -->
<!-- prettier-ignore-start -->

# EFFECT010

**Category:** error-completeness · **Severity:** Warning

## Message

```
Error handler doesn't cover all error types
```

## Explanation

The error handler covers some but not all error types in the union.

Handled:
{handledErrors}

Unhandled:
{unhandledErrors}

Sources of unhandled errors:
{errorSources}

To fix:
1. Add handlers for the unhandled types:
   .pipe(
     Effect.catchTag("{unhandledExample}", (e) => ...),
   )

2. Or use Effect.catchAll to handle everything:
   .pipe(Effect.catchAll((e) => ...))

3. Or explicitly let errors propagate (if intentional).

<!-- prettier-ignore-end -->
<!-- generated:end -->
