//! staticAssert
//! Compile-time assertions that vanish

import { staticAssert } from "typesugar";

// staticAssert() checks conditions at COMPILE TIME
// If true: the call is removed from output (zero runtime cost)
// If false: the BUILD fails with an error

// These assertions disappear from JS Output:
staticAssert(1 + 1 === 2, "basic math");
staticAssert("hello".length === 5, "string length");
staticAssert([1, 2, 3].includes(2), "array check");

// Useful for configuration validation
const MAX_RETRIES = 3;
const TIMEOUT_MS = 5000;
staticAssert(MAX_RETRIES > 0, "retries must be positive");
staticAssert(TIMEOUT_MS <= 30000, "timeout must be reasonable");

// This code runs - staticAssert calls are gone
console.log("Config validated at compile time!");
console.log("MAX_RETRIES:", MAX_RETRIES);
console.log("TIMEOUT_MS:", TIMEOUT_MS);

// Try changing a condition to false and see the error!
