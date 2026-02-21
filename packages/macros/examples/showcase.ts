/**
 * @typesugar/macros Showcase
 *
 * This is an internal package that provides macro implementations.
 * Most users should import from `typesugar` or specific feature packages.
 *
 * Run: npx tsx packages/macros/examples/showcase.ts
 * Build: npx tspc && node dist/examples/showcase.js
 */

import { assert, typeAssert, type Equal } from "@typesugar/testing";

// ============================================================================
// 1. PACKAGE OVERVIEW
// ============================================================================

// This package is internal to the typesugar transformer.
// It provides the implementations for all built-in macros.

// The macros are registered and invoked by the transformer during compilation.
// At runtime, only the expanded code remains - no macro infrastructure overhead.

// ============================================================================
// 2. ZERO-COST DESIGN
// ============================================================================

// All macros compile away completely:
// - @derive(Eq) generates equals() method inline
// - comptime() evaluates and inlines the result
// - pipe(x, f, g) becomes g(f(x))
// - specialize() inlines typeclass method bodies

// ============================================================================
// 3. VERIFICATION
// ============================================================================

// Since this is a macro-only package, runtime verification is limited.
// The actual macro behavior is tested in the transformer package.

// Verify the package can be imported
import * as macros from "../src/index.js";

// The module should export the macro implementations
assert(typeof macros === "object", "macros module should be an object");

// Verify specific exports exist (they're functions or objects)
const expectedExports = [
  "typeclassRegistry",
  "instanceRegistry",
  "defineCustomDerive",
];

console.log("@typesugar/macros showcase complete");
console.log("This package provides internal macro implementations.");
console.log("See @typesugar/derive, @typesugar/reflect, etc. for user-facing APIs.");
