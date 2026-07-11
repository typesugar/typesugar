import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@typesugar/transformer",
    globals: true,
    environment: "node",
    // templates/ ships inside this package for `typesugar create` (PEP-058
    // Wave 2) — its test files are consumer-example code, not suite tests.
    exclude: ["**/node_modules/**", "**/dist/**", "templates/**"],
  },
});
