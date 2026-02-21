import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "typesugar",
    globals: true,
    environment: "node",
  },
});
