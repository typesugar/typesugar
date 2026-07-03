/**
 * @typesugar/typeclass - Scala 3-style Typeclasses
 *
 * This package re-exports typeclass functionality from @typesugar/macros.
 * It provides:
 * - @typeclass decorator for defining typeclass interfaces
 * - @instance decorator for providing instances
 * - @derive decorator for auto-derivation
 * - summon<T>() for compile-time instance resolution
 * - extend<T>() for extension method syntax
 *
 * @example
 * ```typescript
 * import { typeclass, instance, derive, summon, extend } from "@typesugar/typeclass";
 *
 * @typeclass
 * interface Show<A> {
 *   show(a: A): string;
 * }
 *
 * @instance(Show, Number)
 * const numberShow: Show<number> = {
 *   show: (n) => String(n)
 * };
 *
 * @derive(Show, Eq)
 * interface Point { x: number; y: number }
 *
 * const showPoint = summon<Show<Point>>();
 * extend(myPoint).show();
 * ```
 *
 * @module
 */

// Re-export everything from @typesugar/macros that relates to typeclasses

// Runtime stubs (user-facing functions)
export { typeclass, instance, derive, deriving, summon, extend, implicit } from "@typesugar/macros";

// Macro definitions (for programmatic use)
export {
  typeclassAttribute,
  implAttribute,
  implMacro,
  summonMacro,
  extendMacro,
} from "@typesugar/macros";

// Type exports
export type { TypeclassInfo, TypeclassMethod, InstanceInfo } from "@typesugar/macros";

// Derivation utilities
export { generateStandardTypeclasses, tryExtractSumType, instanceVarName } from "@typesugar/macros";

export type { SyntaxEntry } from "@typesugar/macros";

// HKT support
// (hktTypeclassNames/registerHKTTypeclass were removed in PEP-052 Wave 4 —
// HKT-ness is derived from @typeclass declarations, not a registered name set.)
export { hktExpansionRegistry, registerHKTExpansion } from "@typesugar/macros";
