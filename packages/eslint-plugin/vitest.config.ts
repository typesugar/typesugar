import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/eslint-plugin",
    globals: true,
    environment: "node",
  },
});
