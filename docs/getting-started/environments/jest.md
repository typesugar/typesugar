# Jest Setup

**There is no working Jest integration in typesugar 1.0. Use [Vitest](./vitest.md)
instead.**

Earlier versions of this page showed a ts-jest `astTransformers` config pointing at
`@typesugar/transformer`. That config does not work: ts-jest requires an AST
transformer module to export `name`, `version` and `factory(tsCompiler, options)`,
and `@typesugar/transformer` exports a ts-patch–style `(program, config, extras)`
factory instead. There is no ts-jest adapter entry point, and nothing in the
typesugar repo tests one.

## Moving to Vitest

Vitest's API is close to Jest's (`describe`, `it`, `expect`, `vi.fn()` in place of
`jest.fn()`), and it runs typesugar through the same Vite plugin you would use for
a build:

```bash
npm install --save-dev vitest unplugin-typesugar @typesugar/transformer
```

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import typesugar from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [typesugar()],
  test: {
    globals: true, // optional: Jest-style global describe/it/expect
  },
});
```

See [Vitest Setup](./vitest.md) for the full guide, including writing tests that
use macros and testing macro output.

## Next Steps

- [Vitest Setup](./vitest.md)
- [Troubleshooting](../troubleshooting.md)
