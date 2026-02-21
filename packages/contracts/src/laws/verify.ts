/**
 * Law Verification Engine
 *
 * Provides utilities for verifying laws at compile time or runtime.
 * This is the generic verification layer used by @typesugar/fp and
 * other packages that define algebraic laws.
 *
 * @module
 */

import type { MacroContext } from "@typesugar/core";
import type { TypeFact } from "../prover/type-facts.js";
import { tryAlgebraicProof } from "../prover/algebra.js";
import { tryLinearArithmetic } from "../prover/linear.js";
import { getContractConfig } from "../config.js";
import type {
  Law,
  LawSet,
  VerificationMode,
  UndecidableAction,
  LawVerificationResult,
  VerificationSummary,
  VerifyOptions,
  ProofHint,
} from "./types.js";

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for generic law verification.
 * Can be extended by domain-specific packages like @typesugar/fp.
 */
export interface LawsConfig {
  /** Default verification mode */
  mode: VerificationMode;
  /** What to do when undecidable */
  onUndecidable: UndecidableAction;
  /** Property test iterations */
  iterations: number;
}

const DEFAULT_CONFIG: LawsConfig = {
  mode: false, // Off by default (zero-cost)
  onUndecidable: "warn",
  iterations: 100,
};

let lawsConfig: LawsConfig = { ...DEFAULT_CONFIG };

/**
 * Set the global laws configuration.
 */
export function setLawsConfig(config: Partial<LawsConfig>): void {
  lawsConfig = { ...lawsConfig, ...config };
}

/**
 * Get the current laws configuration.
 */
export function getLawsConfig(): LawsConfig {
  return { ...lawsConfig };
}

/**
 * Reset to default configuration.
 */
export function resetLawsConfig(): void {
  lawsConfig = { ...DEFAULT_CONFIG };
}

// ============================================================================
// Proof Hint to Algebraic Rule Mapping
// ============================================================================

/**
 * Maps proof hints to facts that the algebraic prover understands.
 * This bridges the gap between high-level law hints and low-level prover facts.
 */
export function proofHintToFacts(
  hint: ProofHint,
  operation?: string,
  identity?: string
): TypeFact[] {
  const facts: TypeFact[] = [];
  const op = operation ?? "combine";

  switch (hint) {
    case "identity-left":
    case "identity-right":
      if (identity) {
        facts.push({
          variable: identity,
          predicate: `identity(${op})`,
        });
      }
      break;

    case "associativity":
      facts.push({
        variable: op,
        predicate: `associative(${op})`,
      });
      break;

    case "commutativity":
      facts.push({
        variable: op,
        predicate: `commutative(${op})`,
      });
      break;

    case "reflexivity":
      facts.push({
        variable: "===",
        predicate: "reflexive",
      });
      break;

    case "symmetry":
      facts.push({
        variable: "===",
        predicate: "symmetric",
      });
      break;

    case "transitivity":
      facts.push({
        variable: "===",
        predicate: "transitive",
      });
      break;

    case "homomorphism":
    case "composition":
    case "naturality":
      // These require more context to generate facts
      break;

    case "distributivity":
      facts.push({
        variable: op,
        predicate: `distributive(${op})`,
      });
      break;

    case "idempotence":
      facts.push({
        variable: op,
        predicate: `idempotent(${op})`,
      });
      break;

    case "involution":
      facts.push({
        variable: op,
        predicate: `involution(${op})`,
      });
      break;
  }

  return facts;
}

// ============================================================================
// Law Verification
// ============================================================================

/**
 * Verify a single law using the prover.
 *
 * @param law - The law to verify
 * @param facts - Known type facts from context
 * @param options - Verification options
 * @returns The verification result
 */
export function verifyLaw(
  law: Law,
  facts: TypeFact[],
  options?: VerifyOptions
): LawVerificationResult {
  // Add hint-derived facts
  const allFacts = [...facts];
  if (law.proofHint) {
    const hints = Array.isArray(law.proofHint) ? law.proofHint : [law.proofHint];
    for (const hint of hints) {
      allFacts.push(...proofHintToFacts(hint));
    }
  }

  // Try algebraic proof
  const goal = law.description ?? law.name;
  const algebraResult = tryAlgebraicProof(goal, allFacts);
  if (algebraResult.proven) {
    return {
      status: "proven",
      law: law.name,
      method: algebraResult.method ?? "algebraic",
    };
  }

  // Try linear arithmetic (for numeric laws)
  const linearResult = tryLinearArithmetic(goal, allFacts);
  if (linearResult.proven) {
    return {
      status: "proven",
      law: law.name,
      method: linearResult.method ?? "linear",
    };
  }

  // Try prover plugins
  const config = getContractConfig();
  for (const plugin of config.proverPlugins) {
    const pluginResult = plugin.prove(goal, allFacts);
    if (pluginResult && !(pluginResult instanceof Promise)) {
      if (pluginResult.proven) {
        return {
          status: "proven",
          law: law.name,
          method: plugin.name,
        };
      }
    }
  }

  // Could not prove
  return {
    status: "undecidable",
    law: law.name,
    reason: "No proof method succeeded",
  };
}

/**
 * Verify a set of laws.
 *
 * @param laws - The laws to verify
 * @param facts - Known type facts from context
 * @param options - Verification options
 * @returns Summary of verification results
 */
export function verifyLaws(
  laws: LawSet,
  facts: TypeFact[],
  options?: VerifyOptions
): VerificationSummary {
  const results: LawVerificationResult[] = [];

  for (const law of laws) {
    const result = verifyLaw(law, facts, options);
    results.push(result);
  }

  return {
    total: results.length,
    proven: results.filter((r) => r.status === "proven").length,
    disproven: results.filter((r) => r.status === "disproven").length,
    undecidable: results.filter((r) => r.status === "undecidable").length,
    results,
  };
}

/**
 * Verify laws asynchronously (supports async prover plugins like Z3).
 *
 * @param laws - The laws to verify
 * @param facts - Known type facts from context
 * @param options - Verification options
 * @returns Promise of verification summary
 */
export async function verifyLawsAsync(
  laws: LawSet,
  facts: TypeFact[],
  options?: VerifyOptions
): Promise<VerificationSummary> {
  const results: LawVerificationResult[] = [];

  for (const law of laws) {
    const result = await verifyLawAsync(law, facts, options);
    results.push(result);
  }

  return {
    total: results.length,
    proven: results.filter((r) => r.status === "proven").length,
    disproven: results.filter((r) => r.status === "disproven").length,
    undecidable: results.filter((r) => r.status === "undecidable").length,
    results,
  };
}

/**
 * Verify a single law asynchronously.
 */
async function verifyLawAsync(
  law: Law,
  facts: TypeFact[],
  options?: VerifyOptions
): Promise<LawVerificationResult> {
  // Add hint-derived facts
  const allFacts = [...facts];
  if (law.proofHint) {
    const hints = Array.isArray(law.proofHint) ? law.proofHint : [law.proofHint];
    for (const hint of hints) {
      allFacts.push(...proofHintToFacts(hint));
    }
  }

  // Try algebraic proof
  const goal = law.description ?? law.name;
  const algebraResult = tryAlgebraicProof(goal, allFacts);
  if (algebraResult.proven) {
    return {
      status: "proven",
      law: law.name,
      method: algebraResult.method ?? "algebraic",
    };
  }

  // Try linear arithmetic
  const linearResult = tryLinearArithmetic(goal, allFacts);
  if (linearResult.proven) {
    return {
      status: "proven",
      law: law.name,
      method: linearResult.method ?? "linear",
    };
  }

  // Try prover plugins (async)
  const config = getContractConfig();
  for (const plugin of config.proverPlugins) {
    try {
      const pluginResult = await plugin.prove(goal, allFacts);
      if (pluginResult.proven) {
        return {
          status: "proven",
          law: law.name,
          method: plugin.name,
        };
      }
    } catch {
      // Plugin error, continue
    }
  }

  return {
    status: "undecidable",
    law: law.name,
    reason: "No proof method succeeded",
  };
}

// ============================================================================
// Property Test Generation
// ============================================================================

/**
 * Generate a property test expression for a law.
 * This creates the AST for a forAll call that tests the law.
 *
 * @param law - The law to test
 * @param ctx - Macro context for AST generation
 * @returns The forAll expression as a string (for parsing)
 */
export function generatePropertyTest(
  law: Law,
  arbitraryExpr: string,
  iterations: number = 100
): string {
  // Generate forAll call based on arity
  const args = Array.from({ length: law.arity }, (_, i) => `_arg${i}`).join(", ");

  return `forAll(
    ${arbitraryExpr},
    (${args}) => {
      // ${law.name}${law.description ? `: ${law.description}` : ""}
      return (${law.check.toString()})(${args});
    },
    { iterations: ${iterations} }
  )`;
}

// ============================================================================
// Diagnostic Utilities
// ============================================================================

/**
 * Format a verification summary for diagnostic output.
 */
export function formatVerificationSummary(summary: VerificationSummary): string {
  const lines: string[] = [];
  lines.push(`Law Verification: ${summary.proven}/${summary.total} proven`);

  if (summary.undecidable > 0) {
    lines.push(`  ${summary.undecidable} undecidable (fallback to runtime)`);
  }
  if (summary.disproven > 0) {
    lines.push(`  ${summary.disproven} DISPROVEN (invalid instance)`);
  }

  lines.push("");
  for (const result of summary.results) {
    const icon = result.status === "proven" ? "✓" : result.status === "disproven" ? "✗" : "?";
    const method = result.status === "proven" && result.method ? ` [${result.method}]` : "";
    const reason =
      result.status !== "proven" && "reason" in result && result.reason ? `: ${result.reason}` : "";
    lines.push(`  ${icon} ${result.law}${method}${reason}`);
  }

  return lines.join("\n");
}
