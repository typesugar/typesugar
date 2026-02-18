import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  // Root-level tests (legacy, will be migrated)
  {
    test: {
      name: "legacy",
      include: ["tests/**/*.test.ts"],
      // Exclude broken tests that reference moved code (src/use-cases -> packages)
      // or have TS version compatibility issues
      exclude: [
        "tests/react/**",
        "tests/cats.test.ts",
        "tests/comprehensions.test.ts",
        "tests/effect-do.test.ts",
        "tests/specialize.test.ts",
        "tests/sql.test.ts",
        "tests/testing.test.ts",
        "tests/type-system.test.ts",
        "tests/typeclass.test.ts",
        "tests/units.test.ts",
        "tests/contracts.test.ts",
        "tests/contracts-coq.test.ts",
        "tests/contracts-z3.test.ts",
      ],
      globals: true,
    },
  },
  // Package tests
  "packages/*/vitest.config.ts",
]);
