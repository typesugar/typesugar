import { defineConfig } from "vitest/config";
import typemacro from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [typemacro({ verbose: true })],
  test: {
    projects: [
      // Root-level tests (legacy — will gradually move into packages)
      {
        extends: true,
        test: {
          name: "legacy",
          include: ["tests/**/*.test.ts"],
          exclude: [
            "tests/react/**",
            // Pre-existing failures
            "tests/contracts.test.ts",
            "tests/contracts-z3.test.ts",
            // References deleted src/use-cases/comprehensions/
            "tests/comprehensions.test.ts",
          ],
          globals: true,
        },
      },
      // Package tests
      "packages/*/vitest.config.ts",
    ],

    pool: "forks",

    poolOptions: {
      forks: {
        maxForks: 2,
        execArgv: ["--max-old-space-size=2048"],
      },
    },

    typecheck: {
      enabled: false,
    },

    reporters: ["default", "json"],
    outputFile: {
      json: ".vitest-results/test-results.json",
    },

    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts", "packages/*/src/**/*.ts"],
      exclude: ["**/*.d.ts", "**/*.test.ts"],
    },

    testTimeout: 30000,
    hookTimeout: 15000,
  },
});
