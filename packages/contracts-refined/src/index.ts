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

// ============================================================================
// Feature: @validate integration
// ============================================================================

/**
 * Registry mapping refinement brands to validation rule functions.
 * Each entry maps a brand name to a predicate function that validates
 * a runtime value against the refinement constraint.
 */
const validationRules = new Map<string, (value: unknown) => boolean>();

/**
 * Register a refined type's predicate as a validation rule.
 *
 * Converts the predicate expression (using $ placeholder) into an
 * executable validation function. This bridges the refinement type
 * system with the @validate macro so that Refined<T, Brand> types
 * are automatically validated at runtime.
 *
 * @param brand - The refinement brand (e.g., "Port", "Positive")
 * @param predicateExpr - The predicate expression with $ as the value placeholder
 *
 * @example
 * ```typescript
 * registerValidationRule("EvenNumber", "$ % 2 === 0");
 * const check = getValidationRule("EvenNumber");
 * check(4);  // true
 * check(3);  // false
 * ```
 */
export function registerValidationRule(brand: string, predicateExpr: string): void {
  try {
    // Convert the $ placeholder predicate into a callable function
    // The predicate uses $ as the value placeholder, e.g., "$ > 0"
    const fnBody = predicateExpr.replace(/\$/g, "_val_");
    // eslint-disable-next-line no-new-func
    const fn = new Function("_val_", `return (${fnBody});`) as (value: unknown) => boolean;
    validationRules.set(brand, fn);
  } catch {
    // If the predicate expression is not valid JS (e.g., type-level only),
    // store a no-op validator that always returns true
    validationRules.set(brand, () => true);
  }
}

/**
 * Get the validation rule function for a refinement brand.
 *
 * @param brand - The refinement brand to look up
 * @returns The validation function, or undefined if no rule is registered
 */
export function getValidationRule(brand: string): ((value: unknown) => boolean) | undefined {
  return validationRules.get(brand);
}

/**
 * Check whether a validation rule is registered for a brand.
 */
export function hasValidationRule(brand: string): boolean {
  return validationRules.has(brand);
}

/**
 * Validate a value against a refinement brand's predicate.
 *
 * @param value - The runtime value to validate
 * @param brand - The refinement brand to validate against
 * @returns An object with `valid` boolean and optional `error` message
 */
export function validateRefined(value: unknown, brand: string): { valid: boolean; error?: string } {
  const rule = validationRules.get(brand);
  if (!rule) {
    return {
      valid: false,
      error: `No validation rule registered for brand "${brand}"`,
    };
  }
  try {
    const valid = rule(value);
    return valid
      ? { valid: true }
      : { valid: false, error: `Value ${String(value)} does not satisfy ${brand}` };
  } catch {
    return {
      valid: false,
      error: `Validation for ${brand} threw on value ${String(value)}`,
    };
  }
}

/**
 * Bridge function that connects all registered refinement predicates
 * to the validation system. Call this once to enable automatic validation
 * of Refined types when using `validate<T>()`.
 *
 * This is called automatically on module import for built-in predicates,
 * but can be called again after registering custom predicates.
 *
 * @returns The number of validation rules registered
 */
export function registerValidationBridge(): number {
  let count = 0;
  for (const pred of registeredPredicates) {
    registerValidationRule(pred.brand, pred.predicate);
    count++;
  }
  return count;
}

// ============================================================================
// Feature: Cross-function refinement propagation
// ============================================================================

/**
 * Registry mapping function names to their return refinement brands.
 * When a function's @ensures contract guarantees a refinement, callers
 * can use this to know the return value satisfies the brand without
 * re-checking.
 */
const functionRefinements = new Map<string, string>();

/**
 * Register a function's return type refinement.
 *
 * When a function's `@ensures` contract guarantees a refinement
 * (e.g., "result > 0" matching the Positive predicate), register
 * it so callers can propagate the refinement without re-checking.
 *
 * @param fnName - The fully qualified function name
 * @param returnBrand - The refinement brand of the return type
 *
 * @example
 * ```typescript
 * // Register that abs() always returns a Positive
 * propagateRefinement("abs", "Positive");
 *
 * // Now callers know the result is Positive
 * const brand = getRefinementFromCall("abs");
 * // brand === "Positive"
 * ```
 */
export function propagateRefinement(fnName: string, returnBrand: string): void {
  functionRefinements.set(fnName, returnBrand);
}

/**
 * Retrieve the refinement brand for a function call site.
 *
 * If `propagateRefinement` was previously called for this function,
 * returns the brand — enabling the caller to treat the result as
 * Refined<T, Brand> without a redundant runtime check.
 *
 * @param fnName - The function name to look up
 * @returns The refinement brand, or undefined if none registered
 */
export function getRefinementFromCall(fnName: string): string | undefined {
  return functionRefinements.get(fnName);
}

/**
 * Check whether a function has a registered return refinement.
 */
export function hasRefinementFromCall(fnName: string): boolean {
  return functionRefinements.has(fnName);
}

/**
 * Get all registered function refinement propagations.
 * Returns a readonly array of [fnName, brand] pairs.
 */
export function getAllPropagatedRefinements(): readonly [string, string][] {
  return Array.from(functionRefinements.entries());
}

/**
 * Clear a specific function's refinement propagation.
 * Useful when a function's contract changes.
 */
export function clearRefinementPropagation(fnName: string): boolean {
  return functionRefinements.delete(fnName);
}

/**
 * Check whether a function's return refinement is a subtype of a target brand.
 * Combines cross-function propagation with subtyping rules.
 *
 * For example, if `abs` returns Positive and we need NonNegative,
 * this returns true because Positive <: NonNegative.
 *
 * @param fnName - The function name
 * @param targetBrand - The required brand at the call site
 * @returns true if the function's return refinement satisfies targetBrand
 */
export function callSatisfiesRefinement(fnName: string, targetBrand: string): boolean {
  const returnBrand = functionRefinements.get(fnName);
  if (!returnBrand) return false;
  if (returnBrand === targetBrand) return true;
  return canWiden(returnBrand, targetBrand);
}

// ============================================================================
// Auto-registration on import
// ============================================================================

// Execute registration immediately
registerBuiltinPredicates();
registerBuiltinSubtypingRules();
registerBuiltinDecidability();
registerBuiltinDynamicPredicates();

// Bridge built-in predicates to the validation system
registerValidationBridge();

// Log registration in development
if (process.env.NODE_ENV === "development") {
  const subtypingRules = getAllSubtypingDeclarations();
  const decidabilityInfo = getAllDecidabilityInfo();
  console.log(
    `[@typesugar/contracts-refined] Registered ${REFINEMENT_PREDICATES.length} predicates, ${subtypingRules.length} subtyping rules, ${decidabilityInfo.length} decidability annotations, ${validationRules.size} validation rules`
  );
}
