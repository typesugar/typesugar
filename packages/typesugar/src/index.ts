/**
 * typemacro - TypeScript Compile-Time Macros
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
 * import typemacro from "typemacro/vite";
 *
 * export default {
 *   plugins: [typemacro()],
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
// Built-in macros (namespaces)
// ============================================================================

// Compile-time evaluation
import * as comptimeNs from "@typesugar/comptime";
export { comptimeNs as comptime };

// Reflection and introspection
import * as reflectNs from "@typesugar/reflect";
export { reflectNs as reflect };

// Derive macros (@derive(Eq, Ord, Debug, ...))
import * as deriveNs from "@typesugar/derive";
export { deriveNs as deriveMacros };

// Re-export derive name symbols for use in @derive() decorators
export { Eq, Ord, Clone, Debug, Hash, Default, Json, Builder, TypeGuard } from "@typesugar/derive";

// Operator overloading (@operators, ops, pipe, compose)
import * as operatorsNs from "@typesugar/operators";
export { operatorsNs as operators };

// Scala 3-style typeclasses (@typeclass, @instance, @deriving, summon, extend)
import * as typeclassNs from "@typesugar/typeclass";
export { typeclassNs as typeclass };

// Zero-cost specialization (specialize, mono, inlineCall)
import * as specializeNs from "@typesugar/specialize";
export { specializeNs as specialize };

// ============================================================================
// Direct exports of commonly used callable macros
// ============================================================================

// Re-export the callable comptime function directly
export { comptime as comptimeEval } from "@typesugar/comptime";

// Re-export operator functions directly
export { ops, pipe, compose } from "@typesugar/operators";

// ============================================================================
// Decorator placeholder functions
// These are processed by the transformer at compile time
// ============================================================================

/**
 * Decorator to derive implementations automatically.
 *
 * @param derives - Names of derive macros to apply (Eq, Ord, Clone, Debug, Hash, Default, Json, Builder, TypeGuard)
 *
 * @example
 * ```typescript
 * @deriveDecorator(Eq, Clone, Debug)
 * interface Point { x: number; y: number; }
 * // Generates: pointEquals(), clonePoint(), debugPoint()
 * ```
 */
export function deriveDecorator(..._derives: unknown[]): ClassDecorator & PropertyDecorator {
  return () => {};
}

// Also export as "derive" for decorator usage: @derive(Eq, Clone)
export { deriveDecorator as derive };

// ============================================================================
// Register all macros function
// ============================================================================

/**
 * Register all built-in macros with the global registry.
 * Call this at the start of your build to enable all built-in macros.
 */
export function registerAllMacros(): void {
  comptimeNs.register();
  reflectNs.register();
  deriveNs.register();
  operatorsNs.register();
  typeclassNs.register();
  specializeNs.register();
}
