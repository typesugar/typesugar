/**
 * @typesugar/contracts — Design by Contract for TypeScript
 *
 * Provides compile-time and runtime contract checking:
 *
 * - `requires(condition, message?)` — Precondition (inline)
 * - `ensures(condition, message?)` — Postcondition (inline)
 * - `old(expr)` — Capture pre-call value (inside ensures)
 * - `@contract` — Decorator enabling requires:/ensures: labeled blocks
 * - `@invariant(predicate, message?)` — Class invariant
 * - `comptime(() => expr)` — Compile-time constant evaluation
 *
 * Contracts are strippable in production via configuration:
 * - `contracts.mode: "full"` — All checks (default)
 * - `contracts.mode: "assertions"` — Only invariants
 * - `contracts.mode: "none"` — All stripped
 *
 * ## Proof Engine
 *
 * The proof engine attempts to verify conditions at compile time:
 * 1. **Constant evaluation** — Static values (`true`, `5 > 3`, `comptime()` results)
 * 2. **Type deduction** — From Refined<T, Brand> types (e.g., Positive implies > 0)
 * 3. **Algebraic rules** — Mathematical identities and transitivity
 * 4. **Linear arithmetic** — Fourier-Motzkin elimination for linear constraints
 * 5. **Prover plugins** — External solvers (e.g., Z3 via @typesugar/contracts-z3)
 *
 * ## Compile-Time Evaluation with comptime()
 *
 * The `comptime()` macro evaluates expressions at build time and replaces
 * them with their computed values. This integrates with the prover's
 * constant evaluation layer:
 *
 * ```typescript
 * import { requires, comptime } from "@typesugar/contracts";
 *
 * // Compile-time constants are automatically proven
 * const BUFFER_SIZE = comptime(() => 1024 * 16);  // Becomes: 16384
 * const MAX_RETRIES = comptime(() => Math.min(10, 3 + 2));  // Becomes: 5
 *
 * function allocateBuffer(size: number) {
 *   // Prover can statically verify this when size is BUFFER_SIZE
 *   requires(size > 0 && size <= BUFFER_SIZE);
 *   return new ArrayBuffer(size);
 * }
 * ```
 *
 * @example Basic contracts
 * ```typescript
 * import { requires, ensures, old, contract, invariant } from "@typesugar/contracts";
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
 *
 * @example Compile-time evaluation
 * ```typescript
 * import { requires, comptime } from "@typesugar/contracts";
 *
 * // Complex computation done at build time
 * const PRIMES = comptime(() => {
 *   const sieve = (n: number) => {
 *     const isPrime = Array(n + 1).fill(true);
 *     isPrime[0] = isPrime[1] = false;
 *     for (let i = 2; i * i <= n; i++) {
 *       if (isPrime[i]) for (let j = i * i; j <= n; j += i) isPrime[j] = false;
 *     }
 *     return isPrime.map((p, i) => p ? i : -1).filter(x => x > 0);
 *   };
 *   return sieve(100);
 * });
 * // PRIMES becomes: [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, ...]
 *
 * function isPrime(n: number): boolean {
 *   requires(n > 0);
 *   return PRIMES.includes(n);
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

// --- Compile-Time Evaluation ---
// Re-export comptime for convenient use with contracts.
// comptime() evaluates expressions at build time and integrates with
// the prover's constant evaluation layer.
export { comptime, comptimeMacro } from "@typesugar/comptime";

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
