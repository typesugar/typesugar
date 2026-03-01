import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/collections",
    globals: true,
    environment: "node",
  },
});
