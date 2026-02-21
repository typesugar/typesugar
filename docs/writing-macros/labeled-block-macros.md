# Labeled Block Macros

Labeled block macros transform labeled statements like `myLabel: { ... }`.

## When to Use

- Create block-level DSLs
- Implement do-notation
- Build control flow abstractions
- Create scoped transformations

## Basic Structure

```typescript
import { defineLabeledBlockMacro } from "@typesugar/core";
import * as ts from "typescript";

defineLabeledBlockMacro("myLabel", {
  expand(ctx, block: ts.Block, continuation?: ts.Block): ts.Statement | ts.Statement[] {
    // block: the labeled block content
    // continuation: optional following block (for multi-block macros)

    // Return transformed statement(s)
    return block;
  },
});
```

## Tutorial: Creating `measure:`

A block that measures execution time:

```typescript
import { defineLabeledBlockMacro } from "@typesugar/core";
import { quote, quoteStatements, ident } from "@typesugar/core/quote";

defineLabeledBlockMacro("measure", {
  expand(ctx, block) {
    const startVar = ctx.generateUniqueName("start");
    const endVar = ctx.generateUniqueName("end");

    return quoteStatements(ctx)`
      const ${startVar} = performance.now();
      ${block}
      const ${endVar} = performance.now();
      console.log(\`Execution time: \${${endVar} - ${startVar}}ms\`);
    `;
  },
});
```

Usage:

```typescript
measure: {
  // Code to measure
  expensiveOperation();
}
```

Compiles to:

```javascript
const __start_1 = performance.now();
{
  expensiveOperation();
}
const __end_1 = performance.now();
console.log(`Execution time: ${__end_1 - __start_1}ms`);
```

## Multi-Block Macros

Some macros work with multiple consecutive blocks:

```typescript
defineLabeledBlockMacro("try", {
  continuationLabels: ["catch", "finally"],

  expand(ctx, tryBlock, catchBlock, finallyBlock) {
    return quote(ctx)`
      try ${tryBlock}
      ${catchBlock ? quote(ctx)`catch (e) ${catchBlock}` : ""}
      ${finallyBlock ? quote(ctx)`finally ${finallyBlock}` : ""}
    `;
  },
});
```

Usage:

```typescript
try: {
  riskyOperation();
}
catch: {
  console.error(e);
}
finally: {
  cleanup();
}
```

## Do-Notation Implementation

The `let:`/`yield:` blocks are implemented as labeled block macros:

```typescript
defineLabeledBlockMacro("let", {
  continuationLabels: ["yield"],

  expand(ctx, letBlock, yieldBlock) {
    // Parse bindings from letBlock
    const bindings = parseBindings(ctx, letBlock);

    // Build nested flatMap/map calls
    let result = yieldBlock.statements[0];

    for (let i = bindings.length - 1; i >= 0; i--) {
      const { name, expr, isLast } = bindings[i];
      const method = isLast ? "map" : "flatMap";

      result = quote(ctx)`
        ${expr}.${ident(method)}(${ident(name)} => ${result})
      `;
    }

    return result;
  },
});
```

## Accessing Block Statements

Iterate over statements in the block:

```typescript
defineLabeledBlockMacro("log", {
  expand(ctx, block) {
    const loggedStatements = block.statements
      .map((stmt) => {
        // Wrap each statement with logging
        return quoteStatements(ctx)`
        console.log("Executing...");
        ${stmt}
      `;
      })
      .flat();

    return ctx.factory.createBlock(loggedStatements, true);
  },
});
```

## Variable Bindings

Create bindings within the block scope:

```typescript
defineLabeledBlockMacro("withContext", {
  expand(ctx, block) {
    const contextVar = ctx.generateUniqueName("ctx");

    return quoteStatements(ctx)`
      const ${contextVar} = createContext();
      try {
        ${block}
      } finally {
        ${contextVar}.dispose();
      }
    `;
  },
});
```

## Conditional Blocks

Handle optional blocks:

```typescript
defineLabeledBlockMacro("when", {
  continuationLabels: ["otherwise"],

  expand(ctx, whenBlock, otherwiseBlock) {
    // First statement should be a condition
    const condition = whenBlock.statements[0];
    const body = whenBlock.statements.slice(1);

    if (otherwiseBlock) {
      return quote(ctx)`
        if (${condition}) {
          ${body}
        } else {
          ${otherwiseBlock}
        }
      `;
    }

    return quote(ctx)`
      if (${condition}) {
        ${body}
      }
    `;
  },
});
```

## Pattern Matching in Blocks

Parse custom syntax within blocks:

```typescript
defineLabeledBlockMacro("match", {
  expand(ctx, block) {
    // Expect: match: { value; case1 => expr1; case2 => expr2; }
    const statements = block.statements;

    // First statement is the value to match
    const matchValue = statements[0];

    // Rest are cases
    const cases = statements.slice(1).map(parseCase);

    // Generate switch statement
    return ctx.factory
      .createSwitchStatement
      /* ... */
      ();
  },
});
```

## Error Handling

```typescript
defineLabeledBlockMacro("strict", {
  expand(ctx, block) {
    if (block.statements.length === 0) {
      ctx.reportWarning(block, "Empty strict block");
      return block;
    }

    // Validate each statement...
    for (const stmt of block.statements) {
      if (!isValidStatement(stmt)) {
        ctx.reportError(stmt, "Invalid statement in strict block");
      }
    }

    return block;
  },
});
```

## Testing Labeled Block Macros

```typescript
import { expandCode } from "@typesugar/testing";

describe("measure block", () => {
  it("wraps code with timing", async () => {
    const result = await expandCode(`
      measure: {
        doSomething();
      }
    `);

    expect(result.code).toContain("performance.now()");
    expect(result.code).toContain("doSomething()");
    expect(result.code).toContain("Execution time");
  });
});
```

## Best Practices

1. **Generate hygienic names**: Use `ctx.generateUniqueName()`
2. **Handle empty blocks**: Check `block.statements.length`
3. **Preserve statement order**: Be careful when reordering
4. **Document syntax**: Explain what goes in the block
5. **Support multi-block**: Use `continuationLabels` when needed

## Limitations

- Labels must be valid identifiers
- Cannot nest labeled blocks with same label
- Block must be a statement (not expression position)

## Next Steps

- [Expression Macros](./expression-macros.md) — Function call macros
- [Do-Notation Guide](../guides/do-notation.md) — Using labeled blocks
- [Testing Macros](./testing-macros.md) — Verifying macro output
