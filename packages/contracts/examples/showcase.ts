/**
 * @typesugar/contracts Showcase
 *
 * Self-documenting examples of Design by Contract for TypeScript:
 * preconditions, postconditions, class invariants, the proof engine,
 * linear arithmetic, proof certificates, and production stripping.
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
  // Runtime contract functions
  requires,
  ensures,
  old,

  // Configuration
  type ContractConfig,
  setContractConfig,
  getContractConfig,
  shouldEmitCheck,

  // Prover
  type ProofResult,
  type TypeFact,
  tryProve,

  // Algebraic rules
  tryAlgebraicProof,
  registerAlgebraicRule,

  // Linear arithmetic
  tryLinearArithmetic,
  trySimpleLinearProof,

  // Proof certificates
  type ProofCertificate,
  createCertificate,
  succeedCertificate,
  failCertificate,
  addStep,
  formatCertificate,
  certificateToResult,

  // Runtime errors
  ContractError,
  PreconditionError,
  PostconditionError,
  InvariantError,

  // Decidability
  registerDecidability,
  getDecidability,
  canProveAtCompileTime,
  mustCheckAtRuntime,

  // Laws verification
  defineLaw,
  verifyLaw,
  type Law,
} from "../src/index.js";

// ============================================================================
// 1. BASIC PRECONDITIONS - requires() Guards Function Entry
// ============================================================================

function divide(a: number, b: number): number {
  requires(b !== 0, "Division by zero");
  return a / b;
}

assert(divide(10, 2) === 5);
assert(divide(-6, 3) === -2);

// Violating a precondition throws PreconditionError
let caught = false;
try {
  divide(1, 0);
} catch (e) {
  caught = e instanceof PreconditionError;
}
assert(caught);

console.log("1. Basic preconditions: requires() guards function entry");

// ============================================================================
// 2. POSTCONDITIONS - ensures() Verifies Function Output
// ============================================================================

function clamp(value: number, min: number, max: number): number {
  requires(min <= max, "min must be <= max");
  const result = Math.max(min, Math.min(max, value));
  ensures(result >= min && result <= max, "Result must be in range");
  return result;
}

assert(clamp(5, 0, 10) === 5);
assert(clamp(-5, 0, 10) === 0);
assert(clamp(15, 0, 10) === 10);

console.log("2. Postconditions: ensures() verifies output is in range");

// ============================================================================
// 3. OLD() CAPTURES - Snapshot Pre-Call State for Postconditions
// ============================================================================

interface Counter {
  value: number;
}

function increment(counter: Counter): void {
  const oldValue = old(counter.value);
  counter.value++;
  ensures(counter.value === oldValue + 1, "Value must increase by 1");
}

const counter = { value: 10 };
increment(counter);
assert(counter.value === 11);
increment(counter);
assert(counter.value === 12);

console.log("3. old() captures: snapshot pre-call state for postconditions");

// ============================================================================
// 4. CONTRACT ERRORS - Typed Error Hierarchy
// ============================================================================

// ContractError is the base class
typeAssert<Extends<PreconditionError, ContractError>>();
typeAssert<Extends<PostconditionError, ContractError>>();
typeAssert<Extends<InvariantError, ContractError>>();

// Each error type carries contextual information
const precErr = new PreconditionError("x > 0");
assert(precErr instanceof ContractError);
assert(precErr instanceof PreconditionError);
assert(precErr.message.includes("x > 0"));

const postErr = new PostconditionError("result >= 0");
assert(postErr instanceof PostconditionError);

const invErr = new InvariantError("balance >= 0");
assert(invErr instanceof InvariantError);

console.log("4. Contract errors: PreconditionError, PostconditionError, InvariantError");

// ============================================================================
// 5. PROOF ENGINE - Compile-Time Contract Verification
// ============================================================================

// The prover attempts to verify conditions statically

// Constant evaluation — trivially true
const constResult = tryProve("true", []);
assert(constResult.proven === true);

// Type deduction — extract facts from refined types
const typeFacts: TypeFact[] = [
  { variable: "x", predicate: "$ > 0" },
];
const typeResult = tryProve("x > 0", typeFacts);
assert(typeResult.proven === true);

// Can't prove without supporting facts
const unprovable = tryProve("x > 1000", typeFacts);
assert(unprovable.proven === false);

console.log("5. Proof engine: constant eval, type deduction, algebraic rules");

// ============================================================================
// 6. ALGEBRAIC RULES - Domain-Specific Proof Extensions
// ============================================================================

// Register a custom algebraic rule
registerAlgebraicRule({
  name: "even_plus_even_is_even",
  description: "Sum of two even numbers is even",
  match(goal, facts) {
    const m = goal.match(/^(\w+)\s*\+\s*(\w+)\s+is\s+even$/);
    if (!m) return false;
    return facts.some((f) => f.variable === m[1] && f.predicate.includes("even"))
        && facts.some((f) => f.variable === m[2] && f.predicate.includes("even"));
  },
});

// Built-in rules handle common patterns
const sumPosFacts: TypeFact[] = [
  { variable: "a", predicate: "$ > 0" },
  { variable: "b", predicate: "$ > 0" },
];
const algebraResult = tryAlgebraicProof("a + b > 0", sumPosFacts);
// May or may not prove depending on registered rules

console.log("6. Algebraic rules: custom domain-specific proof extensions");

// ============================================================================
// 7. LINEAR ARITHMETIC SOLVER - Fourier-Motzkin Elimination
// ============================================================================

// Prove linear inequalities from known facts
const linearFacts: TypeFact[] = [
  { variable: "x", predicate: "x > 0" },
  { variable: "y", predicate: "y >= 0" },
];

const sumProof = trySimpleLinearProof("x + y >= 0", linearFacts);
assert(sumProof.proven === true);

// Transitivity: a > b, b > c implies a > c
const transFacts: TypeFact[] = [
  { variable: "a", predicate: "a > b" },
  { variable: "b", predicate: "b > c" },
];
const transProof = trySimpleLinearProof("a > c", transFacts);
assert(transProof.proven === true);

// Can't prove unrelated facts
const unrelated: TypeFact[] = [
  { variable: "x", predicate: "x > 0" },
];
const unrelatedProof = trySimpleLinearProof("y > 0", unrelated);
assert(unrelatedProof.proven === false);

console.log("7. Linear arithmetic: Fourier-Motzkin proves x+y>=0, transitivity");

// ============================================================================
// 8. PROOF CERTIFICATES - Auditable Proof Traces
// ============================================================================

// Create a certificate to track a proof attempt
const assumptions: TypeFact[] = [
  { variable: "amount", predicate: "amount: Positive" },
];
let cert: ProofCertificate = createCertificate("amount > 0", assumptions);

// Add a proof step
cert = addStep(cert, {
  rule: "type_identity",
  description: "Extract type fact from Positive",
  justification: "amount: Positive implies amount > 0",
  usedFacts: assumptions,
  subgoals: [],
});

// Mark the proof as successful
cert = succeedCertificate(cert, "type", {
  rule: "type_identity",
  description: "Proven by type deduction",
});

// Format for human reading
const formatted = formatCertificate(cert);
assert(typeof formatted === "string");
assert(formatted.includes("amount > 0"));

// Convert certificate to ProofResult
const certResult = certificateToResult(cert);
assert(certResult.proven === true);
assert(certResult.method === "type");

// Failed certificates also produce results
let failedCert = createCertificate("x > 1000", [
  { variable: "x", predicate: "x: Positive" },
]);
failedCert = failCertificate(failedCert, "Positive only guarantees x > 0");
const failedResult = certificateToResult(failedCert);
assert(failedResult.proven === false);

console.log("8. Proof certificates: auditable traces with steps and outcomes");

// ============================================================================
// 9. DECIDABILITY ANNOTATIONS - Control Proof Strategy
// ============================================================================

// Register decidability metadata for custom brands
registerDecidability({
  brand: "CompileTimeConst",
  predicate: "$ === 42",
  decidability: "compile-time",
  preferredStrategy: "constant",
});

registerDecidability({
  brand: "RuntimeOnly",
  predicate: "validateExternal($)",
  decidability: "runtime",
});

registerDecidability({
  brand: "SMTNeeded",
  predicate: "$ * $ + 1 > 0",
  decidability: "decidable",
  preferredStrategy: "z3",
});

// Query decidability
const ctInfo = getDecidability("CompileTimeConst");
assert(ctInfo !== undefined);
assert(ctInfo!.decidability === "compile-time");
assert(canProveAtCompileTime(ctInfo!.decidability) === true);

const rtInfo = getDecidability("RuntimeOnly");
assert(rtInfo !== undefined);
assert(mustCheckAtRuntime(rtInfo!.decidability) === true);

console.log("9. Decidability annotations: compile-time, runtime, decidable (SMT)");

// ============================================================================
// 10. CONTRACT CONFIGURATION - Production Stripping
// ============================================================================

// Save current config
const originalConfig = getContractConfig();

// "full" mode — all checks emitted (development)
setContractConfig({ mode: "full" });
assert(shouldEmitCheck("precondition") === true);
assert(shouldEmitCheck("postcondition") === true);
assert(shouldEmitCheck("invariant") === true);

// "assertions" mode — only invariants (staging)
setContractConfig({ mode: "assertions" });
assert(shouldEmitCheck("precondition") === false);
assert(shouldEmitCheck("postcondition") === false);
assert(shouldEmitCheck("invariant") === true);

// "none" mode — all stripped (production)
setContractConfig({ mode: "none" });
assert(shouldEmitCheck("precondition") === false);
assert(shouldEmitCheck("postcondition") === false);
assert(shouldEmitCheck("invariant") === false);

// Restore original config
setContractConfig(originalConfig);

console.log("10. Configuration: full/assertions/none modes for production stripping");

// ============================================================================
// 11. LAWS VERIFICATION - Property-Based Contract Testing
// ============================================================================

// Define a law for a hypothetical Monoid
// Laws use `check` function that takes arguments based on `arity`
const identityLaw: Law = defineLaw({
  name: "left_identity",
  description: "empty <> x === x",
  arity: 1,
  check: (x: number) => 0 + x === x,
});

// Verify the law - verifyLaw checks with algebraic prover first
// Pass empty facts array when no type-level facts are available
const lawResult = verifyLaw(identityLaw, []);

// lawResult.status is "proven", "disproven", or "undecidable"
// For this simple identity law, algebraic prover may not prove it statically
// but the law itself holds for all numbers
assert(lawResult.status === "proven" || lawResult.status === "undecidable");

console.log("11. Laws verification: property-based testing for algebraic laws");

// ============================================================================
// 12. REAL-WORLD EXAMPLE - Binary Search with Contracts
// ============================================================================

function binarySearch(arr: readonly number[], target: number): number {
  requires(isSorted(arr), "Array must be sorted");

  let left = 0;
  let right = arr.length - 1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    requires(mid >= left && mid <= right, "mid must be in bounds");

    if (arr[mid] === target) return mid;
    if (arr[mid] < target) left = mid + 1;
    else right = mid - 1;
  }

  return -1;
}

function isSorted(arr: readonly number[]): boolean {
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] < arr[i - 1]) return false;
  }
  return true;
}

const sortedArr = [1, 3, 5, 7, 9, 11, 13];
assert(binarySearch(sortedArr, 7) === 3);
assert(binarySearch(sortedArr, 1) === 0);
assert(binarySearch(sortedArr, 13) === 6);
assert(binarySearch(sortedArr, 4) === -1);

console.log("12. Real-world: binary search with sorted-array precondition");

// ============================================================================
// SUMMARY
// ============================================================================

console.log("\n=== @typesugar/contracts Showcase Complete ===");
console.log(`
Features demonstrated:
  1. requires() — precondition guards
  2. ensures() — postcondition verification
  3. old() — pre-call state snapshots
  4. Typed error hierarchy (ContractError, Precondition, Postcondition, Invariant)
  5. Proof engine (constant eval, type deduction)
  6. Algebraic rules (custom domain-specific proofs)
  7. Linear arithmetic solver (Fourier-Motzkin)
  8. Proof certificates (auditable traces)
  9. Decidability annotations (proof strategy control)
 10. Contract configuration (full/assertions/none)
 11. Laws verification (property-based testing)
 12. Real-world binary search example
`);
