import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/parser",
    globals: true,
    environment: "node",
  },
});
