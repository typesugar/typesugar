/**
 * @ttfx/contracts — Design by Contract for TypeScript
 *
 * Provides compile-time and runtime contract checking:
 *
 * - `requires(condition, message?)` — Precondition (inline)
 * - `ensures(condition, message?)` — Postcondition (inline)
 * - `old(expr)` — Capture pre-call value (inside ensures)
 * - `@contract` — Decorator enabling requires:/ensures: labeled blocks
 * - `@invariant(predicate, message?)` — Class invariant
 *
 * Contracts are strippable in production via configuration:
 * - `contracts.mode: "full"` — All checks (default)
 * - `contracts.mode: "assertions"` — Only invariants
 * - `contracts.mode: "none"` — All stripped
 *
 * The proof engine attempts to verify conditions at compile time:
 * 1. Constant evaluation
 * 2. Type deduction from Refined<T, Brand> types
 * 3. Algebraic rules
 * 4. Prover plugins (e.g., Z3 via @ttfx/contracts-z3)
 *
 * @example
 * ```typescript
 * import { requires, ensures, old, contract, invariant } from "@ttfx/contracts";
 *
 * // Inline style
 * function withdraw(account: Account, amount: Positive): number {
 *   requires(account.balance >= amount, "Insufficient funds");
 *   ensures(account.balance >= 0);
 *   account.balance -= amount;
 *   return account.balance;
 * }
 *
 * // Block style
 * @contract
 * function deposit(account: Account, amount: Positive): void {
 *   requires: { amount > 0; }
 *   ensures: { account.balance === old(account.balance) + amount; }
 *   account.balance += amount;
 * }
 *
 * // Class invariant
 * @invariant((self) => self.balance >= 0)
 * class BankAccount {
 *   balance = 0;
 *   withdraw(amount: Positive): void { this.balance -= amount; }
 * }
 * ```
 */

// --- Macros (import to register) ---
import "./macros/requires.js";
import "./macros/ensures.js";
import "./macros/old.js";
import "./macros/contract.js";
import "./macros/invariant.js";
import "./macros/decidable.js";

// --- Runtime API ---
export { requires } from "./macros/requires.js";
export { ensures } from "./macros/ensures.js";
export { old } from "./macros/old.js";

// --- Macro definitions (for programmatic use) ---
export { requiresMacro } from "./macros/requires.js";
export { ensuresMacro } from "./macros/ensures.js";
export { oldMacro } from "./macros/old.js";
export { contractAttribute } from "./macros/contract.js";
export { invariantAttribute } from "./macros/invariant.js";
export { decidableAttribute, decidable } from "./macros/decidable.js";

// --- Configuration ---
export {
  type ContractConfig,
  type DecidabilityWarningLevel,
  type DecidabilityFallbackInfo,
  setContractConfig,
  getContractConfig,
  registerProverPlugin,
  shouldEmitCheck,
  // Decidability warning helpers
  emitDecidabilityWarning,
  canProveAtCompileTime,
  mustCheckAtRuntime,
} from "./config.js";

// --- Prover ---
export {
  type ProofResult,
  type ProverPlugin,
  type TypeFact,
  tryProve,
  tryProveAsync,
  proveGoalWithPlugins,
  // Proof certificates (Coq-inspired)
  type ProofCertificate,
  type ProofStep,
  type ProofMethod,
  tryProveWithCertificate,
  tryProveWithCertificateAsync,
  createCertificate,
  succeedCertificate,
  failCertificate,
  addStep,
  createStep,
  formatCertificate,
  certificateToResult,
} from "./prover/index.js";
export {
  extractTypeFacts,
  registerRefinementPredicate,
  getRefinementPredicate,
  // Dynamic predicate generators (for parameterized types like Vec<N>)
  registerDynamicPredicateGenerator,
  // Subtyping coercions (Coq-inspired)
  type SubtypingRule,
  registerSubtypingRule,
  getSubtypingRule,
  canWiden,
  getWidenTargets,
  getAllSubtypingRules,
  // Decidability annotations (Coq-inspired)
  type Decidability,
  type ProofStrategy,
  type DecidabilityInfo,
  registerDecidability,
  getDecidability,
  getPreferredStrategy,
  isCompileTimeDecidable,
  requiresRuntimeCheck,
  getAllDecidabilityInfo,
} from "./prover/type-facts.js";
export {
  tryAlgebraicProof,
  registerAlgebraicRule,
  getAllAlgebraicRules,
  type AlgebraicRule,
  type AlgebraicProofResult,
} from "./prover/algebra.js";
export {
  tryLinearArithmetic,
  tryLinearProof,
  trySimpleLinearProof,
  type LinearProofResult,
} from "./prover/linear.js";

// --- Parser ---
export {
  type ContractCondition,
  normalizeExpression,
  extractConditionsFromBlock,
} from "./parser/predicate.js";
export {
  type ParsedContractBlocks,
  type EnsuresBlock,
  parseContractBlocks,
} from "./parser/contract-block.js";

// --- Runtime Errors ---
export {
  ContractError,
  PreconditionError,
  PostconditionError,
  InvariantError,
} from "./runtime/errors.js";

// --- old() utilities ---
export {
  type OldCapture,
  extractOldCaptures,
  generateOldCaptureStatements,
} from "./macros/old.js";

// --- Laws Verification System ---
// Re-export law types and verification utilities
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
  // Macro
  lawsAttribute,
  laws,
  type LawsDecoratorOptions,
} from "./laws/index.js";
