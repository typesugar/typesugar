/**
 * @typesugar/fp Law Definitions
 *
 * This module exports structured law definitions for all typeclasses.
 * Laws are data, not just comments — they can be verified at compile time
 * via @typesugar/contracts or at runtime via property-based testing.
 *
 * ## Usage
 *
 * ```typescript
 * import { semigroupLaws, monoidLaws } from "@typesugar/fp/laws";
 * import { forAll } from "@typesugar/testing";
 *
 * // Property-based testing
 * const laws = semigroupLaws(mySemigroup, myEq);
 * for (const law of laws) {
 *   forAll((x, y, z) => law.check(x, y, z));
 * }
 *
 * // Compile-time verification (with @verifyLaws macro)
 * @verifyLaws(semigroupLaws)
 * const mySemigroup: Semigroup<number> = { combine: (x, y) => x + y };
 * ```
 *
 * @module
 */

// ============================================================================
// Core Types
// ============================================================================

export type {
  // Re-exports from @typesugar/contracts
  Law,
  LawSet,
  LawGenerator,
  ProofHint,
  Arbitrary,
  VerificationMode,
  UndecidableAction,
  LawVerificationResult,
  VerificationSummary,
  // @typesugar/fp-specific types
  EqF,
  EqFA,
  VerifyLawsOptions,
  ValueLawGenerator,
  HKTLawGenerator,
} from "./types.js";

// Re-export builder utilities from @typesugar/contracts
export { defineLaw, combineLaws, filterLaws, filterByHint } from "./types.js";

// ============================================================================
// Value-Level Typeclass Laws
// ============================================================================

// Eq and Ord
export { eqLaws, ordLaws } from "./eq.js";

// Semigroup and Monoid
export { semigroupLaws, monoidLaws } from "./semigroup.js";

// Show
export { showLaws, showLawsWithEq } from "./show.js";

// ============================================================================
// HKT Typeclass Laws
// ============================================================================

// Functor
export { functorLaws, functorCompositionLaws } from "./functor.js";

// Applicative
export { applyLaws, applicativeLaws } from "./applicative.js";

// Monad
export { flatMapLaws, monadLaws, monadStackSafetyLaws } from "./monad.js";

// Foldable
export { foldableLaws, foldableOrderLaws } from "./foldable.js";

// Traverse
export { traverseLaws, traverseLawsWithApplicative, sequenceLaws } from "./traverse.js";

// Alternative
export {
  semigroupKLaws,
  monoidKLaws,
  alternativeLaws,
  alternativeLawsNonDistributive,
} from "./alternative.js";
