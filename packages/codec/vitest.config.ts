import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/codec",
    include: ["src/__tests__/**/*.test.ts"],
  },
});
