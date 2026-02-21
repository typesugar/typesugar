/**
 * ESLint configuration for typesugar monorepo
 *
 * Uses @typesugar/eslint-plugin to handle macro syntax properly.
 * The plugin runs macro transformation before linting, so ESLint
 * sees expanded TypeScript instead of macro syntax.
 */

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

// Once built, import the plugin:
// import typesugarPlugin from "@typesugar/eslint-plugin";

// For now, use a simple config without the plugin
// (the plugin needs to be built first)

export default tseslint.config(
  // Ignore build artifacts
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/.turbo/**", "**/coverage/**"],
  },

  // Base config for all files
  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  // TypeScript files config
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        experimentalDecorators: true,
      },
    },
    rules: {
      // typesugar-specific overrides for macro syntax
      // These will be unnecessary once @typesugar/eslint-plugin is used

      // Allow labeled blocks (requires:/ensures:)
      "no-labels": "off",
      "no-unused-labels": "off",

      // Decorators use identifiers that exist at compile-time only
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_|Show|Eq|Ord|Clone|Debug|Json|Builder|Default|TypeGuard|Hash",
        },
      ],

      // Macros generate code that may look empty
      "@typescript-eslint/no-empty-function": "off",

      // Type re-declarations happen in macro expansion
      "no-redeclare": "off",
      "@typescript-eslint/no-redeclare": "off",

      // Some macro patterns use type assertions
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },

  // Example files - more relaxed rules
  {
    files: ["**/examples/**/*.ts", "**/examples/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "no-console": "off",
    },
  },

  // Test files
  {
    files: ["**/tests/**/*.ts", "**/*.test.ts", "**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  }
);
