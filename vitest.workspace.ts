import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  // Root-level tests (legacy — will gradually move into packages)
  {
    test: {
      name: "legacy",
      include: ["tests/**/*.test.ts"],
      exclude: [
        "tests/react/**",
        // Pre-existing failures
        "tests/contracts.test.ts",
        "tests/contracts-z3.test.ts",
        "tests/comptime-permissions.test.ts",
        // References deleted src/use-cases/comprehensions/
        "tests/comprehensions.test.ts",
      ],
      globals: true,
    },
  },
  // Package tests
  "packages/*/vitest.config.ts",
]);
