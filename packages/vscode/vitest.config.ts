import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, "test/mocks/vscode-mock.ts"),
    },
  },
  test: {
    name: "@typesugar/vscode",
    include: ["test/**/*.test.ts"],
    exclude: ["test/integration/**"],
    globals: true,
  },
});
