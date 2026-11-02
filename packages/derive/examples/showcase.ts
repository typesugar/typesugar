/**
 * @typesugar/derive Showcase
 *
 * Self-documenting examples of Rust-inspired derive macros that auto-generate
 * implementations for common traits: Eq, Ord, Clone, Debug, Hash, Default,
 * Json, and TypeGuard.
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

// The derive generates the companion Point.Eq: { equals(a, b), notEquals(a, b) }
const p1: Point = { x: 1, y: 2 };
const p2: Point = { x: 1, y: 2 };
const p3: Point = { x: 3, y: 4 };

assert(Point.Eq.equals(p1, p2) === true);
assert(Point.Eq.equals(p1, p3) === false);

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

assert(Version.Ord.compare(v100, v110) === -1);
assert(Version.Ord.compare(v110, v100) === 1);
assert(Version.Ord.compare(v100, v100) === 0);
assert(Version.Ord.compare(v100, v101) === -1);

// Use with Array.sort
const versions = [v110, v100, v101];
const sorted = versions.slice().sort(Version.Ord.compare);
assert(sorted[0] === v100);
assert(sorted[1] === v101);
assert(sorted[2] === v110);

// ============================================================================
// 3. Clone DERIVE — Deep copying
// ============================================================================

// @derive(Clone) generates a function that creates a new object, cloning
// each field through its own Clone (arrays element by element, nested
// objects recursively), like Rust's #[derive(Clone)].

@derive(Clone)
interface Color {
  r: number;
  g: number;
  b: number;
}

const red: Color = { r: 255, g: 0, b: 0 };
const redCopy = Color.Clone.clone(red);

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
const debugStr = User.Debug.debug(alice);

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

const h1 = CacheKey.Hash.hash(key1);
const h2 = CacheKey.Hash.hash(key2);
const h3 = CacheKey.Hash.hash(key3);

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

const defaults = Settings.Default.default();

assert(defaults.theme === "");
assert(defaults.fontSize === 0);
assert(defaults.notifications === false);

// ============================================================================
// 7. Json DERIVE — Serialization and validated deserialization
// ============================================================================

// @derive(Json) generates ApiConfig.Json: toJson(value) gives a plain
// object (JSON.stringify it for the wire) and fromJson(parsed) validates the
// required fields and their types.

@derive(Json)
interface ApiConfig {
  endpoint: string;
  timeout: number;
  retries: number;
}

const config: ApiConfig = { endpoint: "https://api.example.com", timeout: 5000, retries: 3 };

const json = JSON.stringify(ApiConfig.Json.toJson(config));
assert(typeof json === "string");
assert(json.includes("api.example.com"));

const parsed = ApiConfig.Json.fromJson(JSON.parse(json));
assert(parsed.endpoint === config.endpoint);
assert(parsed.timeout === config.timeout);
assert(parsed.retries === config.retries);

// Validation on deserialization — missing required fields throw
let threw = false;
try {
  ApiConfig.Json.fromJson(JSON.parse('{"endpoint": "http://localhost"}'));
} catch (e: unknown) {
  threw = true;
  assert((e as Error).message.includes("timeout") || (e as Error).message.includes("retries"));
}
assert(threw);

// ============================================================================
// 8. TypeGuard DERIVE — Runtime type guards
// ============================================================================

// @derive(TypeGuard) generates the `ApiResponse.TypeGuard` companion, whose
// is(value) performs runtime structural validation, suitable for validating
// API responses.

@derive(TypeGuard)
interface ApiResponse {
  status: number;
  message: string;
  success: boolean;
}

const isApiResponse = (value: unknown): boolean => ApiResponse.TypeGuard.is(value);

assert(isApiResponse({ status: 200, message: "OK", success: true }) === true);
assert(isApiResponse({ status: "200", message: "OK", success: true }) === false);
assert(isApiResponse({ status: 200 }) === false); // missing fields
assert(isApiResponse(null) === false);
assert(isApiResponse(42) === false);
assert(isApiResponse("string") === false);

// is() returns a boolean, not a `value is ApiResponse` predicate, so it does
// not narrow; cast after the check.
const unknown: unknown = { status: 200, message: "OK", success: true };
if (isApiResponse(unknown)) {
  const response = unknown as ApiResponse;
  assert(response.status === 200);
}

// ============================================================================
// 9. COMBINING DERIVES — Multiple derives on one type
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
assert(Product.Eq.equals(laptop, laptopCopy) === true);
assert(Product.Eq.equals(laptop, phone) === false);

// Ord: lexicographic by field order (sku first)
assert(Product.Ord.compare(laptop, phone) !== 0);

// Clone: independent copy
const cloned = Product.Clone.clone(laptop);
assert(cloned !== laptop);
assert(Product.Eq.equals(cloned, laptop) === true);

// Debug: readable representation
assert(Product.Debug.debug(laptop).includes("Product"));
assert(Product.Debug.debug(laptop).includes("LAP-001"));

// Hash: deterministic
assert(Product.Hash.hash(laptop) === Product.Hash.hash(laptopCopy));

// Json: round-trip serialization
const productJson = JSON.stringify(Product.Json.toJson(laptop));
const restored = Product.Json.fromJson(JSON.parse(productJson));
assert(Product.Eq.equals(restored, laptop) === true);

// TypeGuard: runtime validation
assert(Product.TypeGuard.is(laptop) === true);
assert(Product.TypeGuard.is({ sku: 123, name: "bad", price: "free" }) === false);

// ============================================================================
// 10. DERIVE NAMING CONVENTIONS
// ============================================================================

// Each derive adds one companion instance to the type's namespace:
//
//   @derive(Eq)        → Point.Eq.equals(a, b): boolean
//   @derive(Ord)       → Point.Ord.compare(a, b): -1 | 0 | 1
//   @derive(Clone)     → Point.Clone.clone(value): Point
//   @derive(Debug)     → Point.Debug.debug(value): string
//   @derive(Hash)      → Point.Hash.hash(value): number
//   @derive(Default)   → Point.Default.default(): Point
//   @derive(Json)      → Point.Json.toJson(value) / Point.Json.fromJson(parsed)
//   @derive(TypeGuard) → Point.TypeGuard.is(value): boolean
//
// Method syntax (p.equals(q), p.clone(), ...) is opt-in per file through the
// @typesugar/std/syntax/* activation imports.

// createDerivedFunctionName gives the conventional name of a standalone
// derived function, for macros that generate one:
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
// 11. REAL-WORLD EXAMPLE — Domain model with full derive suite
// ============================================================================

@derive(Eq, Clone, Debug, Json, TypeGuard)
interface UserProfile {
  username: string;
  email: string;
  displayName: string;
  verified: boolean;
}

const profile: UserProfile = {
  username: "alice",
  email: "alice@example.com",
  displayName: "Alice Wonderland",
  verified: true,
};

assert(profile.username === "alice");
assert(profile.verified === true);

// Clone and modify (immutable update pattern)
const updated = { ...UserProfile.Clone.clone(profile), verified: false };
assert(updated.verified === false);
assert(profile.verified === true); // original unchanged

// Serialize for API transport
const wire = JSON.stringify(UserProfile.Json.toJson(profile));
const received = UserProfile.Json.fromJson(JSON.parse(wire));
assert(UserProfile.Eq.equals(profile, received) === true);

// Validate incoming data at API boundary
const untrusted: unknown = JSON.parse(wire);
assert(UserProfile.TypeGuard.is(untrusted) === true);

// Debug logging
const log = UserProfile.Debug.debug(profile);
assert(log.includes("UserProfile"));
assert(log.includes("alice"));
