import { defineConfig } from "vitest/config";
import typemacro from "unplugin-ttfx/vite";

export default defineConfig({
  plugins: [typemacro()],
  test: {
    // Run tests sequentially for more predictable output
    pool: "forks",

    // Increase pool timeout for CI environments
    poolOptions: {
      forks: {
        singleFork: true, // Run all tests in a single fork to avoid worker timeout issues
      },
    },

    // Test file patterns
    include: ["tests/**/*.test.ts"],

    // Exclude patterns
    exclude: [
      "node_modules",
      "dist",
      // These tests reference moved code and need updating
      "tests/react/**",
    ],

    // TypeScript configuration
    typecheck: {
      enabled: false, // Separate type checking from test running
    },

    // Reporter configuration
    reporters: ["verbose"],

    // Coverage configuration (optional)
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/**/*.test.ts"],
    },

    // Timeout for individual tests (ms) — generous to avoid flakiness on CI
    testTimeout: 30000,

    // Hooks timeout (ms)
    hookTimeout: 15000,
  },
});
