import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/contracts",
    globals: true,
    environment: "node",
  },
});
