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
// Derive Name Markers & Primitive Companions
// ============================================================================
// These identifiers serve two purposes:
//   1. Markers for @derive() decorators — the transformer recognizes them by
//      identifier name (arg.text), never inspecting the runtime value.
//   2. Runtime companion namespaces for primitive typeclass instances, so that
//      generated code like `Eq.number.equals(a, b)` works at runtime. This
//      follows the same companion pattern as user types (`Point.Eq.equals`).
//
// Typeclasses that have primitive instances (Eq, Ord, Hash, Show) are frozen
// objects whose properties are the primitive instances.  Typeclasses without
// primitive instances stay as plain symbols.

import {
  eqNumber,
  eqString,
  eqBoolean,
  eqBigint,
  eqNull,
  eqUndefined,
  eqArray,
  ordNumber,
  ordString,
  ordBoolean,
  ordBigint,
  ordArray,
  hashNumber,
  hashString,
  hashBoolean,
  hashBigint,
  hashNull,
  hashUndefined,
  hashArray,
  showNumber,
  showString,
  showBoolean,
  showBigint,
  showNull,
  showUndefined,
  showArray,
} from "./primitives.js";

/** Derive equality comparison (equals method). Also carries primitive Eq instances. */
export const Eq = Object.freeze({
  number: eqNumber,
  string: eqString,
  boolean: eqBoolean,
  bigint: eqBigint,
  null: eqNull,
  undefined: eqUndefined,
  array: eqArray,
});
/** Derive ordering/comparison (compare method). Also carries primitive Ord instances. */
export const Ord = Object.freeze({
  number: ordNumber,
  string: ordString,
  boolean: ordBoolean,
  bigint: ordBigint,
  array: ordArray,
});
/** Derive deep cloning (clone method) */
export const Clone: unique symbol = Symbol("Clone");
/** Derive debug string representation (debug method) */
export const Debug: unique symbol = Symbol("Debug");
/** Derive hash code generation (hash method). Also carries primitive Hash instances. */
export const Hash = Object.freeze({
  number: hashNumber,
  string: hashString,
  boolean: hashBoolean,
  bigint: hashBigint,
  null: hashNull,
  undefined: hashUndefined,
  array: hashArray,
});
/** Derive default value factory (default static method) */
export const Default: unique symbol = Symbol("Default");
/** Derive JSON serialization (toJson/fromJson methods) */
export const Json: unique symbol = Symbol("Json");
/** Derive builder pattern (builder static method) */
export const Builder: unique symbol = Symbol("Builder");
/** Derive type guard function (isTypeName static method) */
export const TypeGuard: unique symbol = Symbol("TypeGuard");
/** Derive show/display string representation. Also carries primitive Show instances. */
export const Show = Object.freeze({
  number: showNumber,
  string: showString,
  boolean: showBoolean,
  bigint: showBigint,
  null: showNull,
  undefined: showUndefined,
  array: showArray,
});

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
