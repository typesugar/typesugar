/**
 * @typesugar/eslint-plugin Showcase
 *
 * Configuration guide and feature reference for the typesugar ESLint plugin.
 *
 * The ESLint plugin preprocesses typesugar source files before linting,
 * so ESLint sees valid TypeScript without macro syntax. This eliminates
 * false positives from decorators, labeled blocks, and custom operators.
 *
 * Install: npm install @typesugar/eslint-plugin
 */

// ============================================================================
// 1. RECOMMENDED CONFIG — Quick setup (fast, pattern-based)
// ============================================================================

// In eslint.config.mjs:
//
//   import typesugarPlugin from "@typesugar/eslint-plugin";
//
//   export default [
//     typesugarPlugin.configs.recommended,
//     // ... your other configs
//   ];
//
// This config:
//   - Registers the lightweight typesugar processor for .ts/.tsx files
//   - Disables `no-unused-labels` (typesugar uses labeled blocks: requires:, ensures:)
//   - Disables `no-labels` (same reason)
//   - Filters false positives for unused typesugar imports

// ============================================================================
// 2. FULL CONFIG — Accurate but slower (actual transformer)
// ============================================================================

// For CI or when accuracy matters more than speed:
//
//   import { fullConfig } from "@typesugar/eslint-plugin";
//
//   export default [
//     fullConfig,
//     // ... your other configs
//   ];
//
// This config:
//   - Runs the actual typesugar transformer (not just pattern matching)
//   - ESLint sees fully expanded code
//   - More accurate but slower — suitable for CI, not real-time linting

// ============================================================================
// 3. STRICT CONFIG — Additional checks
// ============================================================================

// Strict mode extends recommended with additional strictness:
//
//   import { strictConfig } from "@typesugar/eslint-plugin";
//
//   export default [
//     strictConfig,
//     // ... your other configs
//   ];

// ============================================================================
// 4. MANUAL PLUGIN SETUP — Fine-grained control
// ============================================================================

// For projects that need to customize the processor per-glob:
//
//   import typesugarPlugin from "@typesugar/eslint-plugin";
//
//   export default [
//     {
//       files: ["src/**/*.ts"],
//       plugins: {
//         "@typesugar": typesugarPlugin,
//       },
//       processor: "@typesugar/typesugar",
//       rules: {
//         "no-unused-labels": "off",
//         "no-labels": "off",
//       },
//     },
//     {
//       files: ["tests/**/*.ts"],
//       plugins: {
//         "@typesugar": typesugarPlugin,
//       },
//       processor: "@typesugar/typesugar-full",
//     },
//   ];

// ============================================================================
// 5. WHAT THE PROCESSOR HANDLES — Pattern transformations
// ============================================================================

// The lightweight processor (recommended config) handles these patterns:
//
//   Pattern                      Transformation
//   ─────────────────────────── ──────────────────────────────────────────
//   @derive(Eq, Clone)          Commented out: /* @derive(Eq, Clone) */
//   @typeclass(...)             Commented out
//   @instance(...)              Commented out
//   @operators(...)             Commented out
//   @contract(...)              Commented out
//   @reflect                    Commented out
//   requires: { ... }          Commented out (labeled block)
//   ensures: { ... }           Commented out (labeled block)
//   F<_> (HKT syntax)          Preprocessed to valid TS
//   a |> b (pipeline)          Preprocessed to __binop__() call
//   a :: b (cons)              Preprocessed to __binop__() call
//
// The full processor runs the actual transformer for complete expansion.

// ============================================================================
// 6. FALSE POSITIVE FILTERING — Unused import suppression
// ============================================================================

// The processor automatically filters ESLint errors for "unused" typesugar
// imports. These imports are consumed by the transformer at compile time,
// not at runtime, so ESLint incorrectly reports them as unused.
//
// Filtered rules:
//   - no-unused-vars
//   - @typescript-eslint/no-unused-vars
//   - import/no-unused-modules
//   - unused-imports/no-unused-imports
//   - unused-imports/no-unused-vars
//
// Only filtered for imports from:
//   - typesugar
//   - @typesugar/*

// ============================================================================
// 7. PROCESSORS — Two modes of operation
// ============================================================================

// The plugin exports two processors:
//
//   Processor               Speed    Accuracy   Use Case
//   ────────────────────── ──────── ─────────  ─────────────────────
//   @typesugar/typesugar    Fast     Good       IDE real-time linting
//   @typesugar/typesugar-full Slow   Excellent  CI, pre-commit hooks
//
// The fast processor uses regex pattern matching — it handles 90% of cases.
// The full processor runs the actual typesugar transformer — handles 100%.

// ============================================================================
// 8. EXPORTS — What the package provides
// ============================================================================

// Default export:
//   plugin                    ESLint plugin object with processors and configs
//
// Named exports:
//   plugin                    Same as default export
//   recommendedConfig         Pre-built flat config (fast processor)
//   fullConfig                Pre-built flat config (full processor)
//   strictConfig              Pre-built flat config (strict mode)
//   clearTransformCache()     Clear the full processor's transform cache

// ============================================================================
// 9. INTEGRATION WITH OTHER TOOLS
// ============================================================================

// With typescript-eslint:
//
//   import typesugarPlugin from "@typesugar/eslint-plugin";
//   import tseslint from "typescript-eslint";
//
//   export default tseslint.config(
//     typesugarPlugin.configs.recommended,
//     ...tseslint.configs.recommended,
//   );
//
// With Prettier (via eslint-config-prettier):
//
//   import typesugarPlugin from "@typesugar/eslint-plugin";
//   import prettierConfig from "eslint-config-prettier";
//
//   export default [
//     typesugarPlugin.configs.recommended,
//     prettierConfig,
//   ];

export {};
