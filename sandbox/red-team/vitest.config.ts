import { defineConfig } from "vitest/config";
import typesugar from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [typesugar({ verbose: true })],
  test: {
    include: ["**/*.test.ts"],
    reporters: ["verbose"],
    testTimeout: 30000,
  },
});
