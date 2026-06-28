/**
 * @typesugar/contracts — Macro definitions (BUILD-TIME ONLY).
 *
 * This entry imports `typescript` and is loaded by the transformer at build time
 * (via the `./macros` subpath). It must NOT be imported by application runtime
 * code — the runtime stubs + helpers live in the package's `.` entry. See PEP-050.
 *
 * Importing this module registers all of the contract macros with the global
 * registry (each macro module self-registers as a side effect of import):
 *   - requires(), ensures(), old() expression macros
 *   - @contract, @invariant, @decidable, @laws attribute macros
 *
 * It also re-exports the compile-time helpers (parser, prover engine, type-fact
 * extraction) that operate on the TypeScript AST.
 */

// --- Macro definitions (importing each module runs its globalRegistry.register) ---
export { requiresMacro } from "./macros/requires.js";
export { ensuresMacro } from "./macros/ensures.js";
export { oldMacro } from "./macros/old.js";
export { contractAttribute } from "./macros/contract.js";
export { invariantAttribute } from "./macros/invariant.js";
export { decidableAttribute } from "./macros/decidable.js";
export { lawsAttribute, type LawsDecoratorOptions } from "./macros/laws.js";

// --- old() capture helpers (operate on the TS AST) ---
export { type OldCapture, extractOldCaptures, generateOldCaptureStatements } from "./macros/old.js";

// --- Parser (TS AST → normalized predicates / contract blocks) ---
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

// --- Prover engine (compile-time proof attempts; require MacroContext / TS AST) ---
export {
  type ProofResult,
  type ProverPlugin,
  tryProve,
  tryProveAsync,
  proveGoalWithPlugins,
  tryProveWithCertificate,
  tryProveWithCertificateAsync,
} from "./prover/index.js";

// --- Type-fact extraction (walks the TS type checker) ---
export { extractTypeFacts } from "./prover/extract.js";
