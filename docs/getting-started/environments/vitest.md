# Vitest Setup

This guide covers setting up typesugar with Vitest for testing.

## Installation

```bash
npm install --save-dev vitest unplugin-typesugar
```

## Configuration

### vitest.config.ts

```typescript
import { defineConfig } from "vitest/config";
import typesugar from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [typesugar()],
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.ts"],
  },
});
```

### Shared Vite Config

If you have a `vite.config.ts`, Vitest will use it by default. You can extend it:

```typescript
// vitest.config.ts
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ["src/**/*.test.ts"],
      coverage: {
        provider: "v8",
      },
    },
  })
);
```

## Writing Tests with Macros

Macros expand before tests run, so you can test both the macro output and the behavior:

```typescript
// src/user.test.ts
import { describe, it, expect } from "vitest";
import { comptime } from "@typesugar/comptime";
import { derive, Eq, Clone } from "@typesugar/derive";

describe("comptime", () => {
  it("evaluates at compile time", () => {
    const value = comptime(2 + 2);
    expect(value).toBe(4);
  });
});

@derive(Eq, Clone)
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}

describe("derive", () => {
  it("generates equals method", () => {
    const p1 = new Point(1, 2);
    const p2 = new Point(1, 2);
    const p3 = new Point(3, 4);

    expect(p1.equals(p2)).toBe(true);
    expect(p1.equals(p3)).toBe(false);
  });

  it("generates clone method", () => {
    const p1 = new Point(1, 2);
    const p2 = p1.clone();

    expect(p2).not.toBe(p1);
    expect(p2.equals(p1)).toBe(true);
  });
});
```

## Testing Macro Output

To test what macros generate, use `@typesugar/testing`:

```typescript
// tests/macros.test.ts
import { describe, it, expect } from "vitest";
import { expandCode, assertExpands } from "@typesugar/testing";

describe("macro expansion", () => {
  it("expands comptime correctly", async () => {
    const result = await expandCode(`
      import { comptime } from "@typesugar/comptime";
      const x = comptime(1 + 1);
    `);

    expect(result.code).toContain("const x = 2");
  });

  it("matches expected output", () => {
    assertExpands(
      `import { comptime } from "@typesugar/comptime"; const x = comptime(21 * 2);`,
      `const x = 42;`
    );
  });
});
```

## Coverage

Vitest's coverage works with typesugar. The source maps preserve original line numbers:

```typescript
// vitest.config.ts
export default defineConfig({
  plugins: [typesugar()],
  test: {
    coverage: {
      provider: "v8", // or "istanbul"
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
    },
  },
});
```

Run with coverage:

```bash
npx vitest --coverage
```

## Workspace Configuration

For monorepos, configure in the workspace root:

```typescript
// vitest.workspace.ts
import { defineWorkspace } from "vitest/config";

export default defineWorkspace(["packages/*/vitest.config.ts"]);
```

Each package can have its own config with the typesugar plugin.

## Watch Mode

```bash
npx vitest        # Watch mode (default)
npx vitest run    # Single run
npx vitest ui     # UI mode
```

## Troubleshooting

### Macros not expanding in tests

1. Verify `unplugin-typesugar/vite` is in plugins
2. Check test file matches `include` pattern
3. Restart Vitest

### Type errors in test files

Add the language service plugin to `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "typesugar/language-service" }]
  }
}
```

### Slow test startup

The first run compiles all macros. Subsequent runs use Vitest's cache:

```bash
# Clear cache if needed
npx vitest --clearCache
```

## Next Steps

- [Editor Setup](../editor-setup.md)
- [Troubleshooting](../troubleshooting.md)
