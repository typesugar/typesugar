import { defineConfig } from "vitest/config";
import typesugar from "unplugin-typesugar/vite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    typesugar({
      verbose: false,
      exclude: [
        // Don't transform core package - it defines macros, doesn't use them
        "packages/core",
        // Don't transform transformer package tests - they test the transformer itself
        "packages/transformer",
        // Don't transform unplugin tests
        "packages/unplugin-typesugar",
        // Don't transform vscode package - it uses 'vscode' module which needs special aliasing
        "packages/vscode",
        // Don't transform root tests - they programmatically test the transformer
        "tests",
      ],
    }),
  ],
  resolve: {
    alias: {
      // Alias vscode module to mock for testing
      vscode: path.resolve(__dirname, "packages/vscode/test/mocks/vscode-mock.ts"),
    },
  },
  test: {
    projects: [
      // Root-level tests (legacy — will gradually move into packages)
      {
        extends: true,
        test: {
          name: "legacy",
          include: ["tests/**/*.test.ts"],
          globals: true,
        },
      },
      // Package tests
      "packages/*/vitest.config.ts",
    ],

    // Exclude template tests - they're example code, not part of the test suite
    // Also exclude tests that are intentionally excluded in their package configs
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "templates/**",
      "sandbox/**",
      "packages/std/tests/extensions.test.ts", // Temporarily excluded - needs transformer fix
      "packages/vscode/test/integration/**", // VSCode integration tests use @vscode/test-electron
    ],

    pool: "forks",

    // Locally: serialize everything to avoid OOM (each fork gets 2GB heap).
    // CI: parallelize across files for speed.
    fileParallelism: !!process.env.CI,

    poolOptions: {
      forks: {
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
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.d.ts", "**/*.test.ts"],
    },

    testTimeout: 30000,
    hookTimeout: 15000,
  },
});
