/**
 * Generic Law Definition Types
 *
 * Provides a framework for defining and verifying algebraic laws
 * for any interface or abstraction. This is the foundation that
 * @ttfx/fp uses for typeclass laws, but can be used independently.
 *
 * @example
 * ```typescript
 * import { type Law, type LawSet } from "@ttfx/contracts/laws";
 *
 * // Define laws for a custom Cache interface
 * interface Cache<K, V> {
 *   get(k: K): V | undefined;
 *   set(k: K, v: V): void;
 * }
 *
 * function cacheLaws<K, V>(c: Cache<K, V>, eq: Eq<V>): LawSet {
 *   return [
 *     {
 *       name: "get after set",
 *       arity: 2,
 *       check: (k: K, v: V) => {
 *         c.set(k, v);
 *         return eq.eqv(c.get(k)!, v);
 *       },
 *     },
 *   ];
 * }
 * ```
 *
 * @module
 */

// ============================================================================
// Proof Hints
// ============================================================================

/**
 * Proof hints for the compile-time prover.
 *
 * These tell the algebraic prover which rewrite rules to apply.
 * The prover uses these hints to guide proof search more efficiently.
 */
export type ProofHint =
  | "identity-left"
  | "identity-right"
  | "associativity"
  | "commutativity"
  | "reflexivity"
  | "symmetry"
  | "transitivity"
  | "antisymmetry"
  | "totality"
  | "homomorphism"
  | "composition"
  | "naturality"
  | "distributivity"
  | "absorption"
  | "idempotence"
  | "involution";

// ============================================================================
// Core Law Type
// ============================================================================

/**
 * A law definition.
 *
 * Laws are predicates that must hold for all valid implementations
 * of an interface. They can be verified at compile-time (via the prover)
 * or at runtime (via property-based testing with forAll).
 *
 * @template Args - Tuple type of the law's input arguments
 *
 * @example
 * ```typescript
 * const associativityLaw: Law<[number, number, number]> = {
 *   name: "associativity",
 *   arity: 3,
 *   proofHint: "associativity",
 *   description: "combine(combine(a, b), c) === combine(a, combine(b, c))",
 *   check: (a, b, c) => combine(combine(a, b), c) === combine(a, combine(b, c)),
 * };
 * ```
 */
export interface Law<Args extends unknown[] = unknown[]> {
  /**
   * Human-readable name of the law.
   * Used in error messages and test descriptions.
   * @example "associativity", "left identity", "functor composition"
   */
  readonly name: string;

  /**
   * The law predicate.
   * Returns true if the law holds for the given inputs.
   * The check function receives arbitrary values of the appropriate types.
   */
  readonly check: (...args: Args) => boolean;

  /**
   * Number of arbitrary values the law needs.
   * Used by forAll to generate the right number of test inputs.
   */
  readonly arity: number;

  /**
   * Optional hints for the compile-time prover.
   * Tells the algebraic prover which rewrite rules might apply.
   * Can be a single hint or an array of hints to try.
   */
  readonly proofHint?: ProofHint | ProofHint[];

  /**
   * Optional description explaining the law in plain English.
   * Shown in error messages when verification fails.
   */
  readonly description?: string;

  /**
   * Optional category for grouping related laws.
   * @example "identity", "composition", "structure"
   */
  readonly category?: string;
}

// ============================================================================
// Law Collections
// ============================================================================

/**
 * A collection of laws.
 * Returned by law generator functions like `semigroupLaws`, `cacheLaws`, etc.
 */
export type LawSet = readonly Law[];

/**
 * A function that generates laws for an instance.
 * Takes the instance and any required auxiliary instances (e.g., Eq for comparison).
 *
 * @template Instance - The type of the instance being verified
 * @template Aux - Tuple of auxiliary instances needed (e.g., Eq, Arbitrary)
 */
export type LawGenerator<Instance, Aux extends unknown[] = []> = (
  instance: Instance,
  ...aux: Aux
) => LawSet;

// ============================================================================
// Arbitrary (for property testing)
// ============================================================================

/**
 * Arbitrary instance for generating random test values.
 * Used by forAll in property-test mode.
 *
 * @template A - The type of values to generate
 */
export interface Arbitrary<A> {
  /**
   * Generate a random value of type A.
   * Should produce a variety of values including edge cases.
   */
  readonly arbitrary: () => A;

  /**
   * Optional shrink function for finding minimal counterexamples.
   * Given a failing value, returns smaller values to try.
   */
  readonly shrink?: (a: A) => Iterable<A>;
}

// ============================================================================
// Verification Options
// ============================================================================

/**
 * Verification mode for laws.
 * - `false`: Laws not checked, decorators erase completely
 * - `"compile-time"`: Use prover for static verification
 * - `"property-test"`: Generate forAll() property tests
 */
export type VerificationMode = false | "compile-time" | "property-test";

/**
 * What to do when a law cannot be proven at compile time.
 * - `"error"`: Fail compilation
 * - `"warn"`: Emit warning and continue
 * - `"fallback"`: Silently fall back to property test
 * - `"ignore"`: Skip undecidable laws entirely
 */
export type UndecidableAction = "error" | "warn" | "fallback" | "ignore";

/**
 * Options for law verification.
 *
 * @template A - The type of values being tested
 */
export interface VerifyOptions<A = unknown> {
  /**
   * Override the default verification mode from config.
   */
  readonly mode?: VerificationMode;

  /**
   * Arbitrary instance for generating test values.
   * Required for property-test mode.
   */
  readonly arbitrary?: Arbitrary<A>;

  /**
   * What to do when a law cannot be proven at compile time.
   * Default: "warn"
   */
  readonly onUndecidable?: UndecidableAction;

  /**
   * Whether to fail compilation on undecidable laws.
   * Shorthand for `onUndecidable: "error"`.
   * @deprecated Use `onUndecidable` instead
   */
  readonly strict?: boolean;

  /**
   * Number of test iterations for property-test mode.
   * Default: 100
   */
  readonly iterations?: number;
}

// ============================================================================
// Verification Results
// ============================================================================

/**
 * Result of attempting to verify a law at compile time.
 */
export type LawVerificationResult =
  | {
      readonly status: "proven";
      readonly law: string;
      readonly method?: string;
    }
  | {
      readonly status: "disproven";
      readonly law: string;
      readonly counterexample?: string;
    }
  | {
      readonly status: "undecidable";
      readonly law: string;
      readonly reason: string;
    };

/**
 * Summary of verification for a set of laws.
 */
export interface VerificationSummary {
  readonly total: number;
  readonly proven: number;
  readonly disproven: number;
  readonly undecidable: number;
  readonly results: readonly LawVerificationResult[];
}

// ============================================================================
// Law Builder Utilities
// ============================================================================

/**
 * Create a law with type inference for the check function.
 *
 * @example
 * ```typescript
 * const law = defineLaw({
 *   name: "reflexivity",
 *   arity: 1,
 *   proofHint: "reflexivity",
 *   check: (a: number) => a === a,
 * });
 * ```
 */
export function defineLaw<Args extends unknown[]>(law: Law<Args>): Law<Args> {
  return law;
}

/**
 * Combine multiple law sets into one.
 *
 * @example
 * ```typescript
 * const allLaws = combineLaws(
 *   baseLaws(instance),
 *   extensionLaws(instance),
 * );
 * ```
 */
export function combineLaws(...lawSets: LawSet[]): LawSet {
  return lawSets.flat();
}

/**
 * Filter laws by category.
 *
 * @example
 * ```typescript
 * const identityLaws = filterLaws(allLaws, "identity");
 * ```
 */
export function filterLaws(laws: LawSet, category: string): LawSet {
  return laws.filter((law) => law.category === category);
}

/**
 * Filter laws by proof hint.
 *
 * @example
 * ```typescript
 * const associativeLaws = filterByHint(allLaws, "associativity");
 * ```
 */
export function filterByHint(laws: LawSet, hint: ProofHint): LawSet {
  return laws.filter((law) => {
    if (!law.proofHint) return false;
    if (Array.isArray(law.proofHint)) {
      return law.proofHint.includes(hint);
    }
    return law.proofHint === hint;
  });
}
