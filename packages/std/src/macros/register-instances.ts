/**
 * Register Standard Library Instances Macro
 *
 * This macro registers additional @typesugar/std typeclass instances that cannot
 * use the @instance decorator (e.g., HKT-based typeclasses, instances in other files).
 *
 * NOTE: Most primitive typeclass instances are now registered via @instance
 * decorators directly on the const declarations in @typesugar/std/typeclasses/index.ts.
 * This macro only handles the remaining instances.
 *
 * @example
 * ```typescript
 * // In your application entry point:
 * import { registerStdInstances } from "@typesugar/std/macros";
 *
 * registerStdInstances(); // Macro call - processed at compile time
 *
 * // Now you can use summon<>() for std instances:
 * import { summon } from "@typesugar/typeclass";
 * import type { Bounded, Numeric } from "@typesugar/std/typeclasses";
 *
 * const bounded = summon<Bounded<number>>();
 * console.log(bounded.minBound()); // Number.MIN_SAFE_INTEGER
 *
 * const numeric = summon<Numeric<number>>();
 * console.log(numeric.add(1, 2)); // 3
 *
 * // Operator dispatch works automatically:
 * // a === b → eqNumber.equals(a, b)
 * // a < b  → ordNumber.lessThan(a, b)
 * // a + b  → semigroupNumber.combine(a, b) or numericNumber.add(a, b)
 * ```
 *
 * ## What gets registered?
 *
 * **Via @instance decorators (in @typesugar/std/typeclasses/index.ts):**
 * - Eq<number>, Eq<string>, Eq<boolean>, Eq<bigint>, Eq<Date>
 * - Ord<number>, Ord<string>, Ord<boolean>, Ord<bigint>, Ord<Date>
 * - Semigroup<number>, Semigroup<string>, Semigroup<bigint>
 * - Monoid<number>, Monoid<string>, Monoid<bigint>
 * - Group<number>, Group<bigint>
 * - Bounded<number>, Bounded<bigint>, Bounded<boolean>, Bounded<string>
 * - Enum<number>, Enum<boolean>, Enum<string>
 * - Numeric<number>, Numeric<bigint>
 * - Integral<number>, Integral<bigint>
 * - Fractional<number>
 * - Floating<number>
 *
 * **Via this macro (instances in other files):**
 * - FlatMap<Array>, FlatMap<Promise>, FlatMap<Iterable>, FlatMap<AsyncIterable>
 * - Eq<Range>, Ord<Range>
 */

import * as ts from "typescript";
import {
  type MacroContext,
  type ExpressionMacro,
  defineExpressionMacro,
  globalRegistry,
} from "@typesugar/core";
import { registerInstanceWithMeta, type InstanceInfo } from "@typesugar/macros";

/**
 * Instance registration info for the macro.
 */
interface InstanceReg {
  typeclass: string;
  forType: string;
  importPath: string;
  exportName: string;
}

// ============================================================================
// Typeclass Definitions
// ============================================================================

// Typeclass definitions with Op<> syntax are now registered via @typeclass
// decorators on the interface definitions in @typesugar/std/typeclasses.
// See: Eq, Ord, Semigroup, Monoid, Group, Numeric, Integral, Fractional

// ============================================================================
// Instance Definitions
// ============================================================================

/**
 * Standard library instances that need to be registered via this macro.
 *
 * NOTE: Most primitive typeclass instances (Eq, Ord, Semigroup, Monoid, Group,
 * Bounded, Enum, Numeric, Integral, Fractional, Floating) are now registered
 * via @instance decorators directly on the const declarations in
 * @typesugar/std/typeclasses/index.ts.
 *
 * This array only contains instances that cannot use @instance (e.g., HKT-based
 * typeclasses, instances defined in other files).
 */
const STD_INSTANCES: InstanceReg[] = [
  // FlatMap instances (HKT) — defined in separate flatmap.ts file
  {
    typeclass: "FlatMap",
    forType: "Array",
    importPath: "@typesugar/std/typeclasses/flatmap",
    exportName: "flatMapArray",
  },
  {
    typeclass: "FlatMap",
    forType: "Promise",
    importPath: "@typesugar/std/typeclasses/flatmap",
    exportName: "flatMapPromise",
  },
  {
    typeclass: "FlatMap",
    forType: "Iterable",
    importPath: "@typesugar/std/typeclasses/flatmap",
    exportName: "flatMapIterable",
  },
  {
    typeclass: "FlatMap",
    forType: "AsyncIterable",
    importPath: "@typesugar/std/typeclasses/flatmap",
    exportName: "flatMapAsyncIterable",
  },

  // Data type instances — defined in @typesugar/std/data
  { typeclass: "Eq", forType: "Range", importPath: "@typesugar/std/data", exportName: "eqRange" },
  { typeclass: "Ord", forType: "Range", importPath: "@typesugar/std/data", exportName: "ordRange" },
];

// ============================================================================
// Registration State
// ============================================================================

let _registered = false;

/**
 * Perform the actual registration of instances.
 * This is called at module load time and also can be triggered by the macro.
 *
 * Note: Typeclass definitions are now registered via @typeclass decorators
 * on the interface definitions in @typesugar/std/typeclasses.
 */
function performRegistration(): void {
  if (_registered) return;
  _registered = true;

  // Register all primitive instances
  for (const inst of STD_INSTANCES) {
    const info: InstanceInfo = {
      typeclassName: inst.typeclass,
      forType: inst.forType,
      instanceName: inst.exportName,
      derived: false,
    };
    registerInstanceWithMeta(info);
  }
}

// Auto-register at module load time
performRegistration();

/**
 * Macro definition for registerStdInstances().
 *
 * When this macro is called, it:
 * 1. Ensures typeclass definitions are registered with their Op<> syntax
 * 2. Ensures all primitive instances are registered
 * 3. Returns a void expression (registration happens at module load)
 *
 * Note: Registration actually happens at module load time via performRegistration().
 * The macro call is a no-op but serves as documentation that the user expects
 * the standard instances to be available.
 */
export const registerStdInstancesMacro: ExpressionMacro = defineExpressionMacro({
  name: "registerStdInstances",
  module: "@typesugar/std/macros",
  description:
    "Register all @typesugar/std typeclass instances for summon<>() and operator dispatch",

  expand(
    ctx: MacroContext,
    _callExpr: ts.CallExpression,
    _args: readonly ts.Expression[]
  ): ts.Expression {
    const { factory } = ctx;

    // Registration already happened at module load time.
    // Return a void expression.
    return factory.createVoidExpression(factory.createNumericLiteral("0"));
  },
});

/**
 * Runtime stub for registerStdInstances.
 * This function does nothing at runtime - all work is done at compile time.
 */
export function registerStdInstances(): void {
  // Placeholder - processed by transformer at compile time
}

/**
 * Get the list of standard instances for programmatic access.
 * Useful for documentation or custom registration logic.
 */
export function getStdInstanceDefinitions(): readonly InstanceReg[] {
  return STD_INSTANCES;
}

/**
 * Register the macro with the global registry when this module is imported.
 */
export function register(): void {
  globalRegistry.register(registerStdInstancesMacro);
}

// Auto-register
register();

export default registerStdInstancesMacro;
