/**
 * Derive Macro Example
 *
 * Demonstrates automatic implementation generation with @derive():
 * - Eq — equality checking
 * - Ord — comparison and sorting
 * - Clone — deep copying
 * - Debug — debug string representation
 * - Json — JSON serialization/deserialization
 * - Builder — fluent builder pattern
 */

import { derive } from "@ttfx/derive";

console.log("=== Derive Macro Example ===\n");

// --- Basic Derivations ---

@derive(Eq, Clone, Debug)
class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}

console.log("--- Point with Eq, Clone, Debug ---");

const p1 = new Point(1, 2);
const p2 = new Point(1, 2);
const p3 = new Point(3, 4);

console.log("p1:", p1.debug());
console.log("p2:", p2.debug());
console.log("p1.equals(p2):", p1.equals(p2));
console.log("p1.equals(p3):", p1.equals(p3));

const p1Clone = p1.clone();
console.log("p1.clone():", p1Clone.debug());

// --- Ord Derivation ---

@derive(Eq, Ord)
class Version {
  constructor(
    public major: number,
    public minor: number,
    public patch: number,
  ) {}
}

console.log("\n--- Version with Ord ---");

const versions = [
  new Version(2, 0, 0),
  new Version(1, 5, 3),
  new Version(1, 5, 0),
  new Version(3, 0, 0),
  new Version(1, 10, 0),
];

const sorted = versions.slice().sort((a, b) => a.compare(b));
console.log("Sorted versions:");
sorted.forEach((v) => console.log(`  ${v.major}.${v.minor}.${v.patch}`));

// --- Json Derivation ---

@derive(Json)
class User {
  constructor(
    public id: number,
    public name: string,
    public email: string,
    public active: boolean = true,
  ) {}
}

console.log("\n--- User with Json ---");

const user = new User(1, "Alice", "alice@example.com");
const json = user.toJson();
console.log("toJson():", json);

const parsed = User.fromJson(json);
console.log("fromJson():", parsed);

// --- Builder Derivation ---

@derive(Builder)
class Config {
  host: string = "localhost";
  port: number = 8080;
  secure: boolean = false;
  timeout: number = 30000;
}

console.log("\n--- Config with Builder ---");

const config = Config.builder()
  .host("api.example.com")
  .port(443)
  .secure(true)
  .timeout(60000)
  .build();

console.log("Built config:", config);

// --- Default Derivation ---

@derive(Default)
class Settings {
  theme: string = "dark";
  fontSize: number = 14;
  notifications: boolean = true;
}

console.log("\n--- Settings with Default ---");

const defaultSettings = Settings.default();
console.log("Default settings:", defaultSettings);

// --- TypeGuard Derivation ---

@derive(TypeGuard)
class ApiResponse {
  success: boolean;
  data: unknown;
  error?: string;
}

console.log("\n--- ApiResponse with TypeGuard ---");

const validResponse = { success: true, data: { id: 1 } };
const invalidResponse = { success: "true", data: null }; // success should be boolean

console.log("Is valid ApiResponse?", ApiResponse.isApiResponse(validResponse));
console.log(
  "Is invalid ApiResponse?",
  ApiResponse.isApiResponse(invalidResponse),
);

// --- Hash Derivation ---

@derive(Hash, Eq)
class CacheKey {
  constructor(
    public namespace: string,
    public id: number,
  ) {}
}

console.log("\n--- CacheKey with Hash ---");

const key1 = new CacheKey("users", 42);
const key2 = new CacheKey("users", 42);
const key3 = new CacheKey("posts", 42);

console.log("key1.hash():", key1.hash());
console.log("key2.hash():", key2.hash());
console.log("key3.hash():", key3.hash());
console.log("key1.hash() === key2.hash():", key1.hash() === key2.hash());
