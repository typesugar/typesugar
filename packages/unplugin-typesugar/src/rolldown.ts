/**
 * typesugar Rolldown plugin (also for tsdown, which builds with Rolldown)
 *
 * @example
 * ```ts
 * // tsdown.config.ts
 * import typesugar from "unplugin-typesugar/rolldown";
 *
 * export default defineConfig({
 *   plugins: [typesugar()],
 * });
 * ```
 */

import { unplugin, type TypesugarPluginOptions } from "./unplugin.js";

export default unplugin.rolldown;
export type { TypesugarPluginOptions };
