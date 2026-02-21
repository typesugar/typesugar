import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/sql",
    globals: true,
    environment: "node",
  },
});
