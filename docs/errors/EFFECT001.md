<!-- generated:begin — do not edit inside this block; regenerate with `node scripts/generate-error-docs.mjs` -->
<!-- prettier-ignore-start -->

# EFFECT001

**Category:** service-resolution · **Severity:** Error

## Message

```
No layer provides `{service}`
```

## Explanation

The Effect requires a service that is not provided by any registered layer.

Effect&lt;{successType}, {errorType}, {requirements}&gt; needs:
- {service} (no layer found)

To fix:
1. Define a layer for the service:
   @layer({service})
   const {serviceLower}Live = { ... }

2. Or provide the service directly:
   Effect.provideService(program, {service}, impl)

If the service is from a library, ensure you import its layer.

<!-- prettier-ignore-end -->
<!-- generated:end -->
