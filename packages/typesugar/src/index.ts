/**
 * typesugar - TypeScript Compile-Time Macros
 *
 * Scala 3-style metaprogramming for TypeScript. Write macros that transform
 * code at compile time, eliminating runtime overhead while maintaining
 * type safety.
 *
 * ## Quick Start
 *
 * ```ts
 * // Use built-in macros
 * import { derive, ops, pipe, compose } from "typesugar";
 *
 * // Derive pattern implementations at compile time
 * @derive(Eq, Debug, Clone)
 * class User {
 *   constructor(public id: number, public name: string) {}
 * }
 *
 * // Operator overloading
 * @operators
 * class Vec2 {
 *   constructor(public x: number, public y: number) {}
 *   add(other: Vec2) { return new Vec2(this.x + other.x, this.y + other.y); }
 * }
 * const result = ops(v1 + v2); // Compiles to: v1.add(v2)
 *
 * // Function composition
 * const process = pipe(
 *   data,
 *   parse,
 *   validate,
 *   transform
 * ); // Compiles to: transform(validate(parse(data)))
 * ```
 *
 * ## Bundler Integration
 *
 * ```ts
 * // vite.config.ts
 * import typesugar from "unplugin-typesugar/vite";
 *
 * export default {
 *   plugins: [typesugar()],
 * };
 * ```
 *
 * @module
 */

// ============================================================================
// Core types and utilities
// ============================================================================

export * from "@typesugar/core";

// ============================================================================
// All built-in macros
// ============================================================================

// Import macros (this registers them with the global registry)
// Re-export specific items to avoid conflicts with @typesugar/core exports
import "@typesugar/macros";

/**
 * Register all built-in macros to the global registry.
 * Idempotent - can be called multiple times without side effects.
 *
 * This is useful for testing or manual macro registration.
 */
export function registerAllMacros(): void {
  // Importing @typesugar/macros automatically registers all built-in macros
  // This function exists for explicit registration in test setups
  // The actual registration happens when the module loads
}

// Re-export runtime stubs (these are what users typically import)
export {
  // Typeclass runtime stubs
  typeclass,
  instance,
  deriving,
  summon,
  extend,
  // Extension registration
  registerExtensions,
  registerExtension,
  // Comptime
  comptime,
  // Derive
  derive,
  // Operators
  operators,
  ops,
  pipe,
  compose,
  flow,
  // Operator registration and lookup
  registerOperators,
  getOperatorMethod,
  getOperatorString,
  clearOperatorMappings,
  // Specialize
  specialize,
  // Reflect
  reflect,
  typeInfo,
  fieldNames,
  validator,
  // Conditional compilation
  cfg,
  // File includes
  includeStr,
  includeJson,
  // Static assert
  static_assert,
  // Tail recursion
  tailrec,
  // HKT
  hkt,
  // Derive name symbols
  Eq,
  Ord,
  Clone,
  Debug,
  Hash,
  Default,
  Json,
  Builder,
  TypeGuard,
} from "@typesugar/macros";

// ============================================================================
// Namespace exports for backward compatibility
// ============================================================================

// Compile-time evaluation
import * as comptimeNs from "@typesugar/comptime";
export { comptimeNs as comptimeNamespace };

// Reflection and introspection
import * as reflectNs from "@typesugar/reflect";
export { reflectNs as reflectNamespace };

// Derive macros (@derive(Eq, Ord, Debug, ...))
import * as deriveNs from "@typesugar/derive";
export { deriveNs as deriveNamespace };

// Operator overloading (@operators, ops, pipe, compose)
import * as operatorsNs from "@typesugar/operators";
export { operatorsNs as operatorsNamespace };

// Scala 3-style typeclasses (@typeclass, @instance, @deriving, summon, extend)
import * as typeclassNs from "@typesugar/typeclass";
export { typeclassNs as typeclassNamespace };

// Zero-cost specialization (specialize, mono, inlineCall)
import * as specializeNs from "@typesugar/specialize";
export { specializeNs as specializeNamespace };
