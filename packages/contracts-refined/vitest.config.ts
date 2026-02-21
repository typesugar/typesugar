import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/contracts-refined",
    globals: true,
    environment: "node",
  },
});
