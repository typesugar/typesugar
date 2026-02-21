/**
 * @typesugar/contracts-z3 Showcase
 *
 * Self-documenting examples of Z3 SMT solver integration with
 * @typesugar/contracts. Z3 extends the prover's capabilities to
 * handle complex arithmetic, logical formulas, and non-linear
 * constraints that the built-in prover cannot decide.
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

import {
  z3ProverPlugin,
  proveWithZ3Async,
  type Z3PluginOptions,
  type Z3ProverPlugin,
  type ProofResult,
  type TypeFact,
  type ProverPlugin,
} from "../src/index.js";

// ============================================================================
// 1. PLUGIN CREATION - Configure the Z3 Prover
// ============================================================================

// Create a Z3 plugin with default settings
const defaultPlugin = z3ProverPlugin();
assert(defaultPlugin.name === "z3");
assert(defaultPlugin.isReady() === false); // Lazy init by default

// Create with custom timeout
const fastPlugin = z3ProverPlugin({ timeout: 500 });
assert(fastPlugin.name === "z3");

// Create with eager initialization
const eagerPlugin = z3ProverPlugin({ eagerInit: true, timeout: 2000 });
assert(eagerPlugin.name === "z3");

// Plugin satisfies the ProverPlugin interface from @typesugar/contracts
typeAssert<Extends<Z3ProverPlugin, ProverPlugin>>();

console.log("1. Plugin creation: default, custom timeout, eager init");

// ============================================================================
// 2. PROOF TYPES - Understanding Proof Results
// ============================================================================

// ProofResult carries the outcome of a proof attempt
const provenResult: ProofResult = {
  proven: true,
  method: "plugin",
  reason: "Z3: negation is unsatisfiable",
};
assert(provenResult.proven === true);
assert(provenResult.method === "plugin");

const unprovenResult: ProofResult = {
  proven: false,
  reason: "Z3: sat",
};
assert(unprovenResult.proven === false);

// TypeFact carries information about variables
const facts: TypeFact[] = [
  { variable: "x", predicate: "x > 0" },
  { variable: "y", predicate: "y >= 0" },
];
assert(facts.length === 2);
assert(facts[0].variable === "x");

console.log("2. Proof types: ProofResult and TypeFact structures");

// ============================================================================
// 3. SIMPLE PROOFS - Linear Arithmetic
// ============================================================================
//
// NOTE: The following examples use proveWithZ3Async which requires the z3-solver
// WASM module. They are written as async demonstrations. If z3-solver is not
// installed, the proofs will return { proven: false, reason: "Z3 initialization failed" }.

async function demonstrateLinearProofs(): Promise<void> {
  // Prove: x + y > 0, given x > 0 and y >= 0
  const sumResult = await proveWithZ3Async("x + y > 0", [
    { variable: "x", predicate: "x > 0" },
    { variable: "y", predicate: "y >= 0" },
  ]);
  console.log("  x > 0, y >= 0 ⊢ x + y > 0:", sumResult.proven ? "PROVEN" : "unproven");

  // Prove: x >= 0, given x > 5
  const lowerBound = await proveWithZ3Async("x >= 0", [
    { variable: "x", predicate: "x > 5" },
  ]);
  console.log("  x > 5 ⊢ x >= 0:", lowerBound.proven ? "PROVEN" : "unproven");

  // Attempt to prove something false
  const falseGoal = await proveWithZ3Async("x < 0", [
    { variable: "x", predicate: "x > 0" },
  ]);
  console.log("  x > 0 ⊢ x < 0:", falseGoal.proven ? "PROVEN" : "correctly unproven");
}

console.log("3. Linear proofs (async):");
await demonstrateLinearProofs().catch(() => {
  console.log("  (z3-solver not available — skipping async proofs)");
});

// ============================================================================
// 4. COMPLEX PROOFS - Non-Linear and Multi-Variable
// ============================================================================

async function demonstrateComplexProofs(): Promise<void> {
  // Prove: x² + 1 > 0 for all x (always true for reals)
  const squarePlus1 = await proveWithZ3Async("x * x + 1 > 0", []);
  console.log("  ⊢ x² + 1 > 0:", squarePlus1.proven ? "PROVEN" : "unproven");

  // Prove: (x + y)² >= 0 (square is always non-negative)
  const squareNonNeg = await proveWithZ3Async("(x + y) * (x + y) >= 0", []);
  console.log("  ⊢ (x+y)² >= 0:", squareNonNeg.proven ? "PROVEN" : "unproven");

  // Prove transitivity: a > b, b > c ⊢ a > c
  const transitivity = await proveWithZ3Async("a > c", [
    { variable: "a", predicate: "a > b" },
    { variable: "b", predicate: "b > c" },
  ]);
  console.log("  a > b, b > c ⊢ a > c:", transitivity.proven ? "PROVEN" : "unproven");

  // Prove: array bounds — index is valid
  const bounds = await proveWithZ3Async("i >= 0 && i < n", [
    { variable: "i", predicate: "i >= 0" },
    { variable: "i", predicate: "i < n" },
    { variable: "n", predicate: "n > 0" },
  ]);
  console.log("  i >= 0, i < n, n > 0 ⊢ 0 <= i < n:", bounds.proven ? "PROVEN" : "unproven");
}

console.log("4. Complex proofs (async):");
await demonstrateComplexProofs().catch(() => {
  console.log("  (z3-solver not available — skipping async proofs)");
});

// ============================================================================
// 5. PLUGIN LIFECYCLE - Init, Ready, and Error Handling
// ============================================================================

// Lazy initialization — plugin starts uninitialized
const lazyPlugin = z3ProverPlugin({ timeout: 1000 });
assert(lazyPlugin.isReady() === false);

// Calling prove() auto-initializes
async function demonstrateLifecycle(): Promise<void> {
  const plugin = z3ProverPlugin({ timeout: 1000 });

  // Pre-initialize for faster first proof
  await plugin.init();
  assert(plugin.isReady() === true);

  // Now proofs are fast (no init delay)
  const result = await plugin.prove("x > 0", [
    { variable: "x", predicate: "x > 0" },
  ]);
  console.log("  After init, prove x > 0:", result.proven ? "PROVEN" : "unproven");
}

console.log("5. Plugin lifecycle:");
await demonstrateLifecycle().catch(() => {
  console.log("  (z3-solver not available — skipping lifecycle demo)");
});

// ============================================================================
// 6. INTEGRATION WITH CONTRACTS - Register as Prover Plugin
// ============================================================================

// In a real setup, register the Z3 plugin with the contracts system:
//
//   import { registerProverPlugin } from "@typesugar/contracts";
//   import { z3ProverPlugin } from "@typesugar/contracts-z3";
//
//   // Option 1: Lazy init (first proof may be slower)
//   registerProverPlugin(z3ProverPlugin({ timeout: 2000 }));
//
//   // Option 2: Pre-initialize
//   const z3 = z3ProverPlugin({ timeout: 2000 });
//   await z3.init();
//   registerProverPlugin(z3);
//
// After registration, the proof engine uses Z3 as a fallback when
// constant evaluation, type deduction, algebraic rules, and linear
// arithmetic all fail.

// Plugin options are configurable
const opts: Z3PluginOptions = {
  timeout: 2000,
  eagerInit: false,
};
const configuredPlugin = z3ProverPlugin(opts);
assert(configuredPlugin.name === "z3");

console.log("6. Integration: register with @typesugar/contracts via registerProverPlugin()");

// ============================================================================
// 7. PROOF STRATEGY - When Z3 Helps
// ============================================================================

// The built-in prover handles:
//   - Constant evaluation (true, 5 > 3)
//   - Type deduction (Positive → > 0)
//   - Algebraic rules (sum of positives)
//   - Linear arithmetic (Fourier-Motzkin)
//
// Z3 extends this to handle:
//   - Non-linear arithmetic (x² + 1 > 0)
//   - Complex logical formulas
//   - Quantified statements
//   - Multi-variable constraints
//   - Array bounds reasoning
//
// Z3's proof method: assert facts, negate the goal.
// If Z3 returns UNSAT → the negation is impossible → the goal is proven.
// If Z3 returns SAT → counterexample exists → goal not provable.

// The predicate parser supports:
//   - Arithmetic: +, -, *, /, %
//   - Comparisons: >, >=, <, <=, ===, !==
//   - Logical: &&, ||, !
//   - Parentheses
//   - Property access: obj.prop → obj_prop
//   - Integer and float literals
//   - Boolean literals

console.log("7. Proof strategy: Z3 handles non-linear, complex, quantified formulas");

// ============================================================================
// SUMMARY
// ============================================================================

console.log("\n=== @typesugar/contracts-z3 Showcase Complete ===");
console.log(`
Features demonstrated:
  1. Plugin creation with configurable timeout and init strategy
  2. ProofResult and TypeFact data structures
  3. Linear arithmetic proofs (x + y > 0 from x > 0, y >= 0)
  4. Non-linear proofs (x² + 1 > 0, transitivity, bounds)
  5. Plugin lifecycle (lazy init, pre-init, isReady)
  6. Integration with @typesugar/contracts via registerProverPlugin
  7. Proof strategy (when Z3 adds value over built-in prover)

How it works:
  1. Assert type facts as Z3 constraints
  2. Assert the NEGATION of the goal
  3. If UNSAT → goal is proven (negation impossible)
  4. If SAT → goal is not provable (counterexample exists)
`);
