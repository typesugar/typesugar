import { defineConfig } from "vitest/config";
import typesugar from "typesugar/vite";

export default defineConfig({
  // Vitest runs the source, so it needs the plugin to expand the macros.
  plugins: [typesugar()],
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
