import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/kysely-adapter",
    globals: true,
    environment: "node",
  },
});
