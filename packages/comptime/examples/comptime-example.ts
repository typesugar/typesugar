/**
 * Comptime Macro Example
 *
 * Demonstrates compile-time expression evaluation — run JavaScript
 * during compilation and embed the results in your code.
 */

import { comptime } from "@typesugar/comptime";


console.log("=== Comptime Example ===\n");

// --- Basic Compile-Time Evaluation ---

console.log("--- Basic Evaluation ---");

// These are evaluated at compile time, not runtime!
const buildTime = comptime(new Date().toISOString());
console.log("Build time:", buildTime);

const randomAtBuild = comptime(Math.random());
console.log("Random (same every run):", randomAtBuild);

// --- Compile-Time Computation ---

console.log("\n--- Compile-Time Computation ---");

// Expensive computation done once at build time
const fibonaccis = comptime(() => {
  const fib = (n: number): number => (n <= 1 ? n : fib(n - 1) + fib(n - 2));
  return Array.from({ length: 20 }, (_, i) => fib(i));
});

console.log("First 20 Fibonacci numbers:", fibonaccis);

// Precomputed lookup table
const squares = comptime(Array.from({ length: 100 }, (_, i) => i * i));
console.log("Squares[10]:", squares[10]); // 100

// --- Build Configuration ---

console.log("\n--- Build Configuration ---");

const config = comptime({ env: "read" }, () => ({
  version: "1.0.0",
  buildNumber: Date.now(),
  features: ["auth", "logging", "cache"],
  isProd: process.env.NODE_ENV === "production",
}));

console.log("Config:", config);

// --- Template Generation ---

console.log("\n--- Template Generation ---");

// Generate code at compile time
const routes = comptime(() => {
  const endpoints = ["users", "posts", "comments"];
  return endpoints.map((e) => ({
    path: `/api/${e}`,
    name: e.charAt(0).toUpperCase() + e.slice(1),
  }));
});

console.log("Generated routes:");
routes.forEach((r) => console.log(`  ${r.name}: ${r.path}`));

// --- Environment at Build Time ---

console.log("\n--- Build Environment ---");

const nodeVersion = comptime(process.version);
const platform = comptime(process.platform);

console.log("Built with Node:", nodeVersion);
console.log("Built on platform:", platform);

// --- Precomputed Regex Patterns ---

console.log("\n--- Precomputed Patterns ---");

const patterns = comptime({
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.source,
  phone: /^\+?[1-9]\d{1,14}$/.source,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .source,
});

console.log("Precompiled regex patterns:");
Object.entries(patterns).forEach(([name, pattern]) => {
  console.log(`  ${name}: ${pattern}`);
});

// --- Compile-Time Type Data ---

console.log("\n--- Type Metadata ---");

// Read and process a schema from disk at compile time
const userSchema = comptime({ fs: "read" }, () => {
  const fs = require("fs");
  const raw = fs.readFileSync("./schemas/user.json", "utf-8");
  const schema = JSON.parse(raw);
  return {
    ...schema,
    requiredFields: schema.fields.filter((f: any) => f.required).map((f: any) => f.name),
    optionalFields: schema.fields.filter((f: any) => !f.required).map((f: any) => f.name),
    fieldTypes: Object.fromEntries(schema.fields.map((f: any) => [f.name, f.type])),
  };
});

console.log("User schema:", userSchema);
console.log("Required:", userSchema.requiredFields);
console.log("Optional:", userSchema.optionalFields);
