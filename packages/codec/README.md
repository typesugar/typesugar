# @typesugar/codec

Versioned codec generation with schema evolution -- serde + protobuf for TypeScript.

## The Problem

Serialization formats evolve. Fields get added, removed, renamed. Old data needs to work with new code. Most TypeScript serialization libraries ignore this entirely, leaving you to write migration logic by hand.

`@typesugar/codec` gives you versioned schemas with automatic migration chain generation, so old data decodes correctly through any number of version bumps.

## Quick Start

```typescript
import { schema } from "@typesugar/codec";

interface UserProfile {
  name: string;
  email: string;
  avatar?: string;
  preferences: Record<string, unknown>;
  theme: string;
}

const userCodec = schema<UserProfile>("UserProfile", 3)
  .field("name", "string")
  .field("email", "string", { since: 2, defaultValue: "" })
  .field("avatar", "string", { since: 2, optional: true })
  .field("preferences", "object", { since: 3, defaultValue: {} })
  .field("theme", "string", { since: 3, defaultValue: "light" })
  .field("legacyField", "string", { removed: 3, optional: true })
  .buildCodec();

// Encode at current version (v3)
const encoded = userCodec.encode({
  name: "Alice",
  email: "alice@example.com",
  preferences: { lang: "en" },
  theme: "dark",
});

// Decode v1 data -- migrations apply automatically
const old = '{"__v": 1, "name": "Bob"}';
const bob = userCodec.decodeAny(old);
// { name: "Bob", email: "", avatar: null, preferences: {}, theme: "light" }
```

## Schema Evolution Rules

| Annotation | Meaning | Constraint |
| --- | --- | --- |
| `since: N` | Field added in version N | N <= current version |
| `removed: N` | Field removed in version N | N > `since` |
| `renamed: { version, oldName }` | Field renamed at version N | version <= current |
| `defaultValue: V` | Default for older versions | Required for non-optional fields added after v1 |
| `optional: true` | Field may be null/undefined | No default needed |

Validation runs at schema build time. Break a rule and `buildCodec()` throws with a clear error.

## Migration Chains

Migrations are generated automatically from field annotations. Each version step:

1. Renames fields whose `renamed.version` matches the target version
2. Adds new fields (from `since`) with their default values
3. Removes fields whose `removed` version matches

For a v1-to-v3 migration, the chain runs v1->v2 then v2->v3. No manual migration functions needed.

## JSON Codec

The default format. Embeds a `__v` field for version detection.

```typescript
import { createJsonCodec, defineSchema } from "@typesugar/codec";

const schema = defineSchema("Point", {
  version: 1,
  fields: [
    { name: "x", type: "number" },
    { name: "y", type: "number" },
  ],
});

const codec = createJsonCodec<{ x: number; y: number }>(schema);
const json = codec.encode({ x: 10, y: 20 });
// '{"__v":1,"x":10,"y":20}'
```

- `codec.decode(data)` -- strict, rejects version mismatches
- `codec.decodeAny(data)` -- applies migration chain from any known version

## Binary Codec

For performance-critical paths. Fixed-layout encoding with explicit field offsets.

```typescript
import { createBinaryCodec, type FieldLayout } from "@typesugar/codec";

const layout: FieldLayout[] = [
  { name: "x", offset: 0, size: 4, type: "float32" },
  { name: "y", offset: 4, size: 4, type: "float32" },
];

const codec = createBinaryCodec<{ x: number; y: number }>(schema, layout);
const bytes = codec.encode({ x: 1.5, y: 2.5 }); // Uint8Array
```

Binary format: 4-byte header (2 bytes magic `0x54 0x53`, 2 bytes version), then fields at their specified offsets.

Supported field types: `uint8`, `uint16`, `uint32`, `int8`, `int16`, `int32`, `float32`, `float64`, `string`, `bytes`.

## Schema Builder vs. Raw API

The `schema()` builder validates on `.build()` / `.buildCodec()`. For programmatic use, the lower-level functions are available:

```typescript
import { defineSchema, validateSchema, generateMigrations, fieldsAtVersion } from "@typesugar/codec";

const s = defineSchema("Foo", { version: 2, fields: [...] });
const errors = validateSchema(s);          // SchemaValidationError[]
const history = generateMigrations(s);     // VersionHistory with migration chain
const v1Fields = fieldsAtVersion(s, 1);    // fields active at v1
```

## Comparison

| Feature | @typesugar/codec | protobuf | serde |
| --- | --- | --- | --- |
| Language | TypeScript | Multi-language | Rust |
| Schema evolution | Automatic migrations | Manual field numbering | Manual `#[serde(default)]` |
| Binary format | Fixed-layout | Varint + tag | Format-dependent |
| JSON support | Built-in | Via jsonpb | Via serde_json |
| Compile-time validation | Phase 2 (planned) | protoc | Compile-time |
| Zero external deps | Yes | protobuf runtime | N/A |

## Macro Support (Phase 2)

The `@codec` decorator is registered but currently a pass-through. Future versions will read type structure at compile time and generate optimized codecs automatically:

```typescript
@codec({ version: 3 })
interface UserProfile {
  name: string;
  @since(2) email: string;
  @since(3) @defaultValue({}) preferences: object;
  @removed(3) legacyField?: string;
}
```
