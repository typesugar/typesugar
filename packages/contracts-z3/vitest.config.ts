import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/contracts-z3",
    globals: true,
    environment: "node",
  },
});
