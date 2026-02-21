/**
 * Type Fact Extraction
 *
 * Extracts known facts from Refined<T, Brand> parameter types.
 * When a parameter is typed as `Positive`, we know `param > 0`.
 * This allows the prover to skip runtime checks that are guaranteed
 * by the type system.
 *
 * ## Integration with @typesugar/type-system
 *
 * The predicate registry is populated by @typesugar/contracts-refined, which
 * imports predicate definitions from @typesugar/type-system. This ensures a
 * single source of truth for refinement predicates.
 *
 * To enable the integration:
 * ```typescript
 * import "@typesugar/contracts-refined";
 * ```
 *
 * ## Subtyping Coercions (Coq-inspired)
 *
 * The subtyping registry enables automatic safe coercions between related
 * refined types. For example, `Positive` can be safely widened to `NonNegative`
 * without runtime validation because `x > 0` implies `x >= 0`.
 *
 * ```typescript
 * const pos: Positive = Positive.refine(5);
 * const nonNeg: NonNegative = widen(pos); // No runtime check needed!
 * ```
 *
 * ## Decidability Annotations (Coq-inspired)
 *
 * Each predicate can be annotated with its decidability, controlling the
 * proof strategy selection and warning behavior:
 *
 * - `compile-time`: Can always be proven at compile time (e.g., constants)
 * - `decidable`: Can be decided algorithmically, may need SMT solver
 * - `runtime`: Must be checked at runtime (e.g., async validations)
 * - `undecidable`: Cannot be decided, always requires runtime (e.g., halting)
 */

import * as ts from "typescript";
import type { MacroContext } from "@typesugar/core";

/**
 * A fact known about a variable from its type.
 */
export interface TypeFact {
  /** The variable name */
  variable: string;
  /** The predicate in normalized form ($ is the variable) */
  predicate: string;
}

/**
 * A subtyping rule that allows safe coercion from one refined type to another.
 * Inspired by Coq's implicit coercions.
 */
export interface SubtypingRule {
  /** The source refined type brand (e.g., "Positive") */
  from: string;
  /** The target refined type brand (e.g., "NonNegative") */
  to: string;
  /** The algebraic proof rule that justifies the subtyping */
  proof: string;
  /** Human-readable justification */
  justification: string;
}

/**
 * Decidability level for a predicate.
 * Inspired by Coq's termination/decidability requirements.
 */
export type Decidability = "compile-time" | "decidable" | "runtime" | "undecidable";

/**
 * Preferred proof strategy for a predicate.
 */
export type ProofStrategy = "constant" | "type" | "algebra" | "linear" | "z3";

/**
 * Decidability information for a refinement predicate.
 */
export interface DecidabilityInfo {
  /** The refinement brand name */
  brand: string;
  /** How decidable is this predicate? */
  decidability: Decidability;
  /** Preferred proof strategy */
  preferredStrategy: ProofStrategy;
}

/**
 * Registry of known predicates for Refined type brands.
 * Maps brand name → predicate template ($ = the variable).
 *
 * This registry starts empty. Predicates are registered by:
 * - @typesugar/contracts-refined (auto-registers all @typesugar/type-system predicates)
 * - User code via registerRefinementPredicate()
 */
const REFINEMENT_PREDICATES: Record<string, string> = {};

/**
 * Registry of subtyping rules for automatic coercion.
 * Maps "from:to" → SubtypingRule
 */
const SUBTYPING_RULES: Map<string, SubtypingRule> = new Map();

/**
 * Registry of decidability information for refinement predicates.
 * Maps brand name → DecidabilityInfo
 */
const DECIDABILITY_REGISTRY: Map<string, DecidabilityInfo> = new Map();

/**
 * Register a custom refinement predicate.
 */
export function registerRefinementPredicate(brand: string, predicate: string): void {
  REFINEMENT_PREDICATES[brand] = predicate;
}

/**
 * Registry of dynamic predicate generators for parameterized brands.
 * Used for types like Vec<N> where the predicate depends on the parameter.
 */
const DYNAMIC_PREDICATE_GENERATORS: Array<{
  pattern: RegExp;
  generate: (match: RegExpMatchArray) => string;
}> = [
  // Vec<N> - length-indexed vectors
  {
    pattern: /^Vec<(\d+)>$/,
    generate: (match) => `$.length === ${match[1]}`,
  },
];

/**
 * Register a dynamic predicate generator for parameterized brands.
 *
 * @example
 * ```typescript
 * // Register handler for Matrix<R,C> types
 * registerDynamicPredicateGenerator(
 *   /^Matrix<(\d+),(\d+)>$/,
 *   (match) => `$.rows === ${match[1]} && $.cols === ${match[2]}`
 * );
 * ```
 */
export function registerDynamicPredicateGenerator(
  pattern: RegExp,
  generate: (match: RegExpMatchArray) => string
): void {
  DYNAMIC_PREDICATE_GENERATORS.push({ pattern, generate });
}

/**
 * Get the predicate for a refinement brand.
 * Supports both static predicates (from registry) and dynamic predicates
 * (generated for parameterized types like Vec<N>).
 */
export function getRefinementPredicate(brand: string): string | undefined {
  // First check static registry
  const staticPredicate = REFINEMENT_PREDICATES[brand];
  if (staticPredicate) {
    return staticPredicate;
  }

  // Try dynamic generators for parameterized brands
  for (const { pattern, generate } of DYNAMIC_PREDICATE_GENERATORS) {
    const match = brand.match(pattern);
    if (match) {
      return generate(match);
    }
  }

  return undefined;
}

/**
 * Register a subtyping rule for automatic coercion.
 *
 * @example
 * ```typescript
 * registerSubtypingRule({
 *   from: "Positive",
 *   to: "NonNegative",
 *   proof: "positive_implies_non_negative",
 *   justification: "x > 0 implies x >= 0",
 * });
 * ```
 */
export function registerSubtypingRule(rule: SubtypingRule): void {
  const key = `${rule.from}:${rule.to}`;
  SUBTYPING_RULES.set(key, rule);
}

/**
 * Get the subtyping rule for coercing from one brand to another.
 */
export function getSubtypingRule(from: string, to: string): SubtypingRule | undefined {
  return SUBTYPING_RULES.get(`${from}:${to}`);
}

/**
 * Check if a subtyping relationship exists between two brands.
 */
export function canWiden(from: string, to: string): boolean {
  if (from === to) return true;
  return SUBTYPING_RULES.has(`${from}:${to}`);
}

/**
 * Get all subtyping rules where the given brand is the source.
 */
export function getWidenTargets(from: string): SubtypingRule[] {
  const targets: SubtypingRule[] = [];
  for (const rule of SUBTYPING_RULES.values()) {
    if (rule.from === from) {
      targets.push(rule);
    }
  }
  return targets;
}

/**
 * Get all registered subtyping rules.
 */
export function getAllSubtypingRules(): readonly SubtypingRule[] {
  return Array.from(SUBTYPING_RULES.values());
}

/**
 * Register decidability information for a refinement predicate.
 *
 * @example
 * ```typescript
 * registerDecidability({
 *   brand: "Positive",
 *   decidability: "compile-time",
 *   preferredStrategy: "constant",
 * });
 * ```
 */
export function registerDecidability(info: DecidabilityInfo): void {
  DECIDABILITY_REGISTRY.set(info.brand, info);
}

/**
 * Get decidability information for a brand.
 * Returns undefined if not registered.
 */
export function getDecidability(brand: string): DecidabilityInfo | undefined {
  return DECIDABILITY_REGISTRY.get(brand);
}

/**
 * Get the preferred proof strategy for a brand.
 * Returns "algebra" as default if not registered.
 */
export function getPreferredStrategy(brand: string): ProofStrategy {
  const info = DECIDABILITY_REGISTRY.get(brand);
  return info?.preferredStrategy ?? "algebra";
}

/**
 * Check if a predicate can be proven at compile time.
 */
export function isCompileTimeDecidable(brand: string): boolean {
  const info = DECIDABILITY_REGISTRY.get(brand);
  if (!info) return true; // Assume decidable if not registered
  return info.decidability === "compile-time" || info.decidability === "decidable";
}

/**
 * Check if a predicate must always be checked at runtime.
 */
export function requiresRuntimeCheck(brand: string): boolean {
  const info = DECIDABILITY_REGISTRY.get(brand);
  if (!info) return false; // Assume decidable if not registered
  return info.decidability === "runtime" || info.decidability === "undecidable";
}

/**
 * Get all registered decidability information.
 */
export function getAllDecidabilityInfo(): readonly DecidabilityInfo[] {
  return Array.from(DECIDABILITY_REGISTRY.values());
}

/**
 * Extract type facts from a function's parameters.
 * Looks for Refined<Base, Brand> types and maps them to known predicates.
 */
export function extractTypeFacts(
  ctx: MacroContext,
  fn: ts.FunctionDeclaration | ts.MethodDeclaration
): TypeFact[] {
  const facts: TypeFact[] = [];

  for (const param of fn.parameters) {
    const paramName = param.name.getText();
    const type = ctx.typeChecker.getTypeAtLocation(param);
    const brand = extractRefinedBrand(type);

    if (brand) {
      const predicate = REFINEMENT_PREDICATES[brand];
      if (predicate) {
        facts.push({
          variable: paramName,
          predicate: predicate.replace(/\$/g, paramName),
        });
      }
    }
  }

  return facts;
}

/**
 * Extract the brand string from a Refined<Base, Brand> type.
 * Refined types have a `__refined__` property whose type is a string literal.
 */
function extractRefinedBrand(type: ts.Type): string | undefined {
  // Refined<Base, Brand> = Base & { readonly [__refined__]: Brand }
  // We look for the __refined__ property in the intersection
  if (!type.isIntersection?.()) {
    // Could be a type alias — check properties directly
    return extractBrandFromProperties(type);
  }

  for (const member of type.types) {
    const brand = extractBrandFromProperties(member);
    if (brand) return brand;
  }

  return undefined;
}

function extractBrandFromProperties(type: ts.Type): string | undefined {
  const props = type.getProperties();
  for (const prop of props) {
    if (prop.name === "__refined__") {
      // The type of __refined__ is the brand string literal
      const declarations = prop.getDeclarations();
      if (declarations && declarations.length > 0) {
        const decl = declarations[0];
        if (ts.isPropertySignature(decl) && decl.type && ts.isLiteralTypeNode(decl.type)) {
          if (ts.isStringLiteral(decl.type.literal)) {
            return decl.type.literal.text;
          }
        }
      }

      // Try via type checker
      // The brand is encoded as a string literal type
      const propType = type.getProperty?.("__refined__");
      if (propType) {
        const name = propType.getName();
        if (name === "__refined__") {
          // Try to get the type of this property
          // This is a heuristic — the brand is in the type name
          const typeStr = type.symbol?.getName?.() ?? "";
          // Look for common brand patterns
          for (const brand of Object.keys(REFINEMENT_PREDICATES)) {
            if (typeStr.includes(brand)) return brand;
          }
        }
      }
    }
  }

  // Heuristic: check the type alias name
  const aliasSymbol = type.aliasSymbol;
  if (aliasSymbol) {
    const name = aliasSymbol.getName();
    if (REFINEMENT_PREDICATES[name]) return name;
  }

  return undefined;
}
