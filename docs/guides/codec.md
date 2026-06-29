# Versioned Codecs

Schema evolution with automatic migration chains — old data decodes correctly through any number of version bumps.

> 🧊 **Frozen ([PEP-048](https://github.com/typesugar/typesugar/blob/main/peps/PEP-048-package-triage.md)).** `@typesugar/codec` is not under active development and is excluded from release. It still lives in the repo and builds, but is not part of typesugar's actively-maintained surface.

## The Problem

Serialization formats evolve. Fields get added, removed, renamed. Old data stored in databases, caches, or message queues needs to work with new code. Most TypeScript serialization libraries ignore this, leaving you to write migration logic by hand.

`@typesugar/codec` gives you versioned schemas with automatic migration chain generation, so old data decodes correctly through any number of version bumps.

## Quick Start

```bash
npm install @typesugar/codec
```

Requires `@typesugar/core` as a peer dependency and the TypeSugar transformer for compile-time macro expansion.

```typescript
import { schema } from "@typesugar/codec";

const userCodec = schema<{
  name: string;
  email: string;
  theme: string;
}>("UserProfile", 3)
  .field("name", "string")
  .field("email", "string", { since: 2, defaultValue: "" })
  .field("theme", "string", { since: 3, defaultValue: "light" })
  .field("legacyField", "string", { removed: 3, optional: true })
  .buildCodec();

// Encode at current version (v3)
const json = userCodec.encode({ name: "Alice", email: "alice@example.com", theme: "dark" });

// Decode v1 data — migrations apply automatically
const old = '{"__v": 1, "name": "Bob"}';
const bob = userCodec.decodeAny(old);
// { name: "Bob", email: "", theme: "light" }
```

## Schema Evolution Rules

| Annotation                      | Meaning                     | Constraint                                      |
| ------------------------------- | --------------------------- | ----------------------------------------------- |
| `since: N`                      | Field added in version N    | N <= current version                            |
| `removed: N`                    | Field removed in version N  | N > the field's `since`                         |
| `renamed: { version, oldName }` | Field renamed at version N  | version <= current                              |
| `defaultValue: V`               | Default for older versions  | Required for non-optional fields added after v1 |
| `optional: true`                | Field may be null/undefined | No default needed                               |

Validation runs at build time. Break a rule and `buildCodec()` throws with a clear error message.

### Evolution example

```typescript
const codec = schema("Config", 3)
  .field("host", "string") // v1
  .field("port", "number", { since: 1, defaultValue: 8080 }) // v1
  .field("tls", "boolean", { since: 2, defaultValue: false }) // added in v2
  .field("timeout", "number", { since: 3, defaultValue: 30 }) // added in v3
  .field("debug", "boolean", { removed: 2, optional: true }) // removed in v2
  .field("endpoint", "string", {
    since: 3,
    renamed: { version: 3, oldName: "host" }, // renamed in v3
    defaultValue: "localhost",
  })
  .buildCodec();
```

## JSON Codec

The default format embeds a `__v` field for version detection:

```typescript
import { defineSchema, createJsonCodec } from "@typesugar/codec";

const pointSchema = defineSchema("Point", {
  version: 1,
  fields: [
    { name: "x", type: "number" },
    { name: "y", type: "number" },
  ],
});

const codec = createJsonCodec<{ x: number; y: number }>(pointSchema);
const json = codec.encode({ x: 10, y: 20 });
// '{"__v":1,"x":10,"y":20}'
```

- `codec.decode(data)` — strict, rejects version mismatches
- `codec.decodeAny(data)` — applies migration chain from any known version

## Binary Codec

For performance-critical paths. Fixed-layout encoding with explicit field offsets:

```typescript
import { createBinaryCodec, type FieldLayout } from "@typesugar/codec";

const layout: FieldLayout[] = [
  { name: "x", offset: 0, size: 4, type: "float32" },
  { name: "y", offset: 4, size: 4, type: "float32" },
];

const codec = createBinaryCodec<{ x: number; y: number }>(pointSchema, layout);
const bytes = codec.encode({ x: 1.5, y: 2.5 }); // Uint8Array
const point = codec.decode(bytes); // { x: 1.5, y: 2.5 }
```

Binary format: 4-byte header (2 bytes magic `0x54 0x53`, 2 bytes version), then fields at their specified offsets.

Supported field types: `uint8`, `uint16`, `uint32`, `int8`, `int16`, `int32`, `float32`, `float64`, `string`, `bytes`.

## Migration Chains

Migrations are generated automatically from field annotations. Each version step:

1. Renames fields whose `renamed.version` matches the target
2. Adds new fields (from `since`) with their default values
3. Removes fields whose `removed` version matches

For v1-to-v3 data, the chain runs v1->v2 then v2->v3. No manual migration functions needed.

```typescript
import { defineSchema, generateMigrations, fieldsAtVersion } from "@typesugar/codec";

const s = defineSchema("Foo", { version: 3, fields: [...] });
const history = generateMigrations(s);  // full migration chain
const v1Fields = fieldsAtVersion(s, 1); // which fields existed at v1
```

## Validation

The schema validator catches mistakes before they reach production:

```typescript
import { defineSchema, validateSchema } from "@typesugar/codec";

const errors = validateSchema(mySchema);
// SchemaValidationError[] — empty if valid
```

It checks for:

- Fields with `since` greater than the current version
- `removed` before `since` (can't remove a field before it was added)
- Non-optional fields added after v1 without a `defaultValue`
- Duplicate field names
- Invalid type strings

## Schema Builder vs. Raw API

The `schema()` builder validates on `.build()` / `.buildCodec()`. For programmatic use, the lower-level functions are available:

```typescript
import { defineSchema, validateSchema, generateMigrations, fieldsAtVersion } from "@typesugar/codec";

const s = defineSchema("Foo", { version: 2, fields: [...] });
const errors = validateSchema(s); // SchemaValidationError[]
const history = generateMigrations(s); // VersionHistory with migration chain
const v1Fields = fieldsAtVersion(s, 1); // fields active at v1
```

## Macro Support (Phase 2)

The `@codec` decorator supports field-level decorators (`@since`, `@removed`, `@defaultValue`) for schema evolution:

```typescript
@codec({ version: 3 })
interface UserProfile {
  name: string;
  @since(2) email: string;
  @since(3) @defaultValue({}) preferences: object;
  @removed(3) legacyField?: string;
}
```

## Zero-Cost Guarantee

Schema definitions are compile-time only — the `@codec` macro extracts type structure at build time, so schema metadata is erased from production bundles. The JSON codec has minimal runtime overhead: just property access plus a version field on each encoded object. The binary codec uses fixed-layout `DataView` reads and writes with no dynamic dispatch. There are no external dependencies beyond `@typesugar/core`.

## Integration

`@typesugar/codec` works with [`@typesugar/validate`](/guides/validate) for runtime validation of decoded data — decode first, then validate against your schema constraints. It is compatible with [`@typesugar/derive`](/guides/derive) for auto-deriving codec instances from type definitions. Codecs produce and consume plain strings or `Uint8Array` buffers, so they work with any transport layer: HTTP, WebSocket, file I/O, or message queues.

## Comparison

| Feature                 | @typesugar/codec      | protobuf               | serde                      |
| ----------------------- | --------------------- | ---------------------- | -------------------------- |
| Language                | TypeScript            | Multi-language         | Rust                       |
| Schema evolution        | Automatic migrations  | Manual field numbering | Manual `#[serde(default)]` |
| Binary format           | Fixed-layout          | Varint + tag           | Format-dependent           |
| JSON support            | Built-in              | Via jsonpb             | Via serde_json             |
| Compile-time validation | Phase 2 (implemented) | protoc                 | Compile-time               |
| Zero external deps      | Yes                   | protobuf runtime       | N/A                        |

## What's Next

- [API Reference](/reference/packages#codec)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/codec)
