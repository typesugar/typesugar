import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/strings",
    globals: true,
    environment: "node",
  },
});
