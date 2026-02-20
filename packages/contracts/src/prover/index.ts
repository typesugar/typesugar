/**
 * Proof Engine
 *
 * Attempts to prove contract conditions at compile time, eliminating
 * the need for runtime checks. Runs proof layers in order:
 *
 * 1. **Constant evaluation** — `ctx.evaluate()` and `comptime()` results
 * 2. **Type-based deduction** — Refined type facts (e.g., Positive implies > 0)
 * 3. **Algebraic rules** — Pattern matching (transitivity, arithmetic identities)
 * 4. **Linear arithmetic** — Fourier-Motzkin variable elimination
 * 5. **Prover plugins** — External solvers (e.g., Z3 via @typesugar/contracts-z3)
 *
 * If any layer proves the condition, no runtime check is emitted.
 * If all layers fail, a runtime check is generated.
 *
 * ## Integration with comptime()
 *
 * The `comptime()` macro from `@typesugar/comptime` evaluates expressions at build
 * time. Values produced by `comptime()` are treated as constants by the prover:
 *
 * ```typescript
 * const MAX = comptime(() => 1024 * 16);  // Becomes: 16384
 * requires(size <= MAX);  // Prover knows MAX = 16384
 * ```
 *
 * This enables complex compile-time computations (loops, recursion, array
 * methods) while still benefiting from proof elimination.
 *
 * ## Proof Certificates (Coq-inspired)
 *
 * The prover can return structured proof certificates that explain
 * how a proof was achieved or why it failed. Use `tryProveWithCertificate`
 * for detailed proof traces.
 */

import * as ts from "typescript";
import type { MacroContext } from "@typesugar/core";
import type { ContractCondition } from "../parser/predicate.js";
import {
  extractTypeFacts,
  type TypeFact,
  getDecidability,
  canWiden,
  getSubtypingRule,
} from "./type-facts.js";
import { tryAlgebraicProof, type AlgebraicProofResult } from "./algebra.js";
import { tryLinearArithmetic, type LinearProofResult } from "./linear.js";
import {
  getContractConfig,
  emitDecidabilityWarning,
  canProveAtCompileTime,
} from "../config.js";
import {
  type ProofCertificate,
  type ProofStep,
  type ProofMethod,
  createCertificate,
  succeedCertificate,
  failCertificate,
  addStep,
  createStep,
  formatCertificate,
  certificateToResult,
} from "./certificate.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a proof attempt.
 */
export interface ProofResult {
  /** Whether the condition was proven */
  proven: boolean;
  /** Which method succeeded */
  method?: ProofMethod;
  /** Human-readable explanation */
  reason?: string;
}

/**
 * Plugin interface for external provers (e.g., Z3).
 * Plugins are registered via registerProverPlugin() in config.ts.
 */
export interface ProverPlugin {
  /** Plugin name (for diagnostics) */
  name: string;
  /**
   * Attempt to prove a goal given known facts.
   * Return proven: true if the goal is provably true.
   * Can return a Promise for async provers like Z3.
   */
  prove(
    goal: string,
    facts: TypeFact[],
    timeout?: number,
  ): ProofResult | Promise<ProofResult>;
}

// Re-export for convenience
export type { TypeFact } from "./type-facts.js";

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Try to prove a contract condition at compile time (synchronous).
 *
 * Runs through proof layers in order, returning as soon as one succeeds.
 * For async plugins, only uses results if they resolve synchronously.
 *
 * When a proof fails for a predicate that was expected to be compile-time
 * decidable, emits a warning based on the decidability configuration.
 */
export function tryProve(
  ctx: MacroContext,
  condition: ContractCondition,
  fn: ts.FunctionDeclaration | ts.MethodDeclaration,
): ProofResult {
  const config = getContractConfig();

  // Layer 1: Constant evaluation
  if (ctx.isComptime(condition.expression)) {
    const result = ctx.evaluate(condition.expression);
    if (result.kind === "boolean" && result.value === true) {
      return { proven: true, method: "constant", reason: "statically true" };
    }
  }

  // Layer 2: Type-based deduction
  const facts = extractTypeFacts(ctx, fn);
  if (facts.length > 0) {
    const typeProof = tryTypeDeduction(condition.normalized, facts);
    if (typeProof.proven) return typeProof;
  }

  // Layer 3: Algebraic rules
  if (facts.length > 0) {
    const algebraProof = tryAlgebraicProof(condition.normalized, facts);
    if (algebraProof.proven) return algebraProof;
  }

  // Layer 4: Linear arithmetic (Fourier-Motzkin)
  if (facts.length > 0) {
    const linearProof = tryLinearArithmetic(condition.normalized, facts);
    if (linearProof.proven) return linearProof;
  }

  // Layer 5: Prover plugins (sync only)
  let usedSMT = false;
  for (const plugin of config.proverPlugins) {
    const pluginResult = plugin.prove(condition.normalized, facts);
    // Handle sync results only
    if (pluginResult && !(pluginResult instanceof Promise)) {
      if (pluginResult.proven) {
        // Track if SMT solver was used (for decidability warnings)
        if (
          plugin.name.toLowerCase().includes("z3") ||
          plugin.name.toLowerCase().includes("smt")
        ) {
          usedSMT = true;
        }
        return {
          proven: true,
          method: "plugin",
          reason: `${plugin.name}: ${pluginResult.reason ?? "proven"}`,
        };
      }
    }
  }

  // Proof failed — emit decidability warning if configured
  emitFallbackWarning(condition, facts, usedSMT);

  return { proven: false };
}

/**
 * Emit a decidability warning when falling back to runtime checks.
 * Extracts brands from the condition and facts to determine if this
 * was expected to be compile-time decidable.
 */
function emitFallbackWarning(
  condition: ContractCondition,
  facts: TypeFact[],
  usedSMT: boolean,
): void {
  // Extract brand names from facts (brands are typically Capitalized)
  const brands = extractBrandsFromFacts(facts);

  for (const brand of brands) {
    const decidability = getDecidability(brand);

    if (decidability && canProveAtCompileTime(decidability.decidability)) {
      // Expected compile-time proof but fell back to runtime
      emitDecidabilityWarning({
        brand,
        expectedStrategy: decidability.decidability,
        actualStrategy: usedSMT ? "smt" : "runtime",
        reason: usedSMT
          ? `Used SMT solver for: ${condition.normalized}`
          : `Could not prove at compile time: ${condition.normalized}`,
      });
    }
  }
}

/**
 * Extract brand names from type facts.
 * Brands are typically PascalCase and correspond to refined type names.
 */
function extractBrandsFromFacts(facts: TypeFact[]): string[] {
  const brands: string[] = [];
  const brandPattern = /^[A-Z][a-zA-Z0-9]*$/;

  for (const fact of facts) {
    // Extract brand-like names from predicates
    // e.g., "x > 0" might come from Positive, "x >= 0 && x <= 255" from UInt8
    const words = fact.predicate.match(/[A-Z][a-zA-Z0-9]*/g);
    if (words) {
      for (const word of words) {
        if (brandPattern.test(word) && !brands.includes(word)) {
          brands.push(word);
        }
      }
    }

    // Also check if the variable name hints at a brand
    const varBrand = fact.variable.match(/^([A-Z][a-zA-Z0-9]*)/);
    if (varBrand && !brands.includes(varBrand[1])) {
      brands.push(varBrand[1]);
    }
  }

  return brands;
}

/**
 * Try to prove a contract condition at compile time (async).
 *
 * Like tryProve, but properly awaits async plugins like Z3.
 * Use this when you can afford async operations.
 */
export async function tryProveAsync(
  ctx: MacroContext,
  condition: ContractCondition,
  fn: ts.FunctionDeclaration | ts.MethodDeclaration,
): Promise<ProofResult> {
  // Layer 1: Constant evaluation
  if (ctx.isComptime(condition.expression)) {
    const result = ctx.evaluate(condition.expression);
    if (result.kind === "boolean" && result.value === true) {
      return { proven: true, method: "constant", reason: "statically true" };
    }
  }

  // Layer 2: Type-based deduction
  const facts = extractTypeFacts(ctx, fn);
  if (facts.length > 0) {
    const typeProof = tryTypeDeduction(condition.normalized, facts);
    if (typeProof.proven) return typeProof;
  }

  // Layer 3: Algebraic rules
  if (facts.length > 0) {
    const algebraProof = tryAlgebraicProof(condition.normalized, facts);
    if (algebraProof.proven) return algebraProof;
  }

  // Layer 4: Linear arithmetic (Fourier-Motzkin)
  if (facts.length > 0) {
    const linearProof = tryLinearArithmetic(condition.normalized, facts);
    if (linearProof.proven) return linearProof;
  }

  // Layer 5: Prover plugins (async supported)
  const config = getContractConfig();
  for (const plugin of config.proverPlugins) {
    try {
      const pluginResult = await plugin.prove(condition.normalized, facts);
      if (pluginResult.proven) {
        return {
          proven: true,
          method: "plugin",
          reason: `${plugin.name}: ${pluginResult.reason ?? "proven"}`,
        };
      }
    } catch {
      // Plugin error, continue to next
    }
  }

  return { proven: false };
}

/**
 * Try to prove a goal string directly with plugins (for testing).
 * Skips the TypeScript AST layer and directly runs plugins.
 */
export async function proveGoalWithPlugins(
  goal: string,
  facts: TypeFact[],
): Promise<ProofResult> {
  // First try algebraic rules
  const algebraProof = tryAlgebraicProof(goal, facts);
  if (algebraProof.proven) return algebraProof;

  // Then try linear arithmetic
  const linearProof = tryLinearArithmetic(goal, facts);
  if (linearProof.proven) return linearProof;

  // Then try plugins
  const config = getContractConfig();
  for (const plugin of config.proverPlugins) {
    try {
      const pluginResult = await plugin.prove(goal, facts);
      if (pluginResult.proven) {
        return {
          proven: true,
          method: "plugin",
          reason: `${plugin.name}: ${pluginResult.reason ?? "proven"}`,
        };
      }
    } catch {
      // Plugin error, continue to next
    }
  }

  return { proven: false };
}

// ============================================================================
// Type Deduction
// ============================================================================

/**
 * Extended type deduction result with proof step.
 */
interface TypeDeductionResult extends ProofResult {
  step?: ProofStep;
}

/**
 * Try to prove a goal directly from type facts.
 * This handles the simple case where the contract condition
 * exactly matches a known type fact.
 */
function tryTypeDeduction(
  goal: string,
  facts: TypeFact[],
): TypeDeductionResult {
  const normalizedGoal = goal.trim();

  for (const fact of facts) {
    // Direct match: the goal IS the type fact
    if (fact.predicate === normalizedGoal) {
      return {
        proven: true,
        method: "type",
        reason: `${fact.variable} has Refined type guaranteeing: ${fact.predicate}`,
        step: createStep(
          "type_fact",
          `Goal matches type fact from ${fact.variable}`,
          `${fact.variable} has Refined type guaranteeing: ${fact.predicate}`,
          [fact],
        ),
      };
    }

    // The goal is a subset of a compound fact
    // e.g., fact is "x >= 0 && x <= 255", goal is "x >= 0"
    if (fact.predicate.includes("&&")) {
      const parts = fact.predicate.split("&&").map((p) => p.trim());
      if (parts.includes(normalizedGoal)) {
        return {
          proven: true,
          method: "type",
          reason: `${fact.variable} has Refined type guaranteeing: ${fact.predicate} (includes ${normalizedGoal})`,
          step: createStep(
            "type_fact_conjunction",
            `Goal is part of compound type fact from ${fact.variable}`,
            `${fact.variable} has Refined type guaranteeing: ${fact.predicate} (includes ${normalizedGoal})`,
            [fact],
          ),
        };
      }
    }
  }

  return { proven: false };
}

// ============================================================================
// Certificate-Based Proving
// ============================================================================

/**
 * Try to prove a condition and return a detailed proof certificate.
 *
 * Unlike tryProve which returns just success/failure, this returns
 * a full proof trace with all steps and assumptions.
 */
export function tryProveWithCertificate(
  ctx: MacroContext,
  condition: ContractCondition,
  fn: ts.FunctionDeclaration | ts.MethodDeclaration,
): ProofCertificate {
  const startTime = performance.now();
  const facts = extractTypeFacts(ctx, fn);
  let cert = createCertificate(condition.normalized, facts);

  // Layer 1: Constant evaluation
  if (ctx.isComptime(condition.expression)) {
    const result = ctx.evaluate(condition.expression);
    if (result.kind === "boolean" && result.value === true) {
      cert = succeedCertificate(
        cert,
        "constant",
        createStep(
          "constant_eval",
          "Evaluated at compile time",
          "Expression statically evaluates to true",
        ),
      );
      cert.timeMs = performance.now() - startTime;
      return cert;
    }
  }

  // Layer 2: Type-based deduction
  if (facts.length > 0) {
    const typeProof = tryTypeDeduction(condition.normalized, facts);
    if (typeProof.proven && typeProof.step) {
      cert = succeedCertificate(cert, "type", typeProof.step);
      cert.timeMs = performance.now() - startTime;
      return cert;
    }
  }

  // Layer 3: Algebraic rules
  if (facts.length > 0) {
    const algebraProof = tryAlgebraicProof(condition.normalized, facts);
    if (algebraProof.proven && algebraProof.step) {
      cert = succeedCertificate(cert, "algebra", algebraProof.step);
      cert.timeMs = performance.now() - startTime;
      return cert;
    }
  }

  // Layer 4: Linear arithmetic (Fourier-Motzkin)
  if (facts.length > 0) {
    const linearProof = tryLinearArithmetic(condition.normalized, facts);
    if (linearProof.proven && linearProof.step) {
      cert = succeedCertificate(cert, "linear", linearProof.step);
      cert.timeMs = performance.now() - startTime;
      return cert;
    }
  }

  // Layer 5: Prover plugins
  const config = getContractConfig();
  for (const plugin of config.proverPlugins) {
    const pluginResult = plugin.prove(condition.normalized, facts);
    if (pluginResult && !(pluginResult instanceof Promise)) {
      if (pluginResult.proven) {
        cert = succeedCertificate(
          cert,
          "plugin",
          createStep(
            plugin.name,
            `Proven by ${plugin.name}`,
            pluginResult.reason ?? "Proven by external prover",
          ),
        );
        cert.timeMs = performance.now() - startTime;
        return cert;
      }
    }
  }

  // All layers failed
  cert = failCertificate(cert, "No proof method succeeded");
  cert.timeMs = performance.now() - startTime;
  return cert;
}

/**
 * Try to prove a condition asynchronously and return a detailed proof certificate.
 */
export async function tryProveWithCertificateAsync(
  ctx: MacroContext,
  condition: ContractCondition,
  fn: ts.FunctionDeclaration | ts.MethodDeclaration,
): Promise<ProofCertificate> {
  const startTime = performance.now();
  const facts = extractTypeFacts(ctx, fn);
  let cert = createCertificate(condition.normalized, facts);

  // Layer 1: Constant evaluation
  if (ctx.isComptime(condition.expression)) {
    const result = ctx.evaluate(condition.expression);
    if (result.kind === "boolean" && result.value === true) {
      cert = succeedCertificate(
        cert,
        "constant",
        createStep(
          "constant_eval",
          "Evaluated at compile time",
          "Expression statically evaluates to true",
        ),
      );
      cert.timeMs = performance.now() - startTime;
      return cert;
    }
  }

  // Layer 2: Type-based deduction
  if (facts.length > 0) {
    const typeProof = tryTypeDeduction(condition.normalized, facts);
    if (typeProof.proven && typeProof.step) {
      cert = succeedCertificate(cert, "type", typeProof.step);
      cert.timeMs = performance.now() - startTime;
      return cert;
    }
  }

  // Layer 3: Algebraic rules
  if (facts.length > 0) {
    const algebraProof = tryAlgebraicProof(condition.normalized, facts);
    if (algebraProof.proven && algebraProof.step) {
      cert = succeedCertificate(cert, "algebra", algebraProof.step);
      cert.timeMs = performance.now() - startTime;
      return cert;
    }
  }

  // Layer 4: Linear arithmetic (Fourier-Motzkin)
  if (facts.length > 0) {
    const linearProof = tryLinearArithmetic(condition.normalized, facts);
    if (linearProof.proven && linearProof.step) {
      cert = succeedCertificate(cert, "linear", linearProof.step);
      cert.timeMs = performance.now() - startTime;
      return cert;
    }
  }

  // Layer 5: Prover plugins (async)
  const config = getContractConfig();
  for (const plugin of config.proverPlugins) {
    try {
      const pluginResult = await plugin.prove(condition.normalized, facts);
      if (pluginResult.proven) {
        cert = succeedCertificate(
          cert,
          "plugin",
          createStep(
            plugin.name,
            `Proven by ${plugin.name}`,
            pluginResult.reason ?? "Proven by external prover",
          ),
        );
        cert.timeMs = performance.now() - startTime;
        return cert;
      }
    } catch {
      // Plugin error, continue to next
    }
  }

  // All layers failed
  cert = failCertificate(cert, "No proof method succeeded");
  cert.timeMs = performance.now() - startTime;
  return cert;
}

// Re-export certificate types and utilities
export {
  type ProofCertificate,
  type ProofStep,
  type ProofMethod,
  createCertificate,
  succeedCertificate,
  failCertificate,
  addStep,
  createStep,
  formatCertificate,
  certificateToResult,
} from "./certificate.js";
