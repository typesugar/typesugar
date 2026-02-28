/**
 * @typesugar/specialize - Zero-cost Specialization Macros
 *
 * This package re-exports specialization functionality from @typesugar/macros.
 * It provides:
 * - specialize() for creating monomorphized function versions
 * - Utilities for analyzing and inlining function bodies
 *
 * @example
 * ```typescript
 * import { specialize } from "@typesugar/specialize";
 *
 * // Generic sort function with typeclass constraint
 * function sort<T>(items: T[], ord: Ord<T>): T[] {
 *   return [...items].sort((a, b) => ord.compare(a, b));
 * }
 *
 * // Create specialized versions for specific types
 * const sortNumbers = specialize(sort, [numericOrd]);
 * // Compiles to optimized code with inlined comparisons
 * ```
 *
 * @module
 */

// Re-export everything from @typesugar/macros that relates to specialization

// Runtime stub
export { specialize } from "@typesugar/macros";

// Macro definitions
export {
  specializeMacro,
  specializeInlineMacro,
  monoMacro,
  inlineCallMacro,
} from "@typesugar/macros";

// Runtime stubs for specialize$, mono, and inlineCall
export { mono, inlineCall } from "@typesugar/macros";

/**
 * Inline-specialize an expression by replacing dictionary method calls.
 *
 * @example
 * ```typescript
 * // Before:
 * const result = specialize$(arrayMonad, F => F.map([1,2,3], x => x * 2));
 *
 * // After:
 * const result = [1,2,3].map(x => x * 2);
 * ```
 *
 * @param dict - The typeclass dictionary to use for specialization
 * @param expr - A lambda `F => body` where F.method() calls get inlined
 * @returns The specialized result
 */
export function specialize$<T, R>(dict: T, expr: (d: T) => R): R {
  throw new Error(
    "specialize$() is a compile-time macro and requires the typesugar transformer. " +
      "See https://github.com/typesugar/typesugar for setup instructions."
  );
}

// Specialized type utility
export type { Specialized } from "./specialized-type.js";

// Instance method registration (for inlining)
export {
  registerInstanceMethods,
  getInstanceMethods,
  isRegisteredInstance,
} from "@typesugar/macros";

// Inline analysis utilities
export {
  classifyInlineFailure,
  classifyInlineFailureDetailed,
  getInlineFailureHelp,
  flattenReturnsToExpression,
  analyzeForFlattening,
} from "@typesugar/macros";

// Specialization utilities
export {
  createSpecializedFunction,
  SpecializationCache,
  createHoistedSpecialization,
  getResultAlgebra,
} from "@typesugar/macros";

// Type exports
export type {
  ResultAlgebra,
  DictMethodMap,
  DictMethod,
  InlineFailureReason,
  InlineClassification,
  FlattenAnalysis,
  SpecializeOptions,
} from "@typesugar/macros";
