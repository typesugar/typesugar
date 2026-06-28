import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/validate",
    globals: true,
    environment: "node",
  },
});
