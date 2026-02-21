import { defineConfig } from "vitest/config";
import typemacro from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [typemacro({ verbose: true })],
  test: {
    include: ["**/*.test.ts"],
    reporters: ["verbose"],
    testTimeout: 30000,
  },
});
