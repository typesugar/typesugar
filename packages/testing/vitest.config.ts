import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/testing",
    globals: true,
    environment: "node",
  },
});
