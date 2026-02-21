import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/transformer",
    globals: true,
    environment: "node",
  },
});
