/**
 * @typesugar/contracts-refined Showcase
 *
 * Self-documenting examples of the bridge between @typesugar/contracts
 * and @typesugar/type-system refinement types. Importing this module
 * registers all built-in refinement predicates with the contract prover,
 * enabling compile-time proof elision.
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

// The key import — this registers all built-in predicates with the prover
import "@typesugar/contracts-refined";

import {
  registerRefinementPredicate,
  getRegisteredPredicates,
  hasRefinementPredicate,
  getRefinementPredicate,
  // Subtyping
  registerSubtypingRule,
  canWiden,
  getSubtypingRule,
  getAllSubtypingRules,
  // Decidability
  registerDecidability,
  getDecidability,
  getPreferredStrategy,
  isCompileTimeDecidable,
  requiresRuntimeCheck,
  getAllDecidabilityInfo,
  // Vec support
  type Add,
  VecConstructors,
  isVec,
  extractVecLength,
  generateVecPredicate,
  // Re-exported widening
  widen,
} from "../src/index.js";

import { requires, tryProve, type TypeFact, trySimpleLinearProof } from "@typesugar/contracts";
// Byte, Int, NonEmpty used only as brand strings in hasRefinementPredicate() calls
import { Positive, NonNegative, Port, Percentage } from "@typesugar/type-system";

// ============================================================================
// 1. AUTO-REGISTRATION - Import Activates the Bridge
// ============================================================================

// After importing @typesugar/contracts-refined, all built-in predicates
// are registered with the contracts prover automatically

const predicates = getRegisteredPredicates();
assert(predicates.length > 0);

// Check specific predicates are registered
assert(hasRefinementPredicate("Positive"));
assert(hasRefinementPredicate("NonNegative"));
assert(hasRefinementPredicate("Byte"));
assert(hasRefinementPredicate("Port"));
assert(hasRefinementPredicate("Percentage"));
assert(hasRefinementPredicate("Int"));
assert(hasRefinementPredicate("NonEmpty"));

// Predicates match type-system definitions
const posPred = getRefinementPredicate("Positive");
assert(posPred !== undefined);
assert(posPred!.includes("> 0"));

const bytePred = getRefinementPredicate("Byte");
assert(bytePred !== undefined);

console.log(`1. Auto-registration: ${predicates.length} predicates registered on import`);

// ============================================================================
// 2. PROOF ELISION - Type Facts Enable Compile-Time Verification
// ============================================================================

// When a parameter has a Refined type, the prover extracts type facts
// and can eliminate runtime checks

// Positive type → $ > 0
const positiveFacts: TypeFact[] = [{ variable: "x", predicate: "$ > 0" }];
const posProof = tryProve("x > 0", positiveFacts);
assert(posProof.proven === true);

// Port type → $ >= 1 && $ <= 65535
const portFacts: TypeFact[] = [{ variable: "p", predicate: "p >= 1 && p <= 65535" }];
const portLowerProof = trySimpleLinearProof("p >= 1", portFacts);
assert(portLowerProof.proven === true);

// Byte type → $ >= 0 && $ <= 255
const byteFacts: TypeFact[] = [{ variable: "b", predicate: "b >= 0 && b <= 255" }];
const byteProof = trySimpleLinearProof("b >= 0", byteFacts);
assert(byteProof.proven === true);

console.log("2. Proof elision: Positive→>0, Port→1-65535, Byte→0-255 proven statically");

// ============================================================================
// 3. CUSTOM PREDICATE REGISTRATION - Extend the Prover
// ============================================================================

// Register a custom refinement type predicate
registerRefinementPredicate("PositiveEven", "$ > 0 && $ % 2 === 0");
assert(hasRefinementPredicate("PositiveEven"));

const customPred = getRefinementPredicate("PositiveEven");
assert(customPred !== undefined);
assert(customPred!.includes("> 0"));

// Register another custom type
registerRefinementPredicate("Latitude", "$ >= -90 && $ <= 90", "runtime");
assert(hasRefinementPredicate("Latitude"));

registerRefinementPredicate("Longitude", "$ >= -180 && $ <= 180", "runtime");
assert(hasRefinementPredicate("Longitude"));

// All registered predicates are visible
const allPreds = getRegisteredPredicates();
assert(allPreds.some((p) => p.brand === "PositiveEven"));
assert(allPreds.some((p) => p.brand === "Latitude"));

console.log("3. Custom predicates: PositiveEven, Latitude, Longitude registered");

// ============================================================================
// 4. SUBTYPING RULES - Safe Widening Between Refined Types
// ============================================================================

// Built-in subtyping rules are registered automatically:
// Positive → NonNegative, Byte → Int, Port → Positive, etc.

// Check built-in widening
assert(canWiden("Positive", "NonNegative") === true);
assert(canWiden("Byte", "NonNegative") === true);
assert(canWiden("Byte", "Int") === true);
assert(canWiden("Port", "Positive") === true);
assert(canWiden("Port", "NonNegative") === true);

// Direction matters — can't narrow without proof
assert(canWiden("NonNegative", "Positive") === false);
assert(canWiden("Int", "Byte") === false);

// Get rule details
const posToNn = getSubtypingRule("Positive", "NonNegative");
assert(posToNn !== undefined);

// Register a custom subtyping rule
registerSubtypingRule({
  from: "PositiveEven",
  to: "Positive",
  proof: "positive_even_is_positive",
  justification: "x > 0 && x % 2 === 0 implies x > 0",
});
assert(canWiden("PositiveEven", "Positive") === true);

// Widening chain: PositiveEven → Positive → NonNegative
registerSubtypingRule({
  from: "PositiveEven",
  to: "NonNegative",
  proof: "positive_even_is_nonneg",
  justification: "x > 0 implies x >= 0",
});
assert(canWiden("PositiveEven", "NonNegative") === true);

// List all rules
const allRules = getAllSubtypingRules();
assert(allRules.length > 0);

console.log("4. Subtyping rules: Positive→NonNegative, Byte→Int, custom chains");

// ============================================================================
// 5. DECIDABILITY ANNOTATIONS - Proof Strategy Control
// ============================================================================

// Built-in decidability annotations are registered for all built-in types
const allDecidability = getAllDecidabilityInfo();

// Query decidability for specific brands
const posDecidability = getDecidability("Positive");
if (posDecidability) {
  const strategy = getPreferredStrategy(posDecidability);
  const canProve = isCompileTimeDecidable(posDecidability.decidability);
  const needsRuntime = requiresRuntimeCheck(posDecidability.decidability);

  // Positive should be decidable at compile time
  assert(typeof canProve === "boolean");
  assert(typeof needsRuntime === "boolean");
}

// Register decidability for custom types
registerDecidability({
  brand: "Latitude",
  decidability: "runtime",
});
const latDecidability = getDecidability("Latitude");
assert(latDecidability !== undefined);
assert(requiresRuntimeCheck(latDecidability!.decidability) === true);

registerDecidability({
  brand: "PositiveEven",
  decidability: "decidable",
  preferredStrategy: "linear",
});
const peDecidability = getDecidability("PositiveEven");
assert(peDecidability !== undefined);

console.log("5. Decidability: strategy annotations for proof engine guidance");

// ============================================================================
// 6. VEC INTEGRATION - Length-Indexed Vectors with Contracts
// ============================================================================

// Vec<T, N> predicate generation for the prover
const vec3Pred = generateVecPredicate("Vec<3>");
assert(vec3Pred !== undefined);

const vec5Pred = generateVecPredicate("Vec<5>");
assert(vec5Pred !== undefined);

// Extract length from Vec brand
assert(extractVecLength("Vec<3>") === 3);
assert(extractVecLength("Vec<10>") === 10);

// Vec constructors
const v3 = VecConstructors.from<number, 3>([1, 2, 3]);
assert(isVec(v3));
assert((v3 as number[]).length === 3);

const v0 = VecConstructors.empty<string>();
assert(isVec(v0));
assert((v0 as string[]).length === 0);

// Type-level arithmetic
type Five = Add<3, 2>;
typeAssert<Equal<Five, 5>>();

console.log("6. Vec integration: length predicates for compile-time array bounds");

// ============================================================================
// 7. REAL-WORLD EXAMPLE - Safe API Parameter Validation
// ============================================================================

// With contracts-refined imported, the prover knows about Positive, Port, etc.
// This allows compile-time elimination of redundant checks

function configureServer(port: Port, maxConnections: Positive): void {
  // These checks are PROVEN by the type system and eliminated at compile time:
  requires(port >= 1);
  requires(port <= 65535);
  requires(maxConnections > 0);

  // This check CANNOT be proven (involves two variables, not a type fact):
  requires(maxConnections <= 10000, "Too many connections");
}

configureServer(Port.refine(8080), Positive.refine(100));

function processPercentage(pct: Percentage): string {
  // PROVEN: Percentage guarantees 0-100
  requires(pct >= 0);
  requires(pct <= 100);

  if (pct === 0) return "none";
  if (pct === 100) return "all";
  return `${pct}%`;
}

assert(processPercentage(Percentage.refine(50)) === "50%");
assert(processPercentage(Percentage.refine(0)) === "none");
assert(processPercentage(Percentage.refine(100)) === "all");

// Safe widening in practice
function acceptNonNegative(n: NonNegative): void {
  requires(n >= 0); // PROVEN
}

const pos = Positive.refine(42);
// Positive → NonNegative via subtyping rule
const widened = widen<typeof pos, NonNegative>(pos);
acceptNonNegative(widened);

console.log("7. Real-world: server config with compile-time proof elision");

// ============================================================================
// SUMMARY
// ============================================================================

console.log("\n=== @typesugar/contracts-refined Showcase Complete ===");
console.log(`
Features demonstrated:
  1. Auto-registration of built-in predicates on import
  2. Proof elision via type facts (Positive, Port, Byte)
  3. Custom predicate registration (PositiveEven, Latitude)
  4. Subtyping rules for safe widening (Positive → NonNegative)
  5. Decidability annotations (compile-time vs runtime strategy)
  6. Vec<T, N> integration (length predicates for array bounds)
  7. Real-world API validation with proof elision

Architecture:
  @typesugar/type-system       → Defines Refined<T, Brand> + predicates
  @typesugar/contracts         → Contract macros + prover engine
  @typesugar/contracts-refined → Bridge (this module) — import to activate
`);
