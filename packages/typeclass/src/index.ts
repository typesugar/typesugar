/**
 * @typesugar/typeclass - Scala 3-style Typeclasses
 *
 * This package re-exports typeclass functionality from @typesugar/macros.
 * It provides:
 * - @typeclass decorator for defining typeclass interfaces
 * - @instance decorator for providing instances
 * - @deriving decorator for auto-derivation
 * - summon<T>() for compile-time instance resolution
 * - extend<T>() for extension method syntax
 *
 * @example
 * ```typescript
 * import { typeclass, instance, deriving, summon, extend } from "@typesugar/typeclass";
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
 * @deriving(Show, Eq)
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
export { typeclass, instance, deriving, summon, extend, implicits } from "@typesugar/macros";

// Macro definitions (for programmatic use)
export {
  typeclassAttribute,
  instanceAttribute,
  derivingAttribute,
  summonMacro,
  extendMacro,
} from "@typesugar/macros";

// Type exports
export type { TypeclassInfo, TypeclassMethod, InstanceInfo, ExtensionMethodInfo } from "@typesugar/macros";

// Registry access (for testing and advanced use)
export {
  typeclassRegistry,
  instanceRegistry,
  extensionMethodRegistry,
  findInstance,
  getTypeclass,
  findExtensionMethod,
  getExtensionMethodsForType,
  getAllExtensionMethods,
  registerExtensionMethods,
  clearRegistries,
  getTypeclasses,
  getInstances,
} from "@typesugar/macros";

// Derivation utilities
export {
  builtinDerivations,
  createTypeclassDeriveMacro,
  generateStandardTypeclasses,
  tryExtractSumType,
  instanceVarName,
} from "@typesugar/macros";

// Syntax registry for operator support
export {
  syntaxRegistry,
  getSyntaxForOperator,
  registerTypeclassSyntax,
  clearSyntaxRegistry,
  extractOpFromReturnType,
} from "@typesugar/macros";

export type { BuiltinTypeclassDerivation, SyntaxEntry } from "@typesugar/macros";

// HKT support
export {
  hktTypeclassNames,
  hktExpansionRegistry,
  registerHKTTypeclass,
  registerHKTExpansion,
} from "@typesugar/macros";
