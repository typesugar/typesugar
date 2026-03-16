import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/core",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    globals: true,
    environment: "node",
  },
});
