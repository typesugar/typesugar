import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/units",
    globals: true,
    environment: "node",
  },
});
