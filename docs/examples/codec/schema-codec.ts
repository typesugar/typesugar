//! Schema & Codecs
//! Type-safe serialization with versioned schemas

import { SchemaBuilder } from "@typesugar/codec";

// Define a versioned schema with the fluent builder
const userSchemaV1 = new SchemaBuilder("User", 1)
  .field("name", "string")
  .field("email", "string")
  .build();

console.log("Schema v1:", userSchemaV1.name, "version", userSchemaV1.version);
console.log("Fields:", userSchemaV1.fields.map((f: any) => f.name).join(", "));

// Evolve the schema — add fields with defaults
const userSchemaV2 = new SchemaBuilder("User", 2)
  .field("name", "string")
  .field("email", "string")
  .field("age", "number", { default: 0, since: 2 })
  .field("role", "string", { default: "user", since: 2 })
  .build();

console.log("\nSchema v2:", userSchemaV2.name, "version", userSchemaV2.version);
console.log("Fields:", userSchemaV2.fields.map((f: any) => f.name).join(", "));

// Create a JSON codec from the schema
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
