# Testing Macros

Use `@typesugar/testing` to verify macro output.

## Installation

```bash
npm install --save-dev @typesugar/testing vitest
```

## Basic Testing

### assertExpands

Check that source expands to expected output:

```typescript
import { describe, it } from "vitest";
import { assertExpands } from "@typesugar/testing";

describe("double macro", () => {
  it("doubles numeric literals", () => {
    assertExpands(
      `import { double } from "./double"; const x = double(21);`,
      `const x = (21) + (21);`
    );
  });
});
```

### expandCode

Get the expanded code as a string:

```typescript
import { expandCode } from "@typesugar/testing";

it("expands correctly", async () => {
  const result = await expandCode(`
    import { double } from "./double";
    const x = double(21);
  `);

  expect(result.code).toContain("(21) + (21)");
  expect(result.errors).toHaveLength(0);
});
```

### expandMacro

Lower-level API for more control:

```typescript
import { expandMacro } from "@typesugar/testing";

it("produces correct AST", async () => {
  const result = await expandMacro(`double(21)`, {
    imports: [`import { double } from "./double"`],
  });

  expect(result.code).toBe("(21) + (21)");
});
```

## Testing Errors

```typescript
it("reports error for missing argument", async () => {
  const result = await expandCode(`
    import { double } from "./double";
    const x = double();
  `);

  expect(result.errors).toContainEqual(
    expect.objectContaining({
      message: expect.stringMatching(/requires an argument/),
    })
  );
});
```

## Testing Warnings

```typescript
it("warns on deprecated usage", async () => {
  const result = await expandCode(`
    import { oldMacro } from "./old-macro";
    oldMacro();
  `);

  expect(result.warnings).toContainEqual(
    expect.objectContaining({
      message: expect.stringMatching(/deprecated/),
    })
  );
});
```

## Snapshot Testing

```typescript
import { expandCode } from "@typesugar/testing";

it("matches snapshot", async () => {
  const result = await expandCode(`
    import { derive, Eq, Debug } from "@typesugar/derive";
    
    @derive(Eq, Debug)
    class Point {
      constructor(public x: number, public y: number) {}
    }
  `);

  expect(result.code).toMatchSnapshot();
});
```

## Testing Type-Aware Macros

Provide type context:

```typescript
import { expandCode } from "@typesugar/testing";

it("handles generic types", async () => {
  const result = await expandCode(
    `
    import { typeAwareMacro } from "./macro";
    
    interface User { name: string; age: number; }
    const fields = typeAwareMacro<User>();
  `,
    {
      compilerOptions: {
        strict: true,
      },
    }
  );

  expect(result.code).toContain('["name", "age"]');
});
```

## Project Setup

### vitest.config.ts

```typescript
import { defineConfig } from "vitest/config";
import typesugar from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [typesugar()],
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
```

### Test File Structure

```
my-macro-package/
  src/
    index.ts
    macros/
      my-macro.ts
  tests/
    my-macro.test.ts
  vitest.config.ts
```

## Testing Derive Macros

```typescript
import { expandCode } from "@typesugar/testing";

describe("Eq derive", () => {
  it("generates equals method", async () => {
    const result = await expandCode(`
      import { derive, Eq } from "@typesugar/derive";
      
      @derive(Eq)
      class Point {
        constructor(public x: number, public y: number) {}
      }
    `);

    expect(result.code).toContain("equals(other");
    expect(result.code).toContain("this.x === other.x");
  });
});
```

## Testing Tagged Templates

```typescript
describe("sql macro", () => {
  it("extracts parameters", async () => {
    const result = await expandCode(`
      import { sql } from "@typesugar/sql";
      const userId = 42;
      const query = sql\`SELECT * FROM users WHERE id = \${userId}\`;
    `);

    expect(result.code).toContain('text: "SELECT * FROM users WHERE id = $1"');
    expect(result.code).toContain("params: [userId]");
  });
});
```

## Debugging Failed Tests

### Get Full Output

```typescript
it("debug expansion", async () => {
  const result = await expandCode(`...`);

  console.log("=== Expanded Code ===");
  console.log(result.code);

  console.log("=== Errors ===");
  console.log(result.errors);

  console.log("=== Warnings ===");
  console.log(result.warnings);
});
```

### Check AST

```typescript
import { expandMacro } from "@typesugar/testing";

it("debug AST", async () => {
  const result = await expandMacro(`myMacro()`, {
    returnAst: true,
  });

  console.log(JSON.stringify(result.ast, null, 2));
});
```

## Integration Tests

Test macros in realistic scenarios:

```typescript
describe("integration", () => {
  it("works with multiple macros", async () => {
    const result = await expandCode(`
      import { comptime } from "@typesugar/comptime";
      import { derive, Eq } from "@typesugar/derive";
      
      const VERSION = comptime("1.0.0");
      
      @derive(Eq)
      class Config {
        constructor(public version: string) {}
      }
      
      const config = new Config(VERSION);
    `);

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('const VERSION = "1.0.0"');
    expect(result.code).toContain("equals(other");
  });
});
```

## Performance Testing

```typescript
import { expandCode } from "@typesugar/testing";

describe("performance", () => {
  it("expands quickly", async () => {
    const start = Date.now();

    await expandCode(`
      // Large code sample...
    `);

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000); // Under 1 second
  });
});
```

## Best Practices

1. **Test happy path first**: Basic functionality
2. **Test error cases**: Missing args, wrong types
3. **Test edge cases**: Empty inputs, large inputs
4. **Use snapshots sparingly**: For complex output only
5. **Keep tests focused**: One assertion per test
6. **Test composition**: Multiple macros together
