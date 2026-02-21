import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "out/test/integration/**/*.test.js",
  version: "stable",
  workspaceFolder: "./test-fixtures/sample-project",
  mocha: {
    ui: "tdd",
    timeout: 60000,
  },
});
