import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/core",
    globals: true,
    environment: "node",
  },
});
