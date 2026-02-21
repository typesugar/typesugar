import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/operators",
    globals: true,
    environment: "node",
  },
});
