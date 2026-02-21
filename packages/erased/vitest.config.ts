import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/erased",
    include: ["src/__tests__/**/*.test.ts"],
  },
});
