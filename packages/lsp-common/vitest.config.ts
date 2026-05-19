import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/lsp-common",
    globals: true,
    environment: "node",
  },
});
