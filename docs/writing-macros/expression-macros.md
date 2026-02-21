# Expression Macros

Expression macros transform function calls at compile time.

## When to Use

- Transform function calls: `myMacro(arg)`
- Evaluate at compile time
- Generate inline code
- Create DSLs with function syntax

## Basic Structure

```typescript
import { defineExpressionMacro, type MacroContext } from "@typesugar/core";
import * as ts from "typescript";

defineExpressionMacro("myMacro", {
  expand(ctx: MacroContext, callExpr: ts.CallExpression): ts.Expression {
    // Transform the call expression
    // Return a new expression to replace it
    return ctx.createNumericLiteral(42);
  },
});

// Runtime placeholder (never actually called)
export function myMacro(): number {
  throw new Error("myMacro() should be compiled away");
}
```

## Tutorial: Creating `assert()`

Let's create an assert macro that throws with the actual expression text.

### Step 1: Define the Macro

```typescript
// src/macros/assert.ts
import { defineExpressionMacro } from "@typesugar/core";
import * as ts from "typescript";

defineExpressionMacro("assert", {
  expand(ctx, callExpr) {
    const condition = callExpr.arguments[0];
    const message = callExpr.arguments[1];

    if (!condition) {
      ctx.reportError(callExpr, "assert() requires a condition");
      return callExpr;
    }

    // Get the source text of the condition
    const conditionText = condition.getText(ctx.sourceFile);

    // Generate: if (!(condition)) throw new Error(message || "Assertion failed: <text>")
    const errorMessage = message ?? ctx.createStringLiteral(`Assertion failed: ${conditionText}`);

    return ctx.factory.createCallExpression(
      ctx.factory.createParenthesizedExpression(
        ctx.factory.createArrowFunction(
          undefined,
          undefined,
          [],
          undefined,
          undefined,
          ctx.factory.createBlock([
            ctx.factory.createIfStatement(
              ctx.factory.createPrefixUnaryExpression(
                ts.SyntaxKind.ExclamationToken,
                ctx.factory.createParenthesizedExpression(condition)
              ),
              ctx.factory.createThrowStatement(
                ctx.factory.createNewExpression(ctx.factory.createIdentifier("Error"), undefined, [
                  errorMessage,
                ])
              )
            ),
          ])
        )
      ),
      undefined,
      []
    );
  },
});

export function assert(condition: boolean, message?: string): void {
  throw new Error("assert() should be compiled away");
}
```

### Step 2: Use It

```typescript
import { assert } from "./macros/assert";

const x = 5;
assert(x > 0);
assert(x < 10, "x must be less than 10");
```

### Step 3: Compiled Output

```javascript
(() => {
  if (!(x > 0)) throw new Error("Assertion failed: x > 0");
})();
(() => {
  if (!(x < 10)) throw new Error("x must be less than 10");
})();
```

## Using Quasiquoting

The factory API is verbose. Use `quote()` for cleaner code:

```typescript
import { defineExpressionMacro } from "@typesugar/core";
import { quote } from "@typesugar/core/quote";

defineExpressionMacro("assert", {
  expand(ctx, callExpr) {
    const condition = callExpr.arguments[0];
    const conditionText = condition?.getText(ctx.sourceFile) ?? "?";
    const message =
      callExpr.arguments[1] ?? ctx.createStringLiteral(`Assertion failed: ${conditionText}`);

    return quote(ctx)`
      (() => {
        if (!(${condition})) throw new Error(${message});
      })()
    `;
  },
});
```

## Accessing Arguments

```typescript
defineExpressionMacro("example", {
  expand(ctx, callExpr) {
    const args = callExpr.arguments;

    // First argument
    const first = args[0];

    // All arguments
    for (const arg of args) {
      console.log(arg.getText(ctx.sourceFile));
    }

    // Type of an argument
    const firstType = ctx.getTypeOf(first);

    // Check argument count
    if (args.length < 2) {
      ctx.reportError(callExpr, "Expected at least 2 arguments");
      return callExpr;
    }

    return first;
  },
});
```

## Type-Aware Macros

Use the type checker for conditional behavior:

```typescript
defineExpressionMacro("stringify", {
  expand(ctx, callExpr) {
    const arg = callExpr.arguments[0];
    const type = ctx.getTypeOf(arg);
    const typeStr = ctx.typeChecker.typeToString(type);

    if (typeStr === "number") {
      return quote(ctx)`${arg}.toString()`;
    } else if (typeStr === "string") {
      return arg; // Already a string
    } else {
      return quote(ctx)`JSON.stringify(${arg})`;
    }
  },
});
```

## Compile-Time Evaluation

Evaluate arguments at compile time:

```typescript
defineExpressionMacro("comptime", {
  expand(ctx, callExpr) {
    const arg = callExpr.arguments[0];

    if (!ctx.isComptime(arg)) {
      ctx.reportError(arg, "Argument must be evaluable at compile time");
      return callExpr;
    }

    const result = ctx.evaluate(arg);

    if (typeof result === "number") {
      return ctx.createNumericLiteral(result);
    } else if (typeof result === "string") {
      return ctx.createStringLiteral(result);
    }
    // ... handle other types

    return callExpr;
  },
});
```

## Error Handling

Always handle edge cases gracefully:

```typescript
defineExpressionMacro("safe", {
  expand(ctx, callExpr) {
    // Check arguments
    if (callExpr.arguments.length === 0) {
      ctx.reportError(callExpr, "Missing required argument");
      return callExpr; // Return original on error
    }

    // Validate argument type
    const arg = callExpr.arguments[0];
    const type = ctx.getTypeOf(arg);

    if (!ctx.isAssignableTo(type, ctx.typeChecker.getStringType())) {
      ctx.reportWarning(arg, "Expected string argument");
    }

    // Transform...
    return arg;
  },
});
```

## Generating Unique Names

For hygienic macros:

```typescript
defineExpressionMacro("swap", {
  expand(ctx, callExpr) {
    const [a, b] = callExpr.arguments;
    const temp = ctx.generateUniqueName("temp");

    return quote(ctx)`
      (() => {
        const ${temp} = ${a};
        ${a} = ${b};
        ${b} = ${temp};
      })()
    `;
  },
});
```

## Best Practices

1. **Validate inputs**: Check argument count and types
2. **Report clear errors**: Use `ctx.reportError()` with helpful messages
3. **Return original on error**: Don't crash, let TypeScript show the error
4. **Use quasiquoting**: Much cleaner than raw factory calls
5. **Generate hygienic names**: Avoid variable capture
6. **Test thoroughly**: Use `@typesugar/testing`

## Next Steps

- [Quasiquoting](./quasiquoting.md) — Building AST with `quote()`
- [Testing Macros](./testing-macros.md) — Verifying macro output
- [MacroContext API](../reference/macro-context.md) — Full API reference
