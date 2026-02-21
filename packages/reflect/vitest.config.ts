import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/reflect",
    globals: true,
    environment: "node",
  },
});
