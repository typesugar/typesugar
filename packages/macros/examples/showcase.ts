/**
 * @typesugar/macros Showcase
 *
 * This is an internal package that provides macro implementations.
 * Most users should import from `typesugar` or specific feature packages.
 *
 * Run: npx tsx packages/macros/examples/showcase.ts
 * Build: npx tspc && node dist/examples/showcase.js
 */

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

// Note: We avoid importing from "../src/index.js" directly in this showcase
// because the macros module has complex TypeScript types that cause extremely
// slow compilation times (5+ minutes). The macro implementations are verified
// through the transformer package tests.

// Verify the runtime stubs are available (these are lightweight)
import { pipe, compose, comptime, typeInfo, cfg } from "../src/runtime-stubs.js";

// Basic sanity checks on the stub functions
console.log("Verifying runtime stubs exist:");

const stubs = [
  ["pipe", pipe],
  ["compose", compose],
  ["comptime", comptime],
  ["typeInfo", typeInfo],
  ["cfg", cfg],
] as const;

for (const [name, stub] of stubs) {
  if (typeof stub !== "function") {
    throw new Error(`Expected ${name} to be a function, got ${typeof stub}`);
  }
  console.log(`  ✓ ${name} is a function`);
}

// Test that pipe works at runtime (for development without transformer)
const addOne = (x: number) => x + 1;
const double = (x: number) => x * 2;
const result = pipe(5, addOne, double);
console.log(`  ✓ pipe(5, addOne, double) = ${result}`);
if (result !== 12) {
  throw new Error(`Expected pipe result to be 12, got ${result}`);
}

// Test compose
const composed = compose(double, addOne);
const composeResult = composed(5);
console.log(`  ✓ compose(double, addOne)(5) = ${composeResult}`);
if (composeResult !== 12) {
  throw new Error(`Expected compose result to be 12, got ${composeResult}`);
}

console.log("");
console.log("@typesugar/macros showcase complete");
console.log("This package provides internal macro implementations.");
console.log("See @typesugar/derive, @typesugar/reflect, etc. for user-facing APIs.");
