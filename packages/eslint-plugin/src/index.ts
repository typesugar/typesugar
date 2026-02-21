/**
 * @typesugar/eslint-plugin
 *
 * ESLint plugin that runs the typesugar macro transformer before linting.
 * This allows ESLint to see the expanded code, eliminating false positives
 * from macro syntax like undefined identifiers in @derive(Eq, Clone).
 *
 * Usage in eslint.config.mjs:
 *
 *   import typesugarPlugin from "@typesugar/eslint-plugin";
 *
 *   export default [
 *     typesugarPlugin.configs.recommended,
 *     // ... your other configs
 *   ];
 *
 * For full macro expansion (slower but more accurate):
 *
 *   import { fullConfig } from "@typesugar/eslint-plugin";
 *
 *   export default [
 *     fullConfig,
 *     // ... your other configs
 *   ];
 */

import type { Linter, ESLint } from "eslint";
import { createProcessor } from "./processor.js";
import { createFullProcessor, clearTransformCache } from "./full-processor.js";

const lightweightProcessor = createProcessor();
const fullProcessor = createFullProcessor();

const plugin: ESLint.Plugin = {
  meta: {
    name: "@typesugar/eslint-plugin",
    version: "0.1.0",
  },

  processors: {
    // Lightweight processor (pattern-based, fast)
    typesugar: lightweightProcessor,
    // Full processor (actual transformer, slower but accurate)
    "typesugar-full": fullProcessor,
  },

  configs: {},

  rules: {},
};

// Flat config presets - Lightweight (fast, pattern-based)
const recommendedConfig: Linter.Config = {
  name: "@typesugar/recommended",
  plugins: {
    "@typesugar": plugin,
  },
  // Process all .ts/.tsx files through the lightweight typesugar processor
  processor: "@typesugar/typesugar",
  languageOptions: {
    parserOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
  },
  rules: {
    // Rules that are redundant after macro expansion
    "no-unused-labels": "off", // requires:/ensures: blocks
    "no-labels": "off",
  },
};

// Full config - uses actual typesugar transformer (slower but accurate)
const fullConfig: Linter.Config = {
  name: "@typesugar/full",
  plugins: {
    "@typesugar": plugin,
  },
  processor: "@typesugar/typesugar-full",
  languageOptions: {
    parserOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
  },
  rules: {
    // With full transformation, we get proper expanded code
    // so most rules can stay enabled
  },
};

// Strict config - enables additional checks
const strictConfig: Linter.Config = {
  ...recommendedConfig,
  name: "@typesugar/strict",
  rules: {
    ...recommendedConfig.rules,
  },
};

// Add configs to the plugin object
(plugin.configs as Record<string, Linter.Config>) = {
  recommended: recommendedConfig,
  full: fullConfig,
  strict: strictConfig,
};

export default plugin;

// Named exports for ESM
export { plugin, recommendedConfig, fullConfig, strictConfig, clearTransformCache };
export type { Linter, ESLint };
