import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/effect",
    globals: true,
    environment: "node",
  },
});
