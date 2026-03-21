import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/std",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/extensions.test.ts"],
  },
});
