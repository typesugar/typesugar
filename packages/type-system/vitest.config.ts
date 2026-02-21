import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/type-system",
    globals: true,
    environment: "node",
  },
});
