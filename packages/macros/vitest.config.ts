import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/macros",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    globals: true,
  },
});
