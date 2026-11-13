/**
 * @typesugar/typeclass - Scala 3-style Typeclasses
 *
 * This package re-exports typeclass functionality from @typesugar/macros.
 * It provides:
 * - @typeclass for defining typeclass interfaces
 * - @impl for providing instances (`@instance` is a deprecated alias)
 * - @derive for derivation
 * - summon<T>() for compile-time instance resolution
 * - derived<T>() to declare a derived instance for a type you don't own
 * - extend<T>() for extension method syntax
 *
 * @example
 * ```typescript
 * import { derive, summon, extend } from "@typesugar/typeclass";
 *
 * /** @typeclass *\/
 * interface Show<A> {
 *   show(a: A): string;
 * }
 *
 * /** @impl Show<number> *\/
 * const numberShow: Show<number> = {
 *   show: (n) => String(n)
 * };
 *
 * /** @derive(Show, Eq) *\/
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
export {
  typeclass,
  instance,
  derive,
  deriving,
  summon,
  derived,
  extend,
  implicit,
} from "@typesugar/macros";

// Macro definitions (for programmatic use)
export {
  typeclassAttribute,
  implAttribute,
  summonMacro,
  derivedMacro,
  extendMacro,
} from "@typesugar/macros";

// Type exports
export type { TypeclassInfo, TypeclassMethod, InstanceInfo } from "@typesugar/macros";

// Derivation utilities
export { tryExtractSumType, instanceVarName } from "@typesugar/macros";

export type { SyntaxEntry } from "@typesugar/macros";

// HKT support
// (hktTypeclassNames/registerHKTTypeclass were removed in PEP-052 Wave 4 —
// HKT-ness is derived from @typeclass declarations; expansions are keyed per
// ts.Program, so the raw registry map is no longer exported.)
export { registerHKTExpansion } from "@typesugar/macros";
