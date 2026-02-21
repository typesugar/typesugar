import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/vscode",
    include: ["test/**/*.test.ts"],
    exclude: ["test/integration/**"],
    globals: true,
    alias: {
      vscode: new URL("./test/mocks/vscode-mock.ts", import.meta.url).pathname,
    },
  },
});
