//! Power Assert & Static Assert
//! Sub-expression capture on failure + compile-time proofs

import { comptime, staticAssert, pipe } from "typesugar";

// @typesugar/testing's assert() captures every sub-expression on failure.
// staticAssert() proves invariants at BUILD time then vanishes from output.

const API_VERSION = "v3";
const MAX_RETRIES = 5;
const SUPPORTED = comptime(() => ["json", "xml", "csv"]);

// 👀 Check JS Output — all staticAssert lines are GONE!
staticAssert(API_VERSION.startsWith("v"), "version must start with 'v'");
staticAssert(MAX_RETRIES >= 1 && MAX_RETRIES <= 10, "retries must be 1-10");
staticAssert(SUPPORTED.length > 0, "need at least one format");
staticAssert(SUPPORTED.includes("json"), "json support required");

// pipe() inlines to nested calls
const formatList = pipe(SUPPORTED, a => a.map(s => s.toUpperCase()), a => a.join(", "));

console.log("api:", API_VERSION, "retries:", MAX_RETRIES);
console.log("formats:", formatList);  // "JSON, XML, CSV"

// Power assert failure output (when transformer is active):
//   assert(users.length === filtered.length)
//     users.length === filtered.length → false
//     users.length → 5
//     filtered.length → 3
// Every sub-expression captured — no more "expected true, got false"!

console.log("all compile-time assertions passed!");

// Try: change MAX_RETRIES to 0 and see the compile error
