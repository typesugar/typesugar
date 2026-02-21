import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "unplugin-typesugar",
    globals: true,
    environment: "node",
  },
});
