import { defineConfig } from "vitest/config";
import typemacro from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [typemacro()],
  test: {
    globals: true,
    environment: "node",
  },
});
