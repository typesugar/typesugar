<!-- generated:begin — do not edit inside this block; regenerate with `node scripts/generate-error-docs.mjs` -->
<!-- prettier-ignore-start -->

# EFFECT021

**Category:** layer-dependency · **Severity:** Info

## Message

```
Layer `{layer}` is provided but not required
```

## Explanation

The layer {layer} (providing {service}) is included in the composition
but no Effect in this scope requires {service}.

This could indicate:
1. Dead code — the layer can be removed
2. Missing usage — an Effect should use {service}
3. Future-proofing — intentionally included for later use

If intentional, add a comment explaining why.

<!-- prettier-ignore-end -->
<!-- generated:end -->
