import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/hlist",
    globals: true,
    environment: "node",
  },
});
