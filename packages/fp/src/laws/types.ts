/**
 * Law Definition Types for @typesugar/fp
 *
 * Re-exports generic law types from @typesugar/contracts and provides
 * @typesugar/fp-specific type aliases and utilities for typeclass law verification.
 *
 * @module
 */

// ============================================================================
// Re-export Generic Types from @typesugar/contracts
// ============================================================================

export {
  // Core types
  type Law,
  type LawSet,
  type LawGenerator,
  type ProofHint,
  type Arbitrary,
  // Verification types
  type VerificationMode,
  type UndecidableAction,
  type LawVerificationResult,
  type VerificationSummary,
  // Builder utilities
  defineLaw,
  combineLaws,
  filterLaws,
  filterByHint,
} from "@typesugar/contracts";

// ============================================================================
// @typesugar/fp-Specific Types
// ============================================================================

import type { $ } from "../hkt.js";

/**
 * For HKT typeclasses, we need to parameterize over the type constructor.
 * This type represents a "lifted" equality check for F[A].
 *
 * @template F - The higher-kinded type constructor marker (e.g., OptionF)
 * @template A - The element type
 */
export type EqF<F, A> = {
  readonly eqv: (fa1: $<F, A>, fa2: $<F, A>) => boolean;
};

/**
 * Shorthand for EqF - equality for F[A].
 * Used in law generators that need to compare F-wrapped values.
 */
export type EqFA<F, A> = EqF<F, A>;

/**
 * Options for the @verifyLaws macro (@typesugar/fp-specific version).
 * Extends the base verification options with typeclass-specific fields.
 */
export interface VerifyLawsOptions<A = unknown> {
  /**
   * Eq instance for comparing results.
   * Required for most law checks.
   */
  readonly eq?: { readonly eqv: (x: A, y: A) => boolean };

  /**
   * Arbitrary instance for generating test values.
   * Required for property-test mode.
   */
  readonly arbitrary?: { readonly arbitrary: () => A };

  /**
   * Override the default verification mode from config.
   */
  readonly mode?: false | "compile-time" | "property-test";

  /**
   * Whether to fail compilation on undecidable laws.
   * Default: false (emit warning instead).
   */
  readonly strict?: boolean;
}

// ============================================================================
// Typeclass Law Type Aliases
// ============================================================================

/**
 * Law generator for value-level typeclasses (Semigroup, Monoid, etc.).
 * Takes the instance and an Eq instance for result comparison.
 */
export type ValueLawGenerator<TC, A> = (
  instance: TC,
  eq: { readonly eqv: (x: A, y: A) => boolean }
) => readonly import("@typesugar/contracts").Law[];

/**
 * Law generator for HKT typeclasses (Functor, Monad, etc.).
 * Takes the instance and an EqFA for comparing F[A] values.
 */
export type HKTLawGenerator<TC, F, A> = (
  instance: TC,
  eqFA: EqFA<F, A>
) => readonly import("@typesugar/contracts").Law[];
