import { defineConfig } from "vitest/config";
import typemacro from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [typemacro({ verbose: true })],
  test: {
    pool: "forks",

    poolOptions: {
      forks: {
        maxForks: 2,
        execArgv: ["--max-old-space-size=2048"],
      },
    },

    include: ["tests/**/*.test.ts"],

    exclude: ["node_modules", "dist", "tests/react/**"],

    typecheck: {
      enabled: false,
    },

    reporters: ["verbose"],

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
