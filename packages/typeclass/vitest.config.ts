import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/typeclass",
    globals: true,
    environment: "node",
  },
});
