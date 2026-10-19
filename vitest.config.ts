import { defineConfig } from "vitest/config";
import typesugar from "unplugin-typesugar/vite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    typesugar({
      verbose: false,
      // Globs, matched against the absolute module path (relative ones resolve
      // against the repo root). These used to be substring matches, so
      // "packages/transformer" also covered transformer-core and "tests" covered
      // every tests/ and __tests__/ directory; the globs below keep exactly that
      // set (checked against every tracked .ts/.js file). Test files are
      // therefore NOT macro-expanded by this plugin: they call the transformer
      // programmatically, or exercise the runtime stubs on purpose.
      exclude: [
        // Core defines macros, doesn't use them
        "packages/core/**",
        // The transformer packages test the transformer itself
        "packages/transformer*/**",
        "packages/unplugin-typesugar/**",
        // vscode uses the 'vscode' module, which needs special aliasing
        "packages/vscode/**",
        // Test files (root tests/ and every package's tests/ and __tests__/)
        "**/tests/**",
        "**/__tests__/**",
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
      "**/templates/**", // scaffolding templates (now shipped inside @typesugar/transformer) — example code, not suite tests
      "sandbox/**",
      "packages/vscode/test/integration/**", // VSCode integration tests use @vscode/test-electron
      "packages/vscode/out/**", // Compiled VS Code integration test artifacts
      "integration/**", // Standalone integration tests — run separately via cd integration && npx vitest
    ],

    pool: "forks",

    // Locally: serialize everything to avoid OOM (each fork gets 2GB heap).
    // CI: parallelize across files for speed.
    fileParallelism: !!process.env.CI,

    poolOptions: {
      forks: {
        maxForks: 2,
        minForks: 1,
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
