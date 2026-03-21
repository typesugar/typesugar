/**
 * Derive Name Symbols and Utilities
 *
 * This module exports the derive name symbols used as arguments to @derive()
 * and utility functions for derived function naming conventions.
 *
 * The old defineDeriveMacro-based derive system has been removed (PEP-017 Wave 4).
 * All derivation now goes through the unified @derive attribute macro in typeclass.ts.
 *
 * Usage:
 *   @derive(Eq, Ord, Clone, Debug)
 *   interface Point {
 *     x: number;
 *     y: number;
 *   }
 */

// ============================================================================
// Derive Name Symbols
// ============================================================================
// These are placeholder symbols for use in @derive() decorators.
// The transformer recognizes these by name and invokes the corresponding
// typeclass derivation via the @derive attribute macro.
// They exist to satisfy the LSP and enable autocomplete.

/** Derive equality comparison (equals method) */
export const Eq: unique symbol = Symbol("Eq");
/** Derive ordering/comparison (compare method) */
export const Ord: unique symbol = Symbol("Ord");
/** Derive deep cloning (clone method) */
export const Clone: unique symbol = Symbol("Clone");
/** Derive debug string representation (debug method) */
export const Debug: unique symbol = Symbol("Debug");
/** Derive hash code generation (hash method) */
export const Hash: unique symbol = Symbol("Hash");
/** Derive default value factory (default static method) */
export const Default: unique symbol = Symbol("Default");
/** Derive JSON serialization (toJson/fromJson methods) */
export const Json: unique symbol = Symbol("Json");
/** Derive builder pattern (builder static method) */
export const Builder: unique symbol = Symbol("Builder");
/** Derive type guard function (isTypeName static method) */
export const TypeGuard: unique symbol = Symbol("TypeGuard");

// ============================================================================
// Utility Functions
// ============================================================================

function uncapitalize(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Create a derived function name based on convention
 */
export function createDerivedFunctionName(operation: string, typeName: string): string {
  switch (operation) {
    case "eq":
      return `${uncapitalize(typeName)}Eq`;
    case "ord":
      return `${uncapitalize(typeName)}Ord`;
    case "compare":
      return `${uncapitalize(typeName)}Compare`;
    case "clone":
      return `clone${typeName}`;
    case "debug":
      return `debug${typeName}`;
    case "hash":
      return `hash${typeName}`;
    case "default":
      return `default${typeName}`;
    case "toJson":
      return `${uncapitalize(typeName)}ToJson`;
    case "fromJson":
      return `${uncapitalize(typeName)}FromJson`;
    case "typeGuard":
    case "is":
      return `is${typeName}`;
    default:
      return `${uncapitalize(typeName)}${capitalize(operation)}`;
  }
}

// ============================================================================
// Deprecated: Old derive macros collection
