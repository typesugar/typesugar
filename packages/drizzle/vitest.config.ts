import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/drizzle-adapter",
    globals: true,
    environment: "node",
  },
});
