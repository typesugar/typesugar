/**
 * @typesugar/derive Showcase
 *
 * Self-documenting examples of Rust-inspired derive macros that auto-generate
 * implementations for common traits: Eq, Ord, Clone, Debug, Hash, Default,
 * Json, Builder, and TypeGuard.
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
import { derive } from "typesugar";

// ============================================================================
// 1. Eq DERIVE — Structural equality comparison
// ============================================================================

// @derive(Eq) generates a field-by-field equality function.
// Primitives use ===, objects use JSON comparison.

@derive(Eq)
interface Point {
  x: number;
  y: number;
}

// The derive generates: pointEq(a: Point, b: Point): boolean
const p1: Point = { x: 1, y: 2 };
const p2: Point = { x: 1, y: 2 };
const p3: Point = { x: 3, y: 4 };

assert(pointEq(p1, p2) === true);
assert(pointEq(p1, p3) === false);

// ============================================================================
// 2. Ord DERIVE — Lexicographic ordering
// ============================================================================

// @derive(Ord) generates a comparison function that walks fields in
// declaration order, returning -1 | 0 | 1.

@derive(Ord)
interface Version {
  major: number;
  minor: number;
  patch: number;
}

const v100: Version = { major: 1, minor: 0, patch: 0 };
const v110: Version = { major: 1, minor: 1, patch: 0 };
const v101: Version = { major: 1, minor: 0, patch: 1 };

assert(versionCompare(v100, v110) === -1);
assert(versionCompare(v110, v100) === 1);
assert(versionCompare(v100, v100) === 0);
assert(versionCompare(v100, v101) === -1);

// Use with Array.sort
const versions = [v110, v100, v101];
const sorted = versions.slice().sort(versionCompare);
assert(sorted[0] === v100);
assert(sorted[1] === v101);
assert(sorted[2] === v110);

// ============================================================================
// 3. Clone DERIVE — Deep copying
// ============================================================================

// @derive(Clone) generates a function that creates a new object
// with the same field values (shallow copy of each field).

@derive(Clone)
interface Color {
  r: number;
  g: number;
  b: number;
}

const red: Color = { r: 255, g: 0, b: 0 };
const redCopy = cloneColor(red);

assert(redCopy.r === 255 && redCopy.g === 0 && redCopy.b === 0);
assert(redCopy !== red); // different object reference

// ============================================================================
// 4. Debug DERIVE — Developer-friendly string representation
// ============================================================================

// @derive(Debug) generates a formatted string showing type name and fields.
// Output: "TypeName { field1: value1, field2: value2 }"

@derive(Debug)
interface User {
  id: number;
  name: string;
  active: boolean;
}

const alice: User = { id: 1, name: "Alice", active: true };
const debugStr = debugUser(alice);

assert(debugStr.includes("User"));
assert(debugStr.includes("id"));
assert(debugStr.includes("1"));
assert(debugStr.includes("Alice"));
assert(debugStr.includes("active"));

// ============================================================================
// 5. Hash DERIVE — Deterministic hash codes
// ============================================================================

// @derive(Hash) generates a djb2-style hash function.
// Equal values produce equal hashes (consistency with Eq).

@derive(Hash, Eq)
interface CacheKey {
  namespace: string;
  id: number;
}

const key1: CacheKey = { namespace: "users", id: 42 };
const key2: CacheKey = { namespace: "users", id: 42 };
const key3: CacheKey = { namespace: "posts", id: 42 };

const h1 = hashCacheKey(key1);
const h2 = hashCacheKey(key2);
const h3 = hashCacheKey(key3);

assert(h1 === h2); // same inputs → same hash
assert(h1 !== h3); // different namespace → different hash
assert(typeof h1 === "number");
assert(h1 >= 0); // unsigned

// ============================================================================
// 6. Default DERIVE — Sensible default values
// ============================================================================

// @derive(Default) generates a factory function that returns an object
// with zero/empty defaults for each field based on type.

@derive(Default)
interface Settings {
  theme: string;
  fontSize: number;
  notifications: boolean;
}

const defaults = defaultSettings();

assert(defaults.theme === "");
assert(defaults.fontSize === 0);
assert(defaults.notifications === false);

// ============================================================================
// 7. Json DERIVE — Serialization and validated deserialization
// ============================================================================

// @derive(Json) generates toJson() and fromJson() functions.
// fromJson() validates required fields and types.

@derive(Json)
interface ApiConfig {
  endpoint: string;
  timeout: number;
  retries: number;
}

const config: ApiConfig = { endpoint: "https://api.example.com", timeout: 5000, retries: 3 };

const json = apiConfigToJson(config);
assert(typeof json === "string");
assert(json.includes("api.example.com"));

const parsed = apiConfigFromJson(json);
assert(parsed.endpoint === config.endpoint);
assert(parsed.timeout === config.timeout);
assert(parsed.retries === config.retries);

// Validation on deserialization — missing required fields throw
let threw = false;
try {
  apiConfigFromJson('{"endpoint": "http://localhost"}');
} catch (e: unknown) {
  threw = true;
  assert((e as Error).message.includes("timeout") || (e as Error).message.includes("retries"));
}
assert(threw);

// ============================================================================
// 8. Builder DERIVE — Fluent builder pattern
// ============================================================================

// @derive(Builder) generates a builder class with .withField() methods
// and a .build() method that constructs the final object.

@derive(Builder)
interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  ssl: boolean;
}

const dbConfig = new DatabaseConfigBuilder()
  .withHost("db.example.com")
  .withPort(5432)
  .withDatabase("myapp")
  .withSsl(true)
  .build();

assert(dbConfig.host === "db.example.com");
assert(dbConfig.port === 5432);
assert(dbConfig.database === "myapp");
assert(dbConfig.ssl === true);

// Builder methods are chainable and return the builder
const builder = new DatabaseConfigBuilder();
typeAssert<Equal<ReturnType<typeof builder.withHost>, DatabaseConfigBuilder>>();

// ============================================================================
// 9. TypeGuard DERIVE — Runtime type guards
// ============================================================================

// @derive(TypeGuard) generates an isTypeName() function that performs
// runtime structural validation, suitable for validating API responses.

@derive(TypeGuard)
interface ApiResponse {
  status: number;
  message: string;
  success: boolean;
}

assert(isApiResponse({ status: 200, message: "OK", success: true }) === true);
assert(isApiResponse({ status: "200", message: "OK", success: true }) === false);
assert(isApiResponse({ status: 200 }) === false); // missing fields
assert(isApiResponse(null) === false);
assert(isApiResponse(42) === false);
assert(isApiResponse("string") === false);

// Type narrowing: after the guard, the value is typed as ApiResponse
const unknown: unknown = { status: 200, message: "OK", success: true };
if (isApiResponse(unknown)) {
  typeAssert<Equal<typeof unknown, ApiResponse>>();
  assert(unknown.status === 200);
}

// ============================================================================
// 10. COMBINING DERIVES — Multiple derives on one type
// ============================================================================

// Derives compose naturally — add as many as needed.

@derive(Eq, Ord, Clone, Debug, Hash, Json, TypeGuard)
interface Product {
  sku: string;
  name: string;
  price: number;
}

const laptop: Product = { sku: "LAP-001", name: "Laptop", price: 999 };
const phone: Product = { sku: "PHN-001", name: "Phone", price: 699 };
const laptopCopy: Product = { sku: "LAP-001", name: "Laptop", price: 999 };

// Eq: structural equality
assert(productEq(laptop, laptopCopy) === true);
assert(productEq(laptop, phone) === false);

// Ord: lexicographic by field order (sku first)
assert(productCompare(laptop, phone) !== 0);

// Clone: independent copy
const cloned = cloneProduct(laptop);
assert(cloned !== laptop);
assert(productEq(cloned, laptop) === true);

// Debug: readable representation
assert(debugProduct(laptop).includes("Product"));
assert(debugProduct(laptop).includes("LAP-001"));

// Hash: deterministic
assert(hashProduct(laptop) === hashProduct(laptopCopy));

// Json: round-trip serialization
const productJson = productToJson(laptop);
const restored = productFromJson(productJson);
assert(productEq(restored, laptop) === true);

// TypeGuard: runtime validation
assert(isProduct(laptop) === true);
assert(isProduct({ sku: 123, name: "bad", price: "free" }) === false);

// ============================================================================
// 11. DERIVE NAMING CONVENTIONS
// ============================================================================

// Each derive produces predictably named functions:
//
//   @derive(Eq)        → pointEq(a, b): boolean
//   @derive(Ord)       → pointCompare(a, b): -1 | 0 | 1
//   @derive(Clone)     → clonePoint(value): Point
//   @derive(Debug)     → debugPoint(value): string
//   @derive(Hash)      → hashPoint(value): number
//   @derive(Default)   → defaultPoint(): Point
//   @derive(Json)      → pointToJson(value): string
//                        pointFromJson(json): Point
//   @derive(Builder)   → class PointBuilder { withX(...).build() }
//   @derive(TypeGuard)  → isPoint(value): value is Point

// The createDerivedFunctionName helper encodes these conventions:
import { createDerivedFunctionName } from "@typesugar/derive";

assert(createDerivedFunctionName("eq", "Point") === "pointEq");
assert(createDerivedFunctionName("compare", "Point") === "pointCompare");
assert(createDerivedFunctionName("clone", "Point") === "clonePoint");
assert(createDerivedFunctionName("debug", "Point") === "debugPoint");
assert(createDerivedFunctionName("hash", "Point") === "hashPoint");
assert(createDerivedFunctionName("default", "Point") === "defaultPoint");
assert(createDerivedFunctionName("toJson", "Point") === "pointToJson");
assert(createDerivedFunctionName("fromJson", "Point") === "pointFromJson");
assert(createDerivedFunctionName("is", "Point") === "isPoint");

// ============================================================================
// 12. REAL-WORLD EXAMPLE — Domain model with full derive suite
// ============================================================================

@derive(Eq, Clone, Debug, Json, Builder, TypeGuard)
interface UserProfile {
  username: string;
  email: string;
  displayName: string;
  verified: boolean;
}

// Build a profile with the builder
const profile = new UserProfileBuilder()
  .withUsername("alice")
  .withEmail("alice@example.com")
  .withDisplayName("Alice Wonderland")
  .withVerified(true)
  .build();

assert(profile.username === "alice");
assert(profile.verified === true);

// Clone and modify (immutable update pattern)
const updated = { ...cloneUserProfile(profile), verified: false };
assert(updated.verified === false);
assert(profile.verified === true); // original unchanged

// Serialize for API transport
const wire = userProfileToJson(profile);
const received = userProfileFromJson(wire);
assert(userProfileEq(profile, received) === true);

// Validate incoming data at API boundary
const untrusted: unknown = JSON.parse(wire);
assert(isUserProfile(untrusted) === true);

// Debug logging
const log = debugUserProfile(profile);
assert(log.includes("UserProfile"));
assert(log.includes("alice"));
