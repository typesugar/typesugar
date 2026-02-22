/**
 * @typesugar/comptime - Compile-time Evaluation
 *
 * This package re-exports comptime functionality from @typesugar/macros.
 * It provides the `comptime()` macro for evaluating expressions at compile time.
 *
 * @example
 * ```typescript
 * import { comptime } from "@typesugar/comptime";
 *
 * const factorial5 = comptime(() => {
 *   let result = 1;
 *   for (let i = 1; i <= 5; i++) result *= i;
 *   return result;
 * }); // Expands to: const factorial5 = 120;
 * ```
 *
 * @module
 */

// Re-export everything from @typesugar/macros that relates to comptime
export {
  comptime,
  comptimeMacro,
  jsToComptimeValue,
  type ComptimePermissions,
} from "@typesugar/macros";
