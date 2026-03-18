/**
 * unplugin-typesugar — Bundler integrations for typesugar
 *
 * This package provides plugins for various bundlers:
 * - Vite: `unplugin-typesugar/vite`
 * - Webpack: `unplugin-typesugar/webpack`
 * - esbuild: `unplugin-typesugar/esbuild`
 * - Rollup: `unplugin-typesugar/rollup`
 *
 * Each plugin uses the typesugar transformer to process TypeScript files
 * during the build, expanding macros at compile time.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import typesugar from "unplugin-typesugar/vite";
 *
 * export default {
 *   plugins: [typesugar()],
 * };
 * ```
 */

export { unplugin, unpluginFactory, type TypesugarPluginOptions } from "./unplugin.js";
