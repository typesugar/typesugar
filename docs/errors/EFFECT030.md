<!-- generated:begin — do not edit inside this block; regenerate with `node scripts/generate-error-docs.mjs` -->
<!-- prettier-ignore-start -->

# EFFECT030

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
