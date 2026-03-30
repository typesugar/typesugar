import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/lsp-server",
    globals: true,
    environment: "node",
  },
});
