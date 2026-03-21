//! Schema & Codecs
//! @codec extracts type info at compile time for versioned serialization

import "@typesugar/codec";
import { SchemaBuilder } from "@typesugar/codec";
import { comptime } from "typesugar";

// @codec reads the interface at compile time and generates defineSchema()
// 👀 Check JS Output: the interface stays, plus a generated schema constant
/** @codec */
interface UserV1 {
  name: string;
  email: string;
}

const SCHEMA_VERSION = comptime(() => 2);

// Evolve the schema — add fields with migration defaults
const userV2 = new SchemaBuilder("User", SCHEMA_VERSION)
  .field("name", "string")
  .field("email", "string")
  .field("age", "number", { default: 0, since: 2 })
  .field("role", "string", { default: "user", since: 2 })
  .build();

console.log("Schema:", userV2.name, "v" + userV2.version);
console.log("Fields:", userV2.fields.map((f: any) => f.name).join(", "));

// JSON codec: encode → decode roundtrip
const codec = new SchemaBuilder("Config", 1, "json")
  .field("host", "string")
  .field("port", "number")
  .field("debug", "boolean", { default: false })
  .buildCodec();

const config = { host: "localhost", port: 8080, debug: true };
const encoded = codec.encode(config);
console.log("\nEncoded:", encoded);

const decoded = codec.decode(encoded);
console.log("Decoded:", JSON.stringify(decoded));

// Try: add a new field to UserV1 and watch @codec regenerate the schema
