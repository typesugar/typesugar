import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/codec",
    include: ["tests/**/*.test.ts"],
  },
});
