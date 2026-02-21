import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/mapper",
    globals: true,
    environment: "node",
  },
});
