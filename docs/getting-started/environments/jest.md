# Jest Setup

This guide covers setting up typesugar with Jest.

## Installation

```bash
npm install --save-dev jest ts-jest @types/jest @typesugar/transformer ts-patch
```

## Configuration

### jest.config.js

```javascript
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        astTransformers: {
          before: [
            {
              path: "@typesugar/transformer",
              options: { verbose: false },
            },
          ],
        },
      },
    ],
  },
};
```

### jest.config.ts (TypeScript)

```typescript
import type { JestConfigWithTsJest } from "ts-jest";

const config: JestConfigWithTsJest = {
  preset: "ts-jest",
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        astTransformers: {
          before: [
            {
              path: "@typesugar/transformer",
              options: { verbose: false },
            },
          ],
        },
      },
    ],
  },
};

export default config;
```

## ESM Support

For ESM projects:

```javascript
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        astTransformers: {
          before: [
            {
              path: "@typesugar/transformer",
              options: {},
            },
          ],
        },
      },
    ],
  },
};
```

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "esModuleInterop": true,
    "plugins": [{ "name": "typesugar/language-service" }, { "transform": "@typesugar/transformer" }]
  }
}
```

## Writing Tests

```typescript
// src/utils.test.ts
import { comptime } from "@typesugar/comptime";
import { derive, Eq } from "@typesugar/derive";

describe("comptime", () => {
  it("evaluates at compile time", () => {
    const value = comptime(Math.pow(2, 10));
    expect(value).toBe(1024);
  });
});

@derive(Eq)
class User {
  constructor(
    public id: number,
    public name: string
  ) {}
}

describe("derive", () => {
  it("generates equals", () => {
    const u1 = new User(1, "Alice");
    const u2 = new User(1, "Alice");
    expect(u1.equals(u2)).toBe(true);
  });
});
```

## Running Tests

```bash
# Run all tests
npx jest

# Watch mode
npx jest --watch

# With coverage
npx jest --coverage
```

## package.json Scripts

```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  }
}
```

## Next.js Projects

For Next.js with Jest:

```javascript
// jest.config.js
const nextJest = require("next/jest");

const createJestConfig = nextJest({ dir: "./" });

const customJestConfig = {
  testEnvironment: "jest-environment-jsdom",
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        astTransformers: {
          before: ["@typesugar/transformer"],
        },
      },
    ],
  },
};

module.exports = createJestConfig(customJestConfig);
```

## Troubleshooting

### "Cannot find module" errors

1. Check `moduleNameMapper` configuration
2. Ensure path aliases match `tsconfig.json`

### Macros not expanding

1. Verify `astTransformers.before` is configured
2. Check that `@typesugar/transformer` is in dependencies
3. Clear Jest cache: `npx jest --clearCache`

### Type errors

1. Add language service plugin to `tsconfig.json`
2. Use `@ts-jest` comments for Jest-specific typing

### Slow tests

1. Use `--maxWorkers=1` for debugging
2. Enable ts-jest cache: `isolatedModules: true`

```javascript
transform: {
  "^.+\\.tsx?$": [
    "ts-jest",
    {
      isolatedModules: true,
      astTransformers: {
        before: ["@typesugar/transformer"],
      },
    },
  ],
},
```

## Alternative: Vitest

Consider [Vitest](./vitest.md) as an alternative. It's faster, has better ESM support, and works seamlessly with the Vite plugin.

## Next Steps

- [Editor Setup](../editor-setup.md)
- [Troubleshooting](../troubleshooting.md)
