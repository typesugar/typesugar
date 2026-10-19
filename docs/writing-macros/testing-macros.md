# Testing Macros

There are two ways to test a macro:

- **Through the pipeline**: expand a whole source file with `transformCode` from
  `@typesugar/transformer`, then check the diagnostics and run the output.
- **Unit tests of `expand`**: build a `MacroContext` for a snippet with
  `createMacroTestContext` from `@typesugar/testing/macros`, and call your macro's
  `expand` yourself.

Prefer tests that **run** the expanded code. A test that only matches the output text
still passes when the output doesn't compile or does the wrong thing.

## Installation

```bash
npm install --save-dev @typesugar/transformer @typesugar/testing typescript vitest
```

## Registering the Macros Under Test

The transformer only expands macros that are registered. In a test, import the module
that calls `globalRegistry.register(...)` for your macros:

```typescript
import "../src/macros"; // runs globalRegistry.register(...) for each macro
```

The test source then imports the placeholders as a user would, for example
`import { double } from "my-macros"`. The import doesn't have to resolve in the test.
A macro registered with `module: "my-macros"` only expands calls imported from that
module, and a call to a function that isn't imported is never expanded.

The examples on this page use this `double` macro:

```typescript
// src/macros.ts
import { defineExpressionMacro, globalRegistry } from "@typesugar/core";
import * as ts from "typescript";

export const doubleMacro = defineExpressionMacro({
  name: "double",
  module: "my-macros",
  expand(ctx, callExpr, args) {
    const arg = args[0];
    if (!arg) {
      ctx.reportError(callExpr, "double() requires an argument");
      return callExpr;
    }
    return ctx.factory.createBinaryExpression(
      ctx.factory.createParenthesizedExpression(arg),
      ts.SyntaxKind.PlusToken,
      ctx.factory.createParenthesizedExpression(arg)
    );
  },
});

globalRegistry.register(doubleMacro);
```

## Testing Through the Pipeline

`transformCode(code, { fileName })` returns `{ code, diagnostics, changed, ... }`. Each
diagnostic has a `severity` (`"error"`, `"warning"` or `"info"`) and a `message`.
Two small helpers keep the tests short:

```typescript
// tests/helpers.ts
import { transformCode } from "@typesugar/transformer";
import * as ts from "typescript";
import { createRequire } from "node:module";

/** Expand `code` the way a build would. */
export function expand(code: string) {
  const result = transformCode(code, { fileName: "test.ts" });
  return {
    code: result.code,
    errors: result.diagnostics.filter((d) => d.severity === "error").map((d) => d.message),
    warnings: result.diagnostics.filter((d) => d.severity === "warning").map((d) => d.message),
  };
}

/** Run expanded code and return what it logged. */
export function run(code: string): string[] {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const logs: string[] = [];
  const console = { log: (...args: unknown[]) => logs.push(args.map(String).join(" ")) };
  new Function("console", "exports", "require", js)(console, {}, createRequire(import.meta.url));
  return logs;
}
```

`run` executes the output with a `console` that records what was logged. Any imports
left in the output are loaded with `require`, so they must be installed.

### Checking the Output

```typescript
import { describe, it, expect } from "vitest";
import { expand, run } from "./helpers";
import "../src/macros";

describe("double", () => {
  it("expands to an addition", () => {
    const { code, errors } = expand(`
      import { double } from "my-macros";
      const x = double(21);
    `);
    expect(errors).toHaveLength(0);
    expect(code).toContain("const x = (21) + (21);");
  });

  it("produces code that runs", () => {
    const { code } = expand(`
      import { double } from "my-macros";
      console.log(double(21));
    `);
    expect(run(code)).toEqual(["42"]);
  });

  it("leaves a double() from another module alone", () => {
    const { code } = expand(`
      import { double } from "./my-own-double";
      const x = double(21);
    `);
    expect(code).toContain("double(21)");
  });
});
```

### Testing Errors

```typescript
it("reports a missing argument", () => {
  const { errors } = expand(`
    import { double } from "my-macros";
    const x = double();
  `);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain("requires an argument");
});
```

### Testing Warnings

Warnings come back the same way, through `warnings` from the helper:

```typescript
it("warns about a route that doesn't start with /", () => {
  const { warnings } = expand(`
    import { route } from "my-macros";
    class Api {
      @route("users")
      list() {}
    }
  `);
  expect(warnings).toEqual(['[typesugar] route path "users" should start with "/"']);
});
```

Diagnostic messages carry a `[typesugar]` prefix, so match with `toContain` unless you
want the exact text.

### Snapshot Testing

```typescript
it("matches snapshot", () => {
  const { code } = expand(`
    import { derive } from "typesugar";

    @derive(Printable)
    interface Point { x: number; y: number }
  `);
  expect(code).toMatchSnapshot();
});
```

Use snapshots for large output only, and pair them with a test that runs the code.

## Unit-Testing `expand`

`createMacroTestContext(source)` parses `source`, builds a program and type checker for
it, and returns a `MacroContext` with two extra arrays, `errors` and `warnings`, that
collect what the macro reports:

```typescript
import { describe, it, expect } from "vitest";
import { createMacroTestContext } from "@typesugar/testing/macros";
import * as ts from "typescript";
import { doubleMacro } from "../src/macros";

/** Find the first call expression in the context's source file. */
function firstCall(sourceFile: ts.SourceFile): ts.CallExpression {
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (!found && ts.isCallExpression(node)) found = node;
    else ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!found) throw new Error("no call expression in source");
  return found;
}

const print = (node: ts.Node, sf: ts.SourceFile) =>
  ts.createPrinter().printNode(ts.EmitHint.Unspecified, node, sf);

describe("doubleMacro.expand", () => {
  it("builds (x) + (x)", () => {
    const ctx = createMacroTestContext(`double(n * 2);`);
    const call = firstCall(ctx.sourceFile);
    const result = doubleMacro.expand(ctx, call, call.arguments);
    expect(print(result, ctx.sourceFile)).toBe("(n * 2) + (n * 2)");
    expect(ctx.errors).toHaveLength(0);
  });

  it("reports an error and returns the call unchanged", () => {
    const ctx = createMacroTestContext(`double();`);
    const call = firstCall(ctx.sourceFile);
    const result = doubleMacro.expand(ctx, call, call.arguments);
    expect(result).toBe(call);
    expect(ctx.errors).toHaveLength(1);
    expect(ctx.errors[0]).toContain("requires an argument");
  });
});
```

Exporting the definition (`doubleMacro`) as well as registering it is what makes it
reachable from a unit test.

A macro that builds its output with `quote()` produces nodes parsed from a separate
template string. Printing those against `ctx.sourceFile` gives garbled literals, so test
such macros through `transformCode` instead.

## Testing Type-Aware Macros

`transformCode` type-checks the test source with a real program, so type-aware macros
see real types. It uses non-strict compiler options by default (`strict: false`); put
any types the macro needs in the test source:

```typescript
it("stringifies by type", () => {
  const { code } = expand(`
    import { stringify } from "my-macros";
    interface User { name: string; age: number; }
    const u: User = { name: "a", age: 1 };
    const s = stringify(u.age);
  `);
  expect(code).toContain("const s = String(u.age);");
});
```

## Testing Derive Macros

Derives generate a companion. For the built-in `Eq` on a class, that is a
`namespace Point { export const Eq = { equals, notEquals } }`, so test it by calling
`Point.Eq.equals`:

```typescript
it("generates a working Point.Eq instance", () => {
  const { code, errors } = expand(`
    import { derive, Eq } from "typesugar";

    @derive(Eq)
    class Point {
      constructor(public x: number, public y: number) {}
    }

    console.log(Point.Eq.equals(new Point(1, 2), new Point(1, 2)));
    console.log(Point.Eq.equals(new Point(1, 2), new Point(2, 1)));
  `);
  expect(errors).toHaveLength(0);
  expect(code).toContain("namespace Point");
  expect(run(code)).toEqual(["true", "false"]);
});
```

## Project Setup

### vitest.config.ts

The tests call the transformer themselves, so the test files don't need the typesugar
plugin:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
```

### Test File Structure

```
my-macro-package/
  src/
    index.ts        # runtime placeholders
    macros.ts       # macro definitions + globalRegistry.register(...)
  tests/
    helpers.ts
    my-macro.test.ts
  vitest.config.ts
```

## Debugging Failed Tests

Print everything the pipeline returned:

```typescript
import { transformCode } from "@typesugar/transformer";

it("debug expansion", () => {
  const result = transformCode(`...`, { fileName: "test.ts" });

  console.log("=== Expanded Code ===");
  console.log(result.code);

  console.log("=== Diagnostics ===");
  for (const d of result.diagnostics) console.log(d.severity, d.message);
});
```

If the output is unchanged (`result.changed === false`) and there are no diagnostics,
the macro didn't run. Check that the definitions module was imported, that the test
source imports the placeholder, and that `module` matches the import specifier.

## Best Practices

1. **Run the output**: Assert on behaviour, not just on text
2. **Test error cases**: Missing args, wrong types
3. **Test edge cases**: Empty inputs, large inputs
4. **Use snapshots sparingly**: For complex output only
5. **Keep tests focused**: One behaviour per test
6. **Test composition**: Multiple macros together
