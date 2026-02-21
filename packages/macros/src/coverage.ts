/**
 * Coverage Checking for Typeclass Derivation
 *
 * This module provides compile-time verification that all required
 * instances exist before deriving a typeclass.
 *
 * ## The Problem
 *
 * ```typescript
 * @derive(Show)
 * interface User {
 *   name: string;     // OK - Show<string> exists
 *   metadata: Custom; // ERROR - no Show<Custom>!
 * }
 * ```
 *
 * Without coverage checking, this would compile but fail at runtime.
 *
 * ## Solution: Primitive<T, TC>
 *
 * `Primitive<T, TC>` is a compile-time witness that type `T` has an
 * instance of typeclass `TC`. The derivation system checks that all
 * field types have the required `Primitive` before generating code.
 *
 * ## Usage
 *
 * 1. Primitives are auto-registered: `Primitive<number, Show>`, etc.
 * 2. `@instance` auto-registers `Primitive<T, TC>` for the type
 * 3. `@derive(Show)` checks all fields have `Primitive<FieldType, Show>`
 * 4. Missing coverage → compile error with helpful message
 *
 * ## Flexibility
 *
 * Some typeclasses don't need full coverage:
 * - `Functor<F>` only cares about the container, not elements
 * - Custom typeclasses can opt out with `requiresCoverage: false`
 *
 * @packageDocumentation
 */

import * as ts from "typescript";
import { MacroContext } from "@typesugar/core";
import { setCoverageHooks } from "./typeclass.js";

// ============================================================================
// Primitive Registry
// ============================================================================

/**
 * Registry of types that have primitive/base instances.
 * Key: "TypeName::TypeclassName"
 */
const primitiveRegistry = new Set<string>();

/**
 * Register that a type has a primitive instance for a typeclass.
 */
export function registerPrimitive(typeName: string, typeclassName: string): void {
  const key = `${typeName}::${typeclassName}`;
  primitiveRegistry.add(key);
}

/**
 * Check if a type has a primitive instance for a typeclass.
 */
export function hasPrimitive(typeName: string, typeclassName: string): boolean {
  const key = `${typeName}::__binop__(${typeclassName}`;
  return primitiveRegistry.has(key);
}

/**
 * Get all primitives for a typeclass.
 */
export function getPrimitivesFor(typeclassName: string): string[] {
  const result: string[] = [];
  primitiveRegistry.forEach((key) => {
    if (key.endsWith(`, "::", ${typeclassName}`)) {
      result.push(key.split("::")[0]);
    }
  });
  return result;
}

// ============================================================================
// Coverage Checking
// ============================================================================

/**
 * Configuration for coverage requirements per typeclass.
 */
interface CoverageConfig {
  /** If true, all field types must have instances. Default: true */
  requiresCoverage: boolean;
  /** Custom message when coverage is missing */
  missingMessage?: (fieldName: string, fieldType: string, typeclass: string) => string;
}

const coverageConfigs = new Map<string, CoverageConfig>();

/**
 * Configure coverage requirements for a typeclass.
 */
export function configureCoverage(typeclassName: string, config: CoverageConfig): void {
  coverageConfigs.set(typeclassName, config);
}

/**
 * Get coverage config for a typeclass.
 */
export function getCoverageConfig(typeclassName: string): CoverageConfig {
  return coverageConfigs.get(typeclassName) ?? { requiresCoverage: true };
}

// Default configs for built-in typeclasses
configureCoverage("Show", {
  requiresCoverage: true,
  missingMessage: (field, type, tc) =>
    `Cannot derive ${tc})): field '${field}' has type '${type}' which has no ${tc} instance. ` +
    `Add @instance const show${capitalize(type)}: Show<${type}> = { ... }`,
});

configureCoverage("Eq", {
  requiresCoverage: true,
  missingMessage: (field, type, tc) =>
    `Cannot derive ${tc}: field '${field}' has type '${type}' which has no ${tc} instance.`,
});

configureCoverage("Ord", {
  requiresCoverage: true,
});

configureCoverage("Hash", {
  requiresCoverage: true,
});

configureCoverage("Semigroup", {
  requiresCoverage: true,
});

configureCoverage("Monoid", {
  requiresCoverage: true,
});

// Functor doesn't need element coverage - it only transforms the container
configureCoverage("Functor", {
  requiresCoverage: false,
});

// Generic doesn't need coverage - it's structural
configureCoverage("Generic", {
  requiresCoverage: false,
});

// ============================================================================
// Coverage Validation
// ============================================================================

interface FieldInfo {
  name: string;
  typeName: string;
}

interface CoverageResult {
  valid: boolean;
  missingFields: Array<{
    fieldName: string;
    fieldType: string;
    message: string;
  }>;
}

/**
 * Check coverage for deriving a typeclass on a type.
 *
 * @param typeclassName - The typeclass being derived (e.g., "Show")
 * @param fields - The fields of the type being derived
 * @returns Coverage result with any missing instances
 */
export function checkCoverage(typeclassName: string, fields: FieldInfo[]): CoverageResult {
  const config = getCoverageConfig(typeclassName);

  if (!config.requiresCoverage) {
    return { valid: true, missingFields: [] };
  }

  const missingFields: CoverageResult["missingFields"] = [];

  for (const field of fields) {
    const baseType = normalizeTypeName(field.typeName);

    if (!hasPrimitive(baseType, typeclassName)) {
      const message = config.missingMessage
        ? config.missingMessage(field.name, field.typeName, typeclassName)
        : `Field '${field.name}' of type '${field.typeName}' has no ${typeclassName} instance`;

      missingFields.push({
        fieldName: field.name,
        fieldType: field.typeName,
        message,
      });
    }
  }

  return {
    valid: missingFields.length === 0,
    missingFields,
  };
}

/**
 * Check coverage and report errors via macro context.
 * Returns true if coverage is complete, false if errors were reported.
 */
export function validateCoverageOrError(
  ctx: MacroContext,
  node: ts.Node,
  typeclassName: string,
  typeName: string,
  fields: FieldInfo[]
): boolean {
  const result = checkCoverage(typeclassName, fields);

  if (!result.valid) {
    for (const missing of result.missingFields) {
      ctx.reportError(node, missing.message);
    }

    // Also provide a summary
    const missingTypes = Array.from(new Set(result.missingFields.map((f) => f.fieldType)));
    ctx.reportError(
      node,
      `@derive(${typeclassName}) on '${typeName}' failed: missing instances for types: ${missingTypes.join(", ")}`
    );
  }

  return result.valid;
}

// ============================================================================
// Helpers
// ============================================================================

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Normalize type name for lookup.
 * Handles generics, arrays, etc.
 */
function normalizeTypeName(typeName: string): string {
  // Strip generic parameters: Array<number> → Array
  const baseType = typeName.replace(/<.*>$/, "").trim();

  // Normalize common aliases
  const normalized = baseType.toLowerCase();
  if (normalized === "string") return "string";
  if (normalized === "number") return "number";
  if (normalized === "boolean") return "boolean";
  if (normalized === "bigint") return "bigint";
  if (normalized === "null") return "null";
  if (normalized === "undefined") return "undefined";
  if (normalized === "array") return "Array";

  return baseType;
}

// ============================================================================
// Register Built-in Primitives
// ============================================================================

const builtinPrimitives = [
  // Show
  ["number", "Show"],
  ["string", "Show"],
  ["boolean", "Show"],
  ["bigint", "Show"],
  ["null", "Show"],
  ["undefined", "Show"],
  ["Array", "Show"],

  // Eq
  ["number", "Eq"],
  ["string", "Eq"],
  ["boolean", "Eq"],
  ["bigint", "Eq"],
  ["null", "Eq"],
  ["undefined", "Eq"],
  ["Array", "Eq"],

  // Ord
  ["number", "Ord"],
  ["string", "Ord"],
  ["boolean", "Ord"],
  ["bigint", "Ord"],
  ["Array", "Ord"],

  // Hash
  ["number", "Hash"],
  ["string", "Hash"],
  ["boolean", "Hash"],
  ["bigint", "Hash"],
  ["null", "Hash"],
  ["undefined", "Hash"],
  ["Array", "Hash"],

  // Semigroup
  ["number", "Semigroup"],
  ["string", "Semigroup"],
  ["boolean", "Semigroup"],
  ["Array", "Semigroup"],

  // Monoid
  ["number", "Monoid"],
  ["string", "Monoid"],
  ["boolean", "Monoid"],
  ["Array", "Monoid"],
] as const;

// Register all built-in primitives on module load
for (const [typeName, typeclassName] of builtinPrimitives) {
  registerPrimitive(typeName, typeclassName);
}

// ============================================================================
// Hook into typeclass system
// ============================================================================

// Register hooks so @instance auto-registers primitives
// and @derive can check coverage
setCoverageHooks(registerPrimitive, validateCoverageOrError);

// ============================================================================
// Exports
// ============================================================================

export { primitiveRegistry, CoverageConfig, CoverageResult, FieldInfo };
