<!-- generated:begin — do not edit inside this block; regenerate with `node scripts/generate-error-docs.mjs` -->
<!-- prettier-ignore-start -->

# EFFECT002

**Category:** service-resolution · **Severity:** Error

## Message

```
Layer `{layer}` provides `{service}` but implementation is incompatible
```

## Explanation

The layer declares it provides {service}, but its implementation
doesn't satisfy the service interface.

Missing methods:
{missingMethods}

Mismatched signatures:
{mismatchedSignatures}

Ensure the layer implementation matches the @service interface exactly.

<!-- prettier-ignore-end -->
<!-- generated:end -->
