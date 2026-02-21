/**
 * @typesugar/prettier-plugin - Prettier plugin for typesugar custom syntax
 *
 * This package provides two layers of functionality:
 *
 * 1. **Prettier Plugin** (default export) - Prevents Prettier from crashing on custom syntax.
 *    Use this when you just need Prettier to work (e.g., in CI format checks).
 *    Output will contain preprocessor artifacts (__binop__, $<F, A>) but is valid TS.
 *
 * 2. **Full Round-Trip Format** (format function) - Formats and preserves custom syntax.
 *    Use this for actual formatting where you want |>, ::, F<_> preserved.
 *
 * @example
 * ```typescript
 * // Using the plugin (prevents crashes, but doesn't preserve custom syntax)
 * // In .prettierrc:
 * // { "plugins": ["@typesugar/prettier-plugin"] }
 *
 * // Using the format function (full round-trip, preserves custom syntax)
 * import { format } from "@typesugar/prettier-plugin";
 *
 * const source = `const x = data |> filter(pred) |> map(fn);`;
 * const formatted = await format(source, { filepath: "example.ts" });
 * // formatted: `const x = data |> filter(pred) |> map(fn);` (properly formatted)
 * ```
 *
 * @packageDocumentation
 */

// Default export: Prettier plugin
export { plugin as default, plugin } from "./plugin.js";
export type { TypesugarPrettierOptions } from "./plugin.js";

// Format function (full round-trip)
export { format, check, getFormatMetadata, type FormatOptions } from "./format.js";

// Pre-format (custom syntax → valid TS)
export {
  preFormat,
  type PreFormatResult,
  type PreFormatOptions,
  type FormatMetadata,
  type HKTParamInfo,
} from "./pre-format.js";

// Post-format (valid TS → custom syntax)
export { postFormat } from "./post-format.js";
