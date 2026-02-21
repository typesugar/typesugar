/**
 * Generic Law Verification System
 *
 * This module provides infrastructure for defining and verifying algebraic
 * laws for any interface or abstraction. It serves as the foundation for
 * domain-specific law checking like @typesugar/fp typeclass laws.
 *
 * ## Quick Start
 *
 * ```typescript
 * import {
 *   type Law,
 *   type LawSet,
 *   defineLaw,
 *   verifyLaws,
 *   laws,
 * } from "@typesugar/contracts/laws";
 *
 * // 1. Define an interface
 * interface Stack<T> {
 *   push(item: T): void;
 *   pop(): T | undefined;
 *   peek(): T | undefined;
 * }
 *
 * // 2. Define laws for the interface
 * function stackLaws<T>(stack: Stack<T>, eq: Eq<T>): LawSet {
 *   return [
 *     defineLaw({
 *       name: "pop-after-push",
 *       arity: 1,
 *       description: "pop() returns the most recently pushed item",
 *       check: (item: T) => {
 *         stack.push(item);
 *         return eq.eqv(stack.pop()!, item);
 *       },
 *     }),
 *   ];
 * }
 *
 * // 3. Verify laws on an implementation
 * @laws(stackLaws, { arbitrary: arbString })
 * const myStack: Stack<string> = new ArrayStack();
 * ```
 *
 * ## Verification Modes
 *
 * Configure via `laws.mode`:
 * - `false` (default): No verification, decorators erased
 * - `"compile-time"`: Static verification using the prover
 * - `"property-test"`: Generate forAll() property tests
 *
 * @module
 */

// ============================================================================
// Type Definitions
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
  type VerifyOptions,
  type LawVerificationResult,
  type VerificationSummary,
  // Builder utilities
  defineLaw,
  combineLaws,
  filterLaws,
  filterByHint,
} from "./types.js";

// ============================================================================
// Verification Engine
// ============================================================================

export {
  // Configuration
  type LawsConfig,
  setLawsConfig,
  getLawsConfig,
  resetLawsConfig,
  // Verification functions
  verifyLaw,
  verifyLaws,
  verifyLawsAsync,
  // Utilities
  proofHintToFacts,
  generatePropertyTest,
  formatVerificationSummary,
} from "./verify.js";

// ============================================================================
// Macro (import to register)
// ============================================================================

// Import the macro to register it with the global registry
import "../macros/laws.js";

// Export macro components
export { lawsAttribute, laws, type LawsDecoratorOptions } from "../macros/laws.js";
