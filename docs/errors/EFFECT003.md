<!-- generated:begin — do not edit inside this block; regenerate with `node scripts/generate-error-docs.mjs` -->
<!-- prettier-ignore-start -->

# EFFECT003

> **Reserved: not currently emitted by the compiler.** This code is catalogued, but no
> typesugar check reports it yet. If your build fails, look up the code it actually prints.

**Category:** service-resolution · **Severity:** Warning

## Message

```
Multiple layers provide `{service}`
```

## Explanation

More than one layer is registered as providing {service}:
{layers}

The first registered layer will be used. To resolve:
1. Remove duplicate layer definitions
2. Use explicit Layer.provide() instead of resolveLayer()
3. Rename one layer to provide a different service

<!-- prettier-ignore-end -->
<!-- generated:end -->
