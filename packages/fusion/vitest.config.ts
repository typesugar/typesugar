import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/fusion",
    globals: true,
    environment: "node",
  },
});
