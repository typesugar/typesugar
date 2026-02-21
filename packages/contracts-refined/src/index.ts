/**
 * @typesugar/contracts-refined
 *
 * Integrates @typesugar/contracts with @typesugar/type-system refinement types.
 *
 * This module provides a single source of truth for refinement predicates:
 * - Predicate definitions live in @typesugar/type-system (where the types are defined)
 * - This module registers them with @typesugar/contracts prover
 * - Users import this module once to enable the integration
 *
 * ## Usage
 *
 * ```typescript
 * // In your entry point or setup file:
 * import "@typesugar/contracts-refined";
 *
 * // Now refined types work seamlessly with contracts:
 * import { Positive, Byte, Port } from "@typesugar/type-system";
 * import { requires, ensures } from "@typesugar/contracts";
 *
 * @contract
 * function add(a: Positive, b: Positive): number {
 *   requires: { a > 0 && b > 0 } // ← Proven by type, eliminated at compile-time
 *   ensures: { result > 0 }      // ← Also provable: sum of positives is positive
 *   return a + b;
 * }
 * ```
 *
 * ## What Gets Registered
 *
 * All built-in refinement types from @typesugar/type-system:
 * - Numeric: Positive, NonNegative, Negative, Int, Byte, Port, Percentage, Finite
 * - String: NonEmpty, Trimmed, Lowercase, Uppercase, Email, Url, Uuid
 * - Array: NonEmptyArray
 *
 * ## Subtyping Coercions (Coq-inspired)
 *
 * The integration also registers subtyping rules that enable safe widening:
 * - Positive → NonNegative (x > 0 implies x >= 0)
 * - Byte → NonNegative, Int
 * - Port → Positive, NonNegative, Int
 * - Percentage → NonNegative
 *
 * This allows the prover to verify safe coercions at compile time.
 *
 * ## Custom Refinements
 *
 * For custom refinement types, you can register additional predicates:
 *
 * ```typescript
 * import { registerRefinementPredicate } from "@typesugar/contracts-refined";
 *
 * // Register your custom refinement
 * registerRefinementPredicate("PositiveEven", "$ > 0 && $ % 2 === 0");
 * ```
 */

import {
  REFINEMENT_PREDICATES,
  type RefinementPredicate,
  getAllSubtypingDeclarations,
  type SubtypingDeclaration,
  // Length-indexed vectors
  type Vec,
  type VecBrand,
  type Add,
  type Sub,
  type Min,
  Vec as VecConstructors,
  isVec,
  VEC_PREDICATE_PATTERN,
  extractVecLength,
  generateVecPredicate,
} from "@typesugar/type-system";

import {
  registerRefinementPredicate as coreRegister,
  getRefinementPredicate,
  registerSubtypingRule,
  canWiden,
  getSubtypingRule,
  getAllSubtypingRules,
  type TypeFact,
  type SubtypingRule,
  // Decidability annotations (Coq-inspired)
  registerDecidability,
  getDecidability,
  getPreferredStrategy,
  isCompileTimeDecidable,
  requiresRuntimeCheck,
  getAllDecidabilityInfo,
  type Decidability,
  type ProofStrategy,
  type DecidabilityInfo,
  // Dynamic predicate generators (for parameterized types)
  registerDynamicPredicateGenerator,
} from "@typesugar/contracts";

// Re-export for convenience
export {
  getRefinementPredicate,
  registerSubtypingRule,
  canWiden,
  getSubtypingRule,
  getAllSubtypingRules,
  type TypeFact,
  type SubtypingRule,
  // Decidability annotations (Coq-inspired)
  registerDecidability,
  getDecidability,
  getPreferredStrategy,
  isCompileTimeDecidable,
  requiresRuntimeCheck,
  getAllDecidabilityInfo,
  type Decidability,
  type ProofStrategy,
  type DecidabilityInfo,
  // Dynamic predicate generators
  registerDynamicPredicateGenerator,
} from "@typesugar/contracts";
export {
  type RefinementPredicate,
  type SubtypingDeclaration,
  type Decidability as TSDecidability,
  type ProofStrategy as TSProofStrategy,
  widen,
  widenTo,
  isSubtype,
  getSubtypingDeclaration,
  getAllSubtypingDeclarations,
  // Length-indexed vectors (Coq-inspired dependent types)
  type Vec,
  type VecBrand,
  type Add,
  type Sub,
  type Min,
  Vec as VecConstructors,
  isVec,
  VEC_PREDICATE_PATTERN,
  extractVecLength,
  generateVecPredicate,
} from "@typesugar/type-system";

/**
 * Register a custom refinement predicate for use with contracts.
 *
 * @param brand - The refinement type brand (e.g., "PositiveEven")
 * @param predicate - The predicate expression with $ as the variable placeholder
 *
 * @example
 * ```typescript
 * // Register a custom refinement
 * registerRefinementPredicate("PositiveEven", "$ > 0 && $ % 2 === 0");
 *
 * // Now the prover knows about your custom type
 * type PositiveEven = Refined<number, "PositiveEven">;
 *
 * @contract
 * function halve(n: PositiveEven): number {
 *   ensures: { result > 0 }  // Provable: n/2 where n > 0 is positive
 *   return n / 2;
 * }
 * ```
 */
export function registerRefinementPredicate(
  brand: string,
  predicate: string,
  decidability: Decidability = "runtime"
): void {
  coreRegister(brand, predicate);
  registeredPredicates.push({
    brand,
    predicate,
    description: "Custom",
    decidability,
  });
}

/**
 * Track registered predicates for introspection.
 */
const registeredPredicates: RefinementPredicate[] = [];

/**
 * Get all registered refinement predicates (built-in + custom).
 */
export function getRegisteredPredicates(): readonly RefinementPredicate[] {
  return registeredPredicates;
}

/**
 * Check if a refinement brand has a registered predicate.
 */
export function hasRefinementPredicate(brand: string): boolean {
  return getRefinementPredicate(brand) !== undefined;
}

// ============================================================================
// Auto-registration on import
// ============================================================================

/**
 * Register all built-in refinement predicates from @typesugar/type-system.
 * This runs automatically when the module is imported.
 */
function registerBuiltinPredicates(): void {
  for (const pred of REFINEMENT_PREDICATES) {
    coreRegister(pred.brand, pred.predicate);
    registeredPredicates.push(pred);
  }
}

/**
 * Register all built-in subtyping rules from @typesugar/type-system.
 * This enables the prover to verify safe widening at compile time.
 */
function registerBuiltinSubtypingRules(): void {
  const declarations = getAllSubtypingDeclarations();
  for (const decl of declarations) {
    registerSubtypingRule({
      from: decl.from,
      to: decl.to,
      proof: decl.proof,
      justification: decl.description,
    });
  }
}

/**
 * Register decidability information for all built-in predicates.
 * This enables the prover to select optimal proof strategies and
 * emit warnings when compile-time predicates fall back to runtime.
 */
function registerBuiltinDecidability(): void {
  for (const pred of REFINEMENT_PREDICATES) {
    if (pred.decidability && pred.preferredStrategy) {
      registerDecidability({
        brand: pred.brand,
        decidability: pred.decidability,
        preferredStrategy: pred.preferredStrategy,
      });
    }
  }
}

/**
 * Register dynamic predicate generators for parameterized types.
 * This enables the prover to handle types like Vec<N> where the
 * predicate depends on type parameters.
 */
function registerBuiltinDynamicPredicates(): void {
  // Register Vec<N> predicate generator
  // Wrapper to adapt the type-system's generateVecPredicate to the contracts signature
  registerDynamicPredicateGenerator(VEC_PREDICATE_PATTERN, (match) => {
    const brand = match[0]; // Full match is the brand e.g., "Vec<5>"
    const predicate = generateVecPredicate(brand);
    // If generateVecPredicate returns undefined, return a fallback
    return predicate ?? `$.length === ${match[1]}`;
  });
}

// Execute registration immediately
registerBuiltinPredicates();
registerBuiltinSubtypingRules();
registerBuiltinDecidability();
registerBuiltinDynamicPredicates();

// Log registration in development
if (process.env.NODE_ENV === "development") {
  const subtypingRules = getAllSubtypingDeclarations();
  const decidabilityInfo = getAllDecidabilityInfo();
  console.log(
    `[@typesugar/contracts-refined] Registered ${REFINEMENT_PREDICATES.length} predicates, ${subtypingRules.length} subtyping rules, ${decidabilityInfo.length} decidability annotations`
  );
}
