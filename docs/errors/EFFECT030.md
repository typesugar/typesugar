<!-- generated:begin — do not edit inside this block; regenerate with `node scripts/generate-error-docs.mjs` -->
<!-- prettier-ignore-start -->

# EFFECT030

> **Reserved: not currently emitted by the compiler.** This code is catalogued, but no
> typesugar check reports it yet. If your build fails, look up the code it actually prints.

**Category:** schema-drift · **Severity:** Error

## Message

```
Schema `{schemaName}` is out of sync with type `{typeName}`
```

## Explanation

The Schema definition doesn't match the TypeScript type.

Type fields:
{typeFields}

Schema fields:
{schemaFields}

Differences:
{differences}

To fix:
1. Update the Schema to match the type
2. Or use @derive(EffectSchema) to auto-generate
3. Or use Schema.from(existingSchema).pipe(...) for migrations

<!-- prettier-ignore-end -->
<!-- generated:end -->
