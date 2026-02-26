/**
 * @typesugar/codec Showcase
 *
 * Self-documenting examples of versioned schema definition, JSON and binary
 * codecs, schema evolution with migration chains, and the fluent SchemaBuilder.
 *
 * Type assertions used:
 *   typeAssert<Equal<A, B>>()        - A and B are the same type
 *   typeAssert<Extends<A, B>>()      - A is assignable to B
 *   typeAssert<Not<Equal<A, B>>>()   - A and B are DIFFERENT
 *   typeAssert<Not<Extends<A, B>>>() - A is NOT assignable to B
 *
 * Run:   typesugar run examples/showcase.ts
 * Build: npx tspc && node dist/examples/showcase.js
 */

import { assert, typeAssert, type Equal, type Extends, type Not } from "@typesugar/testing";
import {
  defineSchema,
  validateSchema,
  fieldsAtVersion,
  generateMigrations,
  createJsonCodec,
  createBinaryCodec,
  SchemaBuilder,
  schema,
  type Schema,
  type Codec,
  type FieldMeta,
  type Migration,
  type VersionHistory,
  type SchemaValidationError,
  type FieldLayout,
} from "../src/index.js";

// ============================================================================
// 1. DEFINE SCHEMA - Declare a versioned type layout
// ============================================================================

const userSchemaV1 = defineSchema("User", {
  version: 1,
  fields: [
    { name: "name", type: "string" },
    { name: "age", type: "number" },
  ],
});

typeAssert<Equal<typeof userSchemaV1, Schema>>();
assert(userSchemaV1.name === "User");
assert(userSchemaV1.version === 1);
assert(userSchemaV1.format === "json");
assert(userSchemaV1.fields.length === 2);

// ============================================================================
// 2. SCHEMA EVOLUTION - Add, remove, and rename fields across versions
// ============================================================================

// Real-world: a User type evolving over 3 versions
const userSchemaV3 = defineSchema("User", {
  version: 3,
  fields: [
    { name: "name", type: "string", removed: 3 }, // Renamed to displayName in v3
    { name: "age", type: "number" },
    { name: "email", type: "string", since: 2, defaultValue: "" },
    { name: "displayName", type: "string", since: 3, renamed: { version: 3, oldName: "name" }, defaultValue: "" },
    { name: "legacyField", type: "string", since: 1, removed: 3 },
  ],
});

assert(userSchemaV3.version === 3);

// fieldsAtVersion returns only fields active at a given version
const v1Fields = fieldsAtVersion(userSchemaV3, 1);
const v1FieldNames = v1Fields.map((f) => f.name);
assert(v1FieldNames.includes("name"));
assert(v1FieldNames.includes("age"));
assert(v1FieldNames.includes("legacyField"));
assert(!v1FieldNames.includes("email")); // added in v2

const v2Fields = fieldsAtVersion(userSchemaV3, 2);
const v2FieldNames = v2Fields.map((f) => f.name);
assert(v2FieldNames.includes("email"));
assert(v2FieldNames.includes("legacyField")); // not yet removed

const v3Fields = fieldsAtVersion(userSchemaV3, 3);
const v3FieldNames = v3Fields.map((f) => f.name);
assert(v3FieldNames.includes("displayName"));
assert(!v3FieldNames.includes("legacyField")); // removed in v3

// ============================================================================
// 3. SCHEMA VALIDATION - Catch evolution rule violations
// ============================================================================

const badSchema = defineSchema("Bad", {
  version: 2,
  fields: [
    { name: "futureField", type: "string", since: 5 },
    { name: "badRemoval", type: "string", since: 2, removed: 1 },
    { name: "missingDefault", type: "string", since: 2 },
  ],
});

const errors = validateSchema(badSchema);
typeAssert<Equal<typeof errors, SchemaValidationError[]>>();
assert(errors.length >= 3);

const futureError = errors.find((e) => e.field === "futureField");
assert(futureError !== undefined);
assert(futureError!.message.includes("exceeds current schema version"));

const removalError = errors.find((e) => e.field === "badRemoval");
assert(removalError !== undefined);
assert(removalError!.message.includes("must be greater than @since"));

const defaultError = errors.find((e) => e.field === "missingDefault");
assert(defaultError !== undefined);
assert(defaultError!.message.includes("must have a @defaultValue"));

// Valid schemas produce no errors
const goodErrors = validateSchema(userSchemaV1);
assert(goodErrors.length === 0);

// ============================================================================
// 4. MIGRATION CHAIN GENERATION - Auto-generate version-to-version migrations
// ============================================================================

const history = generateMigrations(userSchemaV3);
typeAssert<Equal<typeof history, VersionHistory>>();
assert(history.versions.length === 3);
assert(history.migrations.length === 2); // v1→v2, v2→v3

// Simulate migrating a v1 record to v3
let record: Record<string, unknown> = { name: "Alice", age: 30, legacyField: "old" };

for (const step of history.migrations) {
  record = step.migrate(record);
}

assert(record.email === "");
assert(record.displayName === "Alice"); // Renamed from "name" field, preserves value
assert(!("legacyField" in record));

// ============================================================================
// 5. JSON CODEC - Encode and decode with version tagging
// ============================================================================

interface UserV1 {
  name: string;
  age: number;
}

const jsonCodec = createJsonCodec<UserV1>(userSchemaV1);
typeAssert<Extends<typeof jsonCodec, Codec<UserV1>>>();

const encoded = jsonCodec.encode({ name: "Bob", age: 25 });
assert(typeof encoded === "string");

const parsed = JSON.parse(encoded as string);
assert(parsed.__v === 1);
assert(parsed.name === "Bob");
assert(parsed.age === 25);

const decoded = jsonCodec.decode(encoded);
assert(decoded.name === "Bob");
assert(decoded.age === 25);

// ============================================================================
// 6. JSON CODEC - Version migration with decodeAny()
// ============================================================================

// A v3 codec can decode v1 data by applying migration chain
interface UserV3 {
  age: number;
  email: string;
  displayName: string;
}

const v3Codec = createJsonCodec<UserV3>(userSchemaV3);

// Encode v1 data (manually — in practice you'd use the v1 codec)
const v1Data = JSON.stringify({ __v: 1, name: "Charlie", age: 40, legacyField: "x" });

const migrated = v3Codec.decodeAny(v1Data);
assert(migrated.age === 40);
assert(migrated.email === "");
assert(migrated.displayName === "Charlie"); // Renamed from "name" field

// decodeAny also works on current-version data
const v3Data = v3Codec.encode({ age: 35, email: "d@x.co", displayName: "Di" });
const roundTripped = v3Codec.decodeAny(v3Data);
assert(roundTripped.displayName === "Di");
assert(roundTripped.email === "d@x.co");

// ============================================================================
// 7. BINARY CODEC - Fixed-layout binary encoding with header
// ============================================================================

interface Sensor {
  id: number;
  temperature: number;
  humidity: number;
}

const sensorSchema = defineSchema("Sensor", {
  version: 1,
  format: "binary",
  fields: [
    { name: "id", type: "uint16" },
    { name: "temperature", type: "float32" },
    { name: "humidity", type: "float32" },
  ],
});

const sensorLayout: FieldLayout[] = [
  { name: "id", offset: 0, size: 2, type: "uint16" },
  { name: "temperature", offset: 2, size: 4, type: "float32" },
  { name: "humidity", offset: 6, size: 4, type: "float32" },
];

const binaryCodec = createBinaryCodec<Sensor>(sensorSchema, sensorLayout);

const sensorData: Sensor = { id: 42, temperature: 23.5, humidity: 65.2 };
const binaryEncoded = binaryCodec.encode(sensorData);
assert(binaryEncoded instanceof Uint8Array);

// Header: magic bytes 'T' 'S' + version
assert(binaryEncoded[0] === 0x54); // 'T'
assert(binaryEncoded[1] === 0x53); // 'S'

const sensorDecoded = binaryCodec.decode(binaryEncoded);
assert(sensorDecoded.id === 42);
assert(Math.abs(sensorDecoded.temperature as number - 23.5) < 0.01);
assert(Math.abs(sensorDecoded.humidity as number - 65.2) < 0.1);

// ============================================================================
// 8. SCHEMA BUILDER - Fluent API for schema construction
// ============================================================================

interface Config {
  host: string;
  port: number;
  debug: boolean;
}

const configCodec = schema<Config>("Config", 2)
  .field("host", "string")
  .field("port", "number")
  .field("debug", "boolean", { since: 2, defaultValue: false })
  .buildCodec();

typeAssert<Extends<typeof configCodec, Codec<Config>>>();

const configData: Config = { host: "localhost", port: 8080, debug: true };
const configEncoded = configCodec.encode(configData);
const configDecoded = configCodec.decode(configEncoded);
assert(configDecoded.host === "localhost");
assert(configDecoded.port === 8080);
assert(configDecoded.debug === true);

// SchemaBuilder validates on build — catches schema errors early
let builderError: string | null = null;
try {
  schema("Bad", 2)
    .field("oops", "string", { since: 5 })
    .build();
} catch (e) {
  builderError = (e as Error).message;
}
assert(builderError !== null);
assert(builderError!.includes("validation failed"));

// ============================================================================
// 9. SCHEMA BUILDER - Build without codec (schema-only)
// ============================================================================

const rawSchema = schema("Event", 1)
  .field("type", "string")
  .field("timestamp", "number")
  .field("payload", "string", { optional: true })
  .build();

typeAssert<Equal<typeof rawSchema, Schema>>();
assert(rawSchema.name === "Event");
assert(rawSchema.fields.length === 3);
assert(rawSchema.fields[2].optional === true);

// ============================================================================
// 10. REAL-WORLD EXAMPLE - API versioning with backward compatibility
// ============================================================================

// An API response type that evolved across 3 versions:
// v1: { items: string[], total: number }
// v2: + pagination with cursor field
// v3: renamed "items" to "results", removed "total" (computed from results.length)

interface ApiResponseV3 {
  results: string[];
  cursor: string;
}

const apiSchema = defineSchema("ApiResponse", {
  version: 3,
  fields: [
    { name: "items", type: "string[]", removed: 3 },
    { name: "total", type: "number", removed: 3 },
    { name: "cursor", type: "string", since: 2, defaultValue: "" },
    { name: "results", type: "string[]", since: 3, renamed: { version: 3, oldName: "items" }, defaultValue: [] },
  ],
});

const apiCodec = createJsonCodec<ApiResponseV3>(apiSchema);

// A v1 client sends data without cursor or results
const legacyPayload = JSON.stringify({ __v: 1, items: ["a", "b"], total: 2 });
const upgraded = apiCodec.decodeAny(legacyPayload);
assert(Array.isArray(upgraded.results));
assert(upgraded.cursor === "");

console.log("@typesugar/codec showcase: all assertions passed!");
