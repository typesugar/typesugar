import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/prettier-plugin",
    include: ["src/**/*.test.ts"],
  },
});
