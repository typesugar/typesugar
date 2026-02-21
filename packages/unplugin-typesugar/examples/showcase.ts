/**
 * unplugin-typesugar Showcase
 *
 * Self-documenting examples of bundler integration for typesugar.
 * This package provides plugins for Vite, Rollup, Webpack, and esbuild
 * that run the typesugar preprocessor and transformer during builds.
 *
 * Since unplugin integrations are configuration-driven (not runtime APIs),
 * this showcase demonstrates all configuration patterns and shows the
 * type signatures of each bundler integration.
 *
 * Type assertions used:
 *   typeAssert<Equal<A, B>>()        - A and B are the same type
 *   typeAssert<Extends<A, B>>()      - A is assignable to B
 *   typeAssert<Not<Equal<A, B>>>()   - A and B are DIFFERENT
 *   typeAssert<Not<Extends<A, B>>>() - A is NOT assignable to B
 *
 * Run:   typesugar run examples/showcase.ts
 * Build: npx tspc && node dist/examples/showcase.js
 */

import { assert, typeAssert, type Equal, type Extends, type Not } from "@typesugar/testing";

import {
  unplugin,
  unpluginFactory,
  type TypesugarPluginOptions,
} from "../src/index.js";

// ============================================================================
// 1. PLUGIN OPTIONS - Configuring the Build Integration
// ============================================================================

// TypesugarPluginOptions controls all plugin behavior
const defaultOptions: TypesugarPluginOptions = {};
typeAssert<Equal<typeof defaultOptions, TypesugarPluginOptions>>();

// Full configuration with all options
const fullOptions: TypesugarPluginOptions = {
  tsconfig: "./tsconfig.build.json",
  include: /\.[jt]sx?$/,
  exclude: /node_modules/,
  verbose: true,
  extensions: ["hkt", "pipeline", "cons"],
};

assert(fullOptions.verbose === true);
assert(fullOptions.extensions!.length === 3);
assert(fullOptions.extensions!.includes("hkt"));
assert(fullOptions.extensions!.includes("pipeline"));
assert(fullOptions.extensions!.includes("cons"));

// String array patterns for include/exclude
const stringPatterns: TypesugarPluginOptions = {
  include: ["src/", "lib/"],
  exclude: ["node_modules/", "dist/"],
};

assert((stringPatterns.include as string[]).length === 2);
assert((stringPatterns.exclude as string[]).length === 2);

// Selective syntax extensions — enable only what you need
const hktOnly: TypesugarPluginOptions = {
  extensions: ["hkt"],
};

const pipelineOnly: TypesugarPluginOptions = {
  extensions: ["pipeline"],
};

assert(hktOnly.extensions!.length === 1);
assert(pipelineOnly.extensions!.length === 1);

// ============================================================================
// 2. UNPLUGIN FACTORY - Universal Plugin Creation
// ============================================================================

// unpluginFactory is the raw factory that creates bundler-specific plugins
assert(typeof unpluginFactory === "function");

// unplugin is the created universal plugin with bundler-specific adapters
assert(unplugin !== undefined);

// ============================================================================
// 3. VITE INTEGRATION - Configuration Examples
// ============================================================================

// vite.config.ts — minimal setup:
//
// import typesugar from "unplugin-typesugar/vite";
//
// export default defineConfig({
//   plugins: [typesugar()],
// });

// vite.config.ts — full configuration:
//
// import typesugar from "unplugin-typesugar/vite";
//
// export default defineConfig({
//   plugins: [
//     typesugar({
//       tsconfig: "./tsconfig.app.json",
//       include: /\.tsx?$/,
//       exclude: /node_modules/,
//       verbose: process.env.DEBUG === "1",
//       extensions: ["hkt", "pipeline"],
//     }),
//   ],
// });

// ============================================================================
// 4. ROLLUP INTEGRATION - Configuration Examples
// ============================================================================

// rollup.config.js — minimal setup:
//
// import typesugar from "unplugin-typesugar/rollup";
//
// export default {
//   plugins: [typesugar()],
// };

// rollup.config.js — with options:
//
// import typesugar from "unplugin-typesugar/rollup";
//
// export default {
//   plugins: [
//     typesugar({
//       tsconfig: "./tsconfig.json",
//       extensions: ["hkt", "pipeline", "cons"],
//     }),
//   ],
// };

// ============================================================================
// 5. WEBPACK INTEGRATION - Configuration Examples
// ============================================================================

// webpack.config.js — minimal setup:
//
// const typesugar = require("unplugin-typesugar/webpack");
//
// module.exports = {
//   plugins: [typesugar()],
// };

// webpack.config.js — with options:
//
// const typesugar = require("unplugin-typesugar/webpack");
//
// module.exports = {
//   plugins: [
//     typesugar({
//       verbose: true,
//       extensions: ["pipeline"],
//     }),
//   ],
// };

// ============================================================================
// 6. ESBUILD INTEGRATION - Configuration Examples
// ============================================================================

// build.ts — minimal setup:
//
// import typesugar from "unplugin-typesugar/esbuild";
// import esbuild from "esbuild";
//
// await esbuild.build({
//   entryPoints: ["src/index.ts"],
//   bundle: true,
//   plugins: [typesugar()],
// });

// build.ts — with options:
//
// await esbuild.build({
//   entryPoints: ["src/index.ts"],
//   bundle: true,
//   plugins: [
//     typesugar({
//       tsconfig: "./tsconfig.json",
//       extensions: ["hkt", "cons"],
//     }),
//   ],
// });

// ============================================================================
// 7. PLUGIN LIFECYCLE - What Happens During Build
// ============================================================================

// The plugin follows this lifecycle during a build:
//
// 1. buildStart() — Loads tsconfig.json and creates the TransformationPipeline
//    - Auto-detects tsconfig.json from CWD if not specified
//    - Creates a ts.Program with full type checking capabilities
//
// 2. transformInclude(id) — Decides which files to process
//    - Default include: /\.[jt]sx?$/ (all TS/JS files)
//    - Default exclude: /node_modules/
//    - Configurable via include/exclude options
//
// 3. transform(code, id) — Processes each file through the pipeline
//    - Runs preprocessor (HKT, pipeline, cons rewrites)
//    - Runs macro transformer (expression, attribute, derive macros)
//    - Returns { code, map } or null if unchanged
//
// 4. watchChange(id) — Invalidates cache when files change
//    - Clears cached transformation results
//    - Triggers re-transformation on next access

// ============================================================================
// 8. IMPORTANT LIMITATION - Type Checker in Unplugin Mode
// ============================================================================

// When unplugin preprocesses a file, it creates a fresh ts.SourceFile
// disconnected from the ts.Program. This means the type checker cannot
// resolve types for preprocessed code.
//
// Consequence: @operator dispatch on custom types falls back to default
// semantics (e.g., |> becomes f(a)).
//
// For full type-aware transformation, use ts-patch instead of unplugin:
//
// tsconfig.json:
// {
//   "compilerOptions": {
//     "plugins": [{
//       "transform": "@typesugar/transformer"
//     }]
//   }
// }

console.log("✓ All unplugin-typesugar showcase assertions passed");
