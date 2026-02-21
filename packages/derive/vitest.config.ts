import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/derive",
    globals: true,
    environment: "node",
  },
});
