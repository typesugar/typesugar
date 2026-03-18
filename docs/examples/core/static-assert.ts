//! staticAssert + comptime
//! Compile-time proofs that vanish from output

import { staticAssert, comptime } from "typesugar";

// staticAssert() checks conditions at COMPILE TIME.
// If true → the call is completely removed (zero runtime cost).
// If false → the BUILD fails with an error.

// Prove configuration invariants at compile time
const MAX_RETRIES = 3;
const TIMEOUT_MS = 5000;
const API_VERSION = "v2";

staticAssert(MAX_RETRIES > 0 && MAX_RETRIES <= 10, "retries out of range");
staticAssert(TIMEOUT_MS >= 1000, "timeout too short");
staticAssert(API_VERSION.startsWith("v"), "version must start with 'v'");

// Combine with comptime() — evaluate + assert at build time
const FEATURES = comptime(() => ["auth", "billing", "notifications"]);
staticAssert(FEATURES.length > 0, "must have at least one feature");
staticAssert(FEATURES.includes("auth"), "auth feature is required");

// Type-level assertions using typeof
staticAssert(typeof MAX_RETRIES === "number");
staticAssert(typeof API_VERSION === "string");

console.log("Config validated at compile time!");
console.log("retries:", MAX_RETRIES, "timeout:", TIMEOUT_MS);
console.log("features:", FEATURES);

// 👀 Check JS Output — every staticAssert line is gone!
//    comptime(() => [...]) is replaced with the literal array.
// Try: change MAX_RETRIES to 0 or -1 and see the compile error
