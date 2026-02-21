import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/specialize",
    globals: true,
    environment: "node",
  },
});
