# Expression Macros

Expression macros transform function calls at compile time.

## When to Use

- Transform function calls: `myMacro(arg)`
- Evaluate at compile time
- Generate inline code
- Create DSLs with function syntax

## Basic Structure

```typescript
// src/macros.ts
import { defineExpressionMacro, globalRegistry } from "@typesugar/core";

globalRegistry.register(
  defineExpressionMacro({
    name: "myMacro",
    module: "my-macros", // expand only myMacro() imported from "my-macros"
    expand(ctx, callExpr, args) {
      // callExpr: the whole call; args: its arguments
      // Return a new expression to replace the call
      return ctx.createNumericLiteral(42);
    },
  })
);
```

```typescript
// src/index.ts — runtime placeholder (never actually called)
export function myMacro(): number {
  throw new Error("myMacro() should be compiled away");
}
```

`defineExpressionMacro` only builds the definition; `globalRegistry.register` is what makes
the transformer use it. The call is only expanded where the user imports the placeholder;
a call to a function declared in the same file is left alone.

The examples below leave out `module` to stay short, and import their placeholders from a
local `./macros` file.

## Tutorial: Creating `check()`

Let's create an assertion macro that puts the source text of the condition into its error
message. (It's called `check` because these examples leave out `module`, and a macro without a
`module` is matched by its name alone, so it can't share the name `assert` with
`@typesugar/testing`'s. With a `module` it could: see
[Macro identity](./index.md#macro-identity-module-and-export-name).)

### Step 1: Define the Macro

```typescript
// src/macros.ts
import { defineExpressionMacro, globalRegistry } from "@typesugar/core";
import * as ts from "typescript";

globalRegistry.register(
  defineExpressionMacro({
    name: "check",
    expand(ctx, callExpr, args) {
      const [condition, message] = args;
      if (!condition) {
        ctx.reportError(callExpr, "check() requires a condition");
        return callExpr;
      }
      const f = ctx.factory;
      const conditionText = condition.getText(ctx.sourceFile);
      const errorMessage = message ?? ctx.createStringLiteral(`Check failed: ${conditionText}`);

      // (condition) || (() => { throw new Error(message); })()
      const throwIife = f.createCallExpression(
        f.createParenthesizedExpression(
          f.createArrowFunction(
            undefined,
            undefined,
            [],
            undefined,
            f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
            f.createBlock([
              f.createThrowStatement(
                f.createNewExpression(f.createIdentifier("Error"), undefined, [errorMessage])
              ),
            ])
          )
        ),
        undefined,
        []
      );
      return f.createBinaryExpression(
        f.createParenthesizedExpression(condition),
        ts.SyntaxKind.BarBarToken,
        throwIife
      );
    },
  })
);
```

```typescript
// src/index.ts
export function check(condition: boolean, message?: string): void {
  throw new Error("check() should be compiled away");
}
```

### Step 2: Use It

```typescript
import { check } from "./macros";

const x = 5;
check(x > 0);
check(x < 10, "x must be less than 10");
```

### Step 3: Compiled Output

```typescript
const x = 5;
x > 0 ||
  (() => {
    throw new Error("Check failed: x > 0");
  })();
x < 10 ||
  (() => {
    throw new Error("x must be less than 10");
  })();
```

The import of the placeholder is removed once every use of it has been expanded.

## Using Quasiquoting

Building AST with `ctx.factory` is explicit and type-safe, and it is the style this
project uses. For larger expressions, `quote()` from `@typesugar/macros` builds the same
AST from a template, splicing in the nodes you pass:

```typescript
import { defineExpressionMacro, globalRegistry } from "@typesugar/core";
import { quote } from "@typesugar/macros";

globalRegistry.register(
  defineExpressionMacro({
    name: "check",
    expand(ctx, callExpr, args) {
      const [condition, message] = args;
      if (!condition) {
        ctx.reportError(callExpr, "check() requires a condition");
        return callExpr;
      }
      const conditionText = condition.getText(ctx.sourceFile);
      const errorMessage = message ?? ctx.createStringLiteral(`Check failed: ${conditionText}`);
      return quote(ctx)`${condition} || (() => { throw new Error(${errorMessage}); })()`;
    },
  })
);
```

This produces the same output as the factory version. See [Quasiquoting](./quasiquoting.md).

## Accessing Arguments

```typescript
globalRegistry.register(
  defineExpressionMacro({
    name: "example",
    expand(ctx, callExpr, args) {
      // Check argument count first
      if (args.length < 2) {
        ctx.reportError(callExpr, "example() expects at least 2 arguments");
        return callExpr;
      }

      const first = args[0];
      const firstText = first.getText(ctx.sourceFile); // source text of an argument
      const firstType = ctx.getTypeOf(first); // its type

      return first;
    },
  })
);
```

`args` is the same list as `callExpr.arguments`. (For a `chainable` macro, `callExpr` is the
outermost call of the chain and `args` are the root call's arguments.)

By default the macros inside the arguments (`summon<…>()`, extension methods, operators) expand
after your macro, on the expression it returns. That works while the arguments come back
unchanged somewhere in the result. A macro that takes its argument apart and rebuilds it can hide
them: `assert()` wraps every sub-expression as `(values[i] = sub)`, which made
`summon<Show<number>>()` into `(values[i] = summon)()`. Set `expandArgumentsFirst: true` for a
macro like that. `args` are then the arguments with their macros already expanded (nodes a
nested macro generated are synthetic, see `isSyntheticNode`), `callExpr` is still the call as
written, for its source text, and the expression you return is not visited again.

## Type-Aware Macros

Use the type checker for conditional behavior:

```typescript
globalRegistry.register(
  defineExpressionMacro({
    name: "stringify",
    expand(ctx, callExpr, args) {
      const arg = args[0];
      if (!arg) {
        ctx.reportError(callExpr, "stringify() requires an argument");
        return callExpr;
      }
      const f = ctx.factory;
      const type = ctx.getTypeOf(arg);
      if (type.flags & ts.TypeFlags.StringLike) {
        return arg; // already a string
      }
      if (type.flags & ts.TypeFlags.NumberLike) {
        return f.createCallExpression(f.createIdentifier("String"), undefined, [arg]);
      }
      return f.createCallExpression(
        f.createPropertyAccessExpression(f.createIdentifier("JSON"), "stringify"),
        undefined,
        [arg]
      );
    },
  })
);

// stringify("hi")     → "hi"
// stringify(42)       → String(42)
// stringify({ a: 1 }) → JSON.stringify({ a: 1 })
```

## Compile-Time Evaluation

Evaluate arguments at compile time. `ctx.evaluate` returns a `ComptimeValue`, a tagged
object such as `{ kind: "number", value: 42 }` or `{ kind: "error", message }`, so switch on
`kind`:

```typescript
globalRegistry.register(
  defineExpressionMacro({
    name: "constant",
    expand(ctx, callExpr, args) {
      const arg = args[0];
      if (!arg || !ctx.isComptime(arg)) {
        ctx.reportError(
          callExpr,
          "constant() needs an argument that can be evaluated at compile time"
        );
        return callExpr;
      }
      const result = ctx.evaluate(arg);
      switch (result.kind) {
        case "number":
          return ctx.createNumericLiteral(result.value);
        case "string":
          return ctx.createStringLiteral(result.value);
        case "boolean":
          return ctx.createBooleanLiteral(result.value);
        case "error":
          ctx.reportError(arg, result.message);
          return callExpr;
        default:
          ctx.reportError(arg, `constant() cannot inline a ${result.kind} value`);
          return callExpr;
      }
    },
  })
);

// const k = constant(6 * 7);  →  const k = 42;
```

For general compile-time evaluation, use the built-in [`comptime`](../guides/comptime.md)
instead of writing your own.

## Error Handling

Always handle edge cases gracefully:

```typescript
globalRegistry.register(
  defineExpressionMacro({
    name: "safe",
    expand(ctx, callExpr, args) {
      // Check arguments
      if (args.length === 0) {
        ctx.reportError(callExpr, "Missing required argument");
        return callExpr; // Return the original on error
      }

      // Validate the argument type
      const arg = args[0];
      const type = ctx.getTypeOf(arg);
      if (!ctx.isAssignableTo(type, ctx.typeChecker.getStringType())) {
        ctx.reportWarning(arg, "Expected string argument");
      }

      return arg;
    },
  })
);
```

## Generating Unique Names

When a macro introduces a variable, name it with `ctx.generateUniqueName(prefix)` so it
cannot collide with the user's names. This `swap` doesn't need a temporary at all, which is
better still:

```typescript
globalRegistry.register(
  defineExpressionMacro({
    name: "swap",
    expand(ctx, callExpr, args) {
      const [a, b] = args;
      if (!a || !b || !ts.isIdentifier(a) || !ts.isIdentifier(b)) {
        ctx.reportError(callExpr, "swap(a, b) needs two variable names");
        return callExpr;
      }
      const f = ctx.factory;
      // [a, b] = [b, a]
      return f.createBinaryExpression(
        f.createArrayLiteralExpression([a, b]),
        ts.SyntaxKind.EqualsToken,
        f.createArrayLiteralExpression([b, a])
      );
    },
  })
);

// let p = 1, q = 2;
// swap(p, q);  →  [p, q] = [q, p];
```

The [Quasiquoting](./quasiquoting.md#complex-example) page has an example that needs
generated names.

## Best Practices

1. **Validate inputs**: Check argument count and types
2. **Report clear errors**: Use `ctx.reportError()` with helpful messages
3. **Return original on error**: Don't crash, let TypeScript show the error
4. **Build AST with `ctx.factory`**: Use quasiquoting where a template reads better
5. **Generate hygienic names**: Avoid variable capture
6. **Test thoroughly**: Run the expanded code (see [Testing Macros](./testing-macros.md))

## Next Steps

- [Quasiquoting](./quasiquoting.md) — Building AST with `quote()`
- [Testing Macros](./testing-macros.md) — Verifying macro output
- [MacroContext API](../reference/macro-context.md) — Full API reference
