import { defineConfig } from "vitest/config";
import typesugar from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [typesugar()],
  test: {
    name: "@typesugar/validate",
    globals: true,
    environment: "node",
  },
});
