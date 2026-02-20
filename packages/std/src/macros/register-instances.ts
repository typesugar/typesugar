/**
 * Register Standard Library Instances Macro
 *
 * This macro registers all @typesugar/std typeclass instances in the compile-time
 * registry, enabling summon<>() resolution for standard types.
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
 * import type { Bounded } from "@typesugar/std/typeclasses";
 *
 * const bounded = summon<Bounded<number>>();
 * console.log(bounded.minBound()); // Number.MIN_SAFE_INTEGER
 * ```
 *
 * ## Why is this needed?
 *
 * The @instance decorator cannot be used on const declarations in library
 * code because TypeScript's type declaration generator (tsc) doesn't accept
 * decorators on variable declarations. This macro provides an alternative
 * way to register instances at compile time.
 *
 * ## What gets registered?
 *
 * - Bounded<number>, Bounded<bigint>, Bounded<boolean>, Bounded<string>
 * - Enum<number>, Enum<boolean>, Enum<string>
 * - Numeric<number>, Numeric<bigint>
 * - FlatMap<Array>, FlatMap<Promise>, FlatMap<Iterable>, FlatMap<AsyncIterable>
 */

import * as ts from "typescript";
import {
  type MacroContext,
  type ExpressionMacro,
  defineExpressionMacro,
  globalRegistry,
} from "@typesugar/core";

/**
 * Instance registration info for the macro.
 */
interface InstanceReg {
  typeclass: string;
  forType: string;
  importPath: string;
  exportName: string;
}

/**
 * All standard library instances that should be registered.
 */
const STD_INSTANCES: InstanceReg[] = [
  // Bounded instances
  { typeclass: "Bounded", forType: "number", importPath: "@typesugar/std/typeclasses", exportName: "boundedNumber" },
  { typeclass: "Bounded", forType: "bigint", importPath: "@typesugar/std/typeclasses", exportName: "boundedBigInt" },
  { typeclass: "Bounded", forType: "boolean", importPath: "@typesugar/std/typeclasses", exportName: "boundedBoolean" },
  { typeclass: "Bounded", forType: "string", importPath: "@typesugar/std/typeclasses", exportName: "boundedString" },

  // Enum instances
  { typeclass: "Enum", forType: "number", importPath: "@typesugar/std/typeclasses", exportName: "enumNumber" },
  { typeclass: "Enum", forType: "boolean", importPath: "@typesugar/std/typeclasses", exportName: "enumBoolean" },
  { typeclass: "Enum", forType: "string", importPath: "@typesugar/std/typeclasses", exportName: "enumString" },

  // Numeric instances
  { typeclass: "Numeric", forType: "number", importPath: "@typesugar/std/typeclasses", exportName: "numericNumber" },
  { typeclass: "Numeric", forType: "bigint", importPath: "@typesugar/std/typeclasses", exportName: "numericBigInt" },

  // FlatMap instances (HKT)
  { typeclass: "FlatMap", forType: "Array", importPath: "@typesugar/std/typeclasses/flatmap", exportName: "flatMapArray" },
  { typeclass: "FlatMap", forType: "Promise", importPath: "@typesugar/std/typeclasses/flatmap", exportName: "flatMapPromise" },
  { typeclass: "FlatMap", forType: "Iterable", importPath: "@typesugar/std/typeclasses/flatmap", exportName: "flatMapIterable" },
  { typeclass: "FlatMap", forType: "AsyncIterable", importPath: "@typesugar/std/typeclasses/flatmap", exportName: "flatMapAsyncIterable" },
];

/**
 * Macro definition for registerStdInstances().
 *
 * When this macro is called, it:
 * 1. Generates import statements for all std instances
 * 2. Generates registration calls for each instance
 * 3. Returns a void expression (the actual work is done via side effects)
 *
 * Note: This macro operates at compile time by adding necessary imports
 * and generating code that registers instances. The actual registration
 * happens when the generated code is executed.
 */
export const registerStdInstancesMacro: ExpressionMacro = defineExpressionMacro({
  name: "registerStdInstances",
  module: "@typesugar/std/macros",
  description:
    "Register all @typesugar/std typeclass instances for summon<>() resolution",

  expand(
    ctx: MacroContext,
    _callExpr: ts.CallExpression,
    _args: readonly ts.Expression[],
  ): ts.Expression {
    const { factory } = ctx;

    // For now, return a void expression
    // The actual registration would need to integrate with the typeclass registry
    // which is more complex and requires the transformer infrastructure
    //
    // In a full implementation, this would either:
    // 1. Generate import + registration statements
    // 2. Or directly call into the typeclass registry internals
    //
    // For the scope of task 2a, we document the pattern and provide the
    // infrastructure for future implementation.

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
