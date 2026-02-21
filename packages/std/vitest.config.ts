import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/std",
    include: ["src/__tests__/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["src/__tests__/extensions.test.ts"],
  },
});
