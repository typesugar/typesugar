import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/named-args",
    include: ["src/__tests__/**/*.test.ts"],
  },
});
