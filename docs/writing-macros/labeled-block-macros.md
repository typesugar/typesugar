# Labeled Block Macros

Labeled block macros transform labeled statements like `myLabel: { ... }`.

## When to Use

- Create block-level DSLs
- Implement do-notation
- Build control flow abstractions
- Create scoped transformations

## Basic Structure

```typescript
import { defineLabeledBlockMacro, globalRegistry } from "@typesugar/core";
import * as ts from "typescript";

globalRegistry.register(
  defineLabeledBlockMacro({
    name: "myBlock", // the macro's name (what the activation marker names)
    label: "myLabel", // the label that triggers it; may be an array of aliases
    continuationLabels: ["then"], // optional: a following block it may consume
    expand(ctx, mainBlock, continuation) {
      // mainBlock: the whole `myLabel: { ... }` labeled statement
      // mainBlock.statement: its body, usually a ts.Block
      // continuation: the following `then: { ... }` labeled statement, or undefined

      // Return transformed statement(s)
      return mainBlock.statement;
    },
  })
);
```

`expand` receives at most one continuation. Labels must be valid identifiers that aren't
reserved words, so `try:`, `catch:` and `finally:` can't be used.

## Activation (PEP-052)

Label syntax is import-scoped: a labeled block only expands in files that
import a module carrying a `@syntax-labels <macroName>` JSDoc marker. Ship a
marker module with your macro and point `syntaxModule` at it. The transformer
names it in the TS9224 "label syntax not activated" hint, and an import whose
specifier is exactly that string activates the macro even where modules can't be
resolved:

```typescript
// my-pkg/src/syntax.ts — the activation marker
/**
 * @syntax-labels myBlock
 */
export const __my_pkg_syntax_labels = true;
```

```typescript
globalRegistry.register(
  defineLabeledBlockMacro({
    name: "myBlock",
    label: "myLabel",
    syntaxModule: "my-pkg/syntax", // named in the TS9224 hint
    expand(ctx, mainBlock) {
      return mainBlock.statement; // ...
    },
  })
);
```

Users opt in per file with a side-effect import:

```typescript
import "my-pkg/syntax";
```

The marker tag names the **macro**, not the label, so one marker activates all
of a macro's label aliases. Use one `@syntax-labels` line per macro. The JSDoc must
sit on a real exported declaration (not a bare `export {}`) so it survives `.d.ts`
generation.

Without the import, the block is left alone and the user gets:

```
warning [TS9224] 'measure:' matches the measure macro, but its label syntax is not activated in this file
  = help: Add `import "my-pkg/syntax";` to activate measure: blocks in this file.
```

If the marker module has nothing to run (a marker constant only), set
`erasableSyntaxModule: true`: the activation import is then removed from the output
of every file the transformer changes, so the label syntax costs no runtime import.

### Labels on a `switch`

A macro applies to a label on a block by default. Set `statement: "switch"` for a
label on a `switch` instead, as std's `match: switch (x) { ... }` is:

```typescript
defineLabeledBlockMacro({
  name: "mySwitch",
  label: "mySwitch",
  statement: "switch", // mainBlock.statement is a ts.SwitchStatement
  syntaxModule: "my-pkg/syntax",
  erasableSyntaxModule: true,
  expand(ctx, mainBlock) {
    return mainBlock.statement; // ...
  },
});
```

A label on any other statement is an ordinary JavaScript label and never reaches the
macro, so `mySwitch: for (...)` is left alone.

The examples below all use a helper that returns the block body, or reports an error:

```typescript
import type { MacroContext } from "@typesugar/core";

/** The `{ ... }` of a labeled statement, or undefined if it isn't a block. */
function blockOf(ctx: MacroContext, labeled: ts.LabeledStatement): ts.Block | undefined {
  if (ts.isBlock(labeled.statement)) return labeled.statement;
  ctx.reportError(labeled, `${labeled.label.text}: must be followed by a block { ... }`);
  return undefined;
}
```

When a macro can't expand, it reports why and returns `mainBlock` unchanged, as the examples do.
The transformer then keeps the block and its continuation (`recover: { ... }`, `yield: ...`) in
the output as written, so the editor and `typesugar check` still report errors inside them.

## Tutorial: Creating `measure:`

A block that measures execution time:

```typescript
globalRegistry.register(
  defineLabeledBlockMacro({
    name: "measure",
    label: "measure",
    syntaxModule: "my-pkg/syntax",
    expand(ctx, mainBlock) {
      const block = blockOf(ctx, mainBlock);
      if (!block) return mainBlock;
      const f = ctx.factory;
      const start = ctx.generateUniqueName("start");
      const now = () =>
        f.createCallExpression(
          f.createPropertyAccessExpression(f.createIdentifier("performance"), "now"),
          undefined,
          []
        );

      // const start = performance.now();
      const startDecl = f.createVariableStatement(
        undefined,
        f.createVariableDeclarationList(
          [f.createVariableDeclaration(start, undefined, undefined, now())],
          ts.NodeFlags.Const
        )
      );
      // console.log(`Execution time: ${performance.now() - start}ms`);
      const report = f.createExpressionStatement(
        f.createCallExpression(
          f.createPropertyAccessExpression(f.createIdentifier("console"), "log"),
          undefined,
          [
            f.createTemplateExpression(f.createTemplateHead("Execution time: "), [
              f.createTemplateSpan(
                f.createBinaryExpression(now(), ts.SyntaxKind.MinusToken, start),
                f.createTemplateTail("ms")
              ),
            ]),
          ]
        )
      );
      return [startDecl, block, report];
    },
  })
);
```

Usage:

```typescript
import "my-pkg/syntax";

measure: {
  // Code to measure
  expensiveOperation();
}
```

Compiles to:

```typescript
const __typesugar_start_s0_0__ = performance.now();
{
  expensiveOperation();
}
console.log(`Execution time: ${performance.now() - __typesugar_start_s0_0__}ms`);
```

Returning `block` (the body) rather than `mainBlock` is what drops the `measure:` label.

## Multi-Block Macros

A macro can consume one following block, named in `continuationLabels`:

```typescript
globalRegistry.register(
  defineLabeledBlockMacro({
    name: "attempt",
    label: "attempt",
    continuationLabels: ["recover"],
    syntaxModule: "my-pkg/syntax",
    expand(ctx, mainBlock, continuation) {
      const body = blockOf(ctx, mainBlock);
      if (!body) return mainBlock;
      if (!continuation) {
        ctx.reportError(mainBlock, "attempt: needs a following recover: { ... } block");
        return mainBlock;
      }
      const handler = blockOf(ctx, continuation);
      if (!handler) return mainBlock;

      // try { body } catch (error) { handler }
      const f = ctx.factory;
      return f.createTryStatement(
        body,
        f.createCatchClause(f.createVariableDeclaration("error"), handler),
        undefined
      );
    },
  })
);
```

Usage:

```typescript
attempt: {
  riskyOperation();
}
recover: {
  console.log("failed:", (error as Error).message);
}

// Compiles to:
try {
  riskyOperation();
} catch (error) {
  console.log("failed:", (error as Error).message);
}
```

The `recover:` block uses `error`, which only exists after expansion, so the user's
editor reports it as undefined. Design block syntax so that each block type-checks on its
own where you can.

## Do-Notation Implementation

The `let:`/`yield:` comprehensions in `@typesugar/std` are a labeled block macro
(`letYield`, labels `let` and `seq`, continuation labels `yield`, `pure` and `return`).
Its source, in `packages/std/src/macros/let-yield.ts`, is a full worked example of parsing
bindings out of a block and building a `flatMap`/`map` chain. See the
[Do-Notation Guide](../guides/do-notation.md) for how it is used.

## Accessing Block Statements

Iterate over the statements in the block:

```typescript
globalRegistry.register(
  defineLabeledBlockMacro({
    name: "traced",
    label: "traced",
    syntaxModule: "my-pkg/syntax",
    expand(ctx, mainBlock) {
      const block = blockOf(ctx, mainBlock);
      if (!block) return mainBlock;
      const f = ctx.factory;
      // Before each statement, log its source text.
      const statements = block.statements.flatMap((stmt) => [
        f.createExpressionStatement(
          f.createCallExpression(
            f.createPropertyAccessExpression(f.createIdentifier("console"), "log"),
            undefined,
            [f.createStringLiteral(`> ${stmt.getText(ctx.sourceFile)}`)]
          )
        ),
        stmt,
      ]);
      return f.createBlock(statements, true);
    },
  })
);

// traced: { const a = 1; console.log(a + 1); }
// → { console.log("> const a = 1;"); const a = 1; console.log("> console.log(a + 1);"); console.log(a + 1); }
```

## Conditional Blocks

Handle an optional continuation:

```typescript
globalRegistry.register(
  defineLabeledBlockMacro({
    name: "when",
    label: "when",
    continuationLabels: ["otherwise"],
    syntaxModule: "my-pkg/syntax",
    expand(ctx, mainBlock, continuation) {
      const block = blockOf(ctx, mainBlock);
      if (!block) return mainBlock;
      // The first statement of the block is the condition.
      const [first, ...rest] = block.statements;
      if (!first || !ts.isExpressionStatement(first)) {
        ctx.reportError(mainBlock, "when: must start with a condition expression");
        return mainBlock;
      }
      const otherwise = continuation ? blockOf(ctx, continuation) : undefined;
      return ctx.factory.createIfStatement(
        first.expression,
        ctx.factory.createBlock(rest, true),
        otherwise
      );
    },
  })
);
```

```typescript
when: {
  n > 3;
  console.log("big");
}
otherwise: {
  console.log("small");
}

// Compiles to:
if (n > 3) {
  console.log("big");
} else {
  console.log("small");
}
```

## Error Handling

```typescript
globalRegistry.register(
  defineLabeledBlockMacro({
    name: "strict",
    label: "strict",
    syntaxModule: "my-pkg/syntax",
    expand(ctx, mainBlock) {
      const block = blockOf(ctx, mainBlock);
      if (!block) return mainBlock;
      if (block.statements.length === 0) {
        ctx.reportWarning(mainBlock, "empty strict: block");
      }
      for (const stmt of block.statements) {
        if (
          ts.isVariableStatement(stmt) &&
          !(stmt.declarationList.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const))
        ) {
          ctx.reportError(stmt, "var is not allowed in a strict: block; use let or const");
        }
      }
      return block;
    },
  })
);

// strict: { var x = 1; }  →  error: var is not allowed in a strict: block; use let or const
```

## Testing Labeled Block Macros

The test source has to import the activation marker. When the marker can't be resolved
(as with an in-memory test file), an import whose specifier exactly matches the macro's
`syntaxModule` still activates it:

```typescript
import { describe, it, expect } from "vitest";
import { transformCode } from "@typesugar/transformer";
import "../src/macros"; // registers measure, with syntaxModule: "my-pkg/syntax"

describe("measure block", () => {
  it("wraps code with timing", () => {
    const result = transformCode(
      `
      import "my-pkg/syntax";
      declare function doSomething(): void;
      measure: {
        doSomething();
      }
      `,
      { fileName: "test.ts" }
    );
    expect(result.code).toContain("performance.now()");
    expect(result.code).toContain("doSomething()");
    expect(result.code).toContain("Execution time");
    expect(result.code).not.toContain("measure:");
  });
});
```

## Best Practices

1. **Generate hygienic names**: Use `ctx.generateUniqueName()`
2. **Check the body is a block**: `mainBlock.statement` can be any statement
3. **Handle empty blocks**: Check `block.statements.length`
4. **Preserve statement order**: Be careful when reordering
5. **Document syntax**: Explain what goes in the block
6. **Ship an activation marker**: And set `syntaxModule` so the TS9224 hint names it

## Limitations

- Labels must be valid identifiers, and not reserved words
- At most one continuation block per macro
- Block must be a statement (not expression position)

## Next Steps

- [Expression Macros](./expression-macros.md) — Function call macros
- [Do-Notation Guide](../guides/do-notation.md) — Using labeled blocks
- [Testing Macros](./testing-macros.md) — Verifying macro output
