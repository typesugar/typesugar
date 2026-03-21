/**
 * @typesugar/derive - Compile-time Derivation Macros
 *
 * This package re-exports derive functionality from @typesugar/macros.
 * It provides:
 * - @derive decorator for deriving implementations
 * - Built-in derives: Eq, Ord, Clone, Debug, Hash, Default, Json, Builder, TypeGuard
 * - Utilities for creating custom derives
 *
 * @example
 * ```typescript
 * import { derive, Eq, Debug, Clone } from "@typesugar/derive";
 *
 * @derive(Eq, Debug, Clone)
 * class User {
 *   constructor(public id: number, public name: string) {}
 * }
 *
 * // Now User has equals(), debug(), clone() methods
 * ```
 *
 * @module
 */

// Re-export everything from @typesugar/macros that relates to derivation

// Runtime stub
export { derive } from "@typesugar/macros";

// Derive name symbols for use in @derive() decorators
export { Eq, Ord, Clone, Debug, Hash, Default, Json, Builder, TypeGuard } from "@typesugar/macros";

// For testing and advanced use
export { createDerivedFunctionName } from "@typesugar/macros";

// Custom derive API
export {
  defineCustomDerive,
  defineCustomDeriveAst,
  defineFieldDerive,
  defineTypeFunctionDerive,
} from "@typesugar/macros";

export type { SimpleFieldInfo, SimpleTypeInfo } from "@typesugar/macros";

// Generic programming for structural derivation
export {
  genericDerive,
  registerGeneric,
  getGeneric,
  getGenericMeta,
  registerGenericMeta,
  showProduct,
  showSum,
  eqProduct,
  eqSum,
  ordProduct,
  hashProduct,
  deriveShowViaGeneric,
  deriveEqViaGeneric,
} from "@typesugar/macros";

export type { Product, Sum, Field, Variant, Generic, Rep, GenericMeta } from "@typesugar/macros";

// Auto-derivation via Mirror/Generic
export {
  registerGenericDerivation,
  getGenericDerivation,
  hasGenericDerivation,
  tryDeriveViaGeneric,
  canDeriveViaGeneric,
  clearDerivationCaches,
  makePrimitiveChecker,
} from "@typesugar/macros";

export type { GenericDerivation, DerivationResult } from "@typesugar/macros";
