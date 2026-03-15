# Plan: Versioned Codec Generation (Boost.Serialization-Style)

## Status: PHASE 1 IMPLEMENTED

Phase 1 (schema builder, JSON codec with versioning, binary codec, migration chains, validation) is implemented in `packages/codec/`. Phase 2 (MessagePack format, compile-time schema reading from types) is future work.

## Inspiration

Boost.Serialization provides versioned binary/text serialization with schema evolution — types can change across versions, and the serializer handles migration automatically. Protocol Buffers and Cap'n Proto solve similar problems but require external schema files.

typesugar already has `@derive(Json)` for basic JSON serialization. This plan extends it with **schema versioning**, **binary formats**, **migration functions**, and **compile-time codec generation** — all driven by decorators on the types themselves.

## Design

### Version-Annotated Types

```typescript
import { codec, since, removed, renamed, defaultValue } from "@typesugar/codec";

@codec({ version: 3, format: "json" })
interface UserProfile {
  name: string;                              // present since v1
  email: string;                             // present since v1
  @since(2) avatar?: string;                 // added in v2
  @since(3) preferences: Preferences;        // added in v3
  @since(3) @defaultValue("light") theme: string;  // added in v3 with default
  @removed(3) legacyField?: string;          // present in v1-v2, removed in v3
  @renamed(2, "userName") name: string;      // was "userName" in v1, renamed to "name" in v2
}
```

### Compile-Time Codec Generation

The `@codec` attribute macro generates:

```typescript
// Encoder — always writes latest version
function encodeUserProfile(value: UserProfile): Uint8Array | string {
  // Version header + field encoding
}

// Decoder — handles all versions
function decodeUserProfile(data: Uint8Array | string): UserProfile {
  const version = readVersion(data);
  switch (version) {
    case 1:
      return migrateV1(decodeV1(data));
    case 2:
      return migrateV2(decodeV2(data));
    case 3:
      return decodeV3(data);
  }
}

// Migration chain (auto-generated)
function migrateV1(v1: UserProfileV1): UserProfile {
  return migrateV2({ ...v1, name: v1.userName, avatar: undefined });
}
function migrateV2(v2: UserProfileV2): UserProfile {
  return { ...v2, preferences: defaultPreferences, theme: "light" };
}
```

### Format Support

| Format    | Use Case                      | Characteristics                           |
| --------- | ----------------------------- | ----------------------------------------- |
| `json`    | APIs, config files            | Human-readable, schema in output          |
| `msgpack` | High-perf RPC, caching        | Binary, compact, fast                     |
| `binary`  | File formats, protocols       | Custom binary layout, zero-copy potential |
| `cbor`    | IoT, constrained environments | Binary, self-describing                   |

```typescript
@codec({ version: 1, format: "msgpack" })
interface SensorReading {
  timestamp: number;
  values: Float64Array;  // encoded as raw bytes, not JSON array
  deviceId: string;
}
```

### Schema Evolution Rules

The macro enforces safe evolution at compile time:

| Change                                   | Allowed? | Requirement                                                             |
| ---------------------------------------- | -------- | ----------------------------------------------------------------------- |
| Add optional field                       | Yes      | `@since(N)` annotation                                                  |
| Add required field                       | Yes      | `@since(N) @defaultValue(v)` — decoder fills default for older versions |
| Remove field                             | Yes      | `@removed(N)` — old versions decoded, field stripped                    |
| Rename field                             | Yes      | `@renamed(N, oldName)` — decoder maps old name                          |
| Change field type                        | No       | Compile error — create a new field instead                              |
| Remove required field without `@removed` | No       | Compile error — must be explicit                                        |

**Compile-time checks:**

- Version numbers must be monotonically increasing
- `@since` version must not exceed current version
- `@removed` version must be > `@since` version
- `@defaultValue` required for non-optional fields added after v1
- No gaps in version history

### Compatibility Testing

```typescript
import { checkCompatibility } from "@typesugar/codec";

// Compile-time: verifies that v3 can decode data from v1 and v2
// Generates: test fixtures for each version
staticAssert(
  checkCompatibility<UserProfile>([1, 2, 3]),
  "UserProfile must be backward-compatible across all versions"
);
```

### Binary Layout Control

For performance-critical binary formats:

```typescript
@codec({ version: 1, format: "binary", alignment: 8 })
interface PacketHeader {
  @field({ offset: 0, size: 4 }) magic: number;      // 4 bytes at offset 0
  @field({ offset: 4, size: 2 }) version: number;     // 2 bytes at offset 4
  @field({ offset: 6, size: 2 }) flags: number;       // 2 bytes at offset 6
  @field({ offset: 8, size: 4 }) payloadLength: number;
}

// Compiles to DataView reads/writes — zero-copy from ArrayBuffer
const header = decodePacketHeader(buffer);
// → { magic: view.getUint32(0), version: view.getUint16(4), ... }
```

### Integration with Existing @derive(Json)

The current `@derive(Json)` becomes a shorthand for `@codec({ version: 1, format: "json" })`. Existing code continues to work. The full `@codec` decorator is for when you need versioning or binary formats.

## Implementation

### Phase 1: Schema Versioning + JSON Codec

**Package:** `@typesugar/codec`

**`@codec` attribute macro:**

1. Parse version annotations (`@since`, `@removed`, `@renamed`, `@defaultValue`)
2. Build version history from annotations
3. Validate evolution rules at compile time
4. Generate encoder (latest version) and decoder (all versions) as AST
5. Generate migration functions between consecutive versions

### Phase 2: MessagePack Format

Add MessagePack encoding:

- Use `@typesugar/macros` `comptime()` for format-specific code generation
- Generate direct `DataView` writes (no msgpack library dependency)
- Handle TypedArray fields as raw byte sequences

### Phase 3: Custom Binary Format

Add user-controlled binary layouts:

- `@field` decorator for explicit offset/size
- Alignment control
- Zero-copy decode from `ArrayBuffer` via `DataView`
- Endianness control

### Phase 4: Schema Registry + Wire Compatibility

For distributed systems:

- Schema registry that tracks all versions of all types
- Wire compatibility checker (can service A talk to service B?)
- Schema fingerprinting for automatic version detection
- Integration with `@typesugar/effect` for service-to-service codec resolution

## Zero-Cost Analysis

| Operation               | Cost                                                         |
| ----------------------- | ------------------------------------------------------------ |
| Encode (JSON)           | `JSON.stringify` with field selection — same as hand-written |
| Encode (binary)         | `DataView` writes — same as hand-written                     |
| Decode (latest version) | Direct field reads — same as hand-written                    |
| Decode (old version)    | Object spread + defaults — one-time migration cost           |
| Version check           | Single integer comparison                                    |

The generated encoder/decoder is what you'd write by hand for each version. No reflection, no schema objects at runtime.

## Inspirations

- **Boost.Serialization** — versioned serialization with archives
- **Protocol Buffers** — schema evolution, wire compatibility
- **Cap'n Proto** — zero-copy binary serialization
- **serde (Rust)** — derive-based serialization with format agnosticism
- **Avro** — schema evolution with reader/writer schemas
- **FlatBuffers** — zero-copy, no unpacking

## Dependencies

- `@typesugar/core` — attribute macros, `comptime()`
- `@typesugar/macros` — `@derive(Json)` as foundation, `typeInfo<T>()`
- `@typesugar/type-system` — refinement types for field constraints

## Open Questions

1. Should migration functions be auto-generated or user-defined? Auto-generation works for simple cases (add field with default, remove field). Complex migrations (split field, compute derived value) need user code.
2. Should binary format support variable-length encoding (like protobuf varints)? Adds complexity but saves space.
3. How to handle circular references in JSON mode? Error at compile time, or use JSON reference pointers?
4. Should we generate TypeScript type definitions for each version (UserProfileV1, UserProfileV2) or keep them internal to the migration chain?
