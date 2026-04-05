import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 60000,
    hookTimeout: 30000,
    pool: "forks",
    fileParallelism: false, // LSP servers are heavyweight — serialize
  },
});
