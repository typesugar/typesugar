# Writing Macros

This guide explains how to create your own macros for ttfx.

## Overview

A macro is a function that:

1. Receives AST nodes from your source code
2. Returns transformed AST nodes
3. Runs at compile time (not runtime)

## Expression Macro

Expression macros transform function calls.

### Basic Structure

```typescript
import { defineExpressionMacro, globalRegistry } from "@ttfx/core";
import type { MacroContext } from "@ttfx/core";
import * as ts from "typescript";

export const myMacro = defineExpressionMacro({
  name: "my-macro",
  description: "Does something cool",

  expand(ctx: MacroContext, callExpr: ts.CallExpression): ts.Expression {
    const factory = ctx.factory;

    // Get arguments
    const args = callExpr.arguments;

    // Transform and return new AST
    return factory.createStringLiteral("transformed!");
  },
});

// Register the macro
globalRegistry.register(myMacro);

// Export placeholder for users to import
export function myMacro(): string {
  throw new Error("myMacro must be compiled with ttfx transformer");
}
```

### Example: Assert Macro

```typescript
import { defineExpressionMacro, globalRegistry } from "@ttfx/core";
import * as ts from "typescript";

export const assertMacro = defineExpressionMacro({
  name: "assert",
  description: "Compile-time assertion that throws with source location",

  expand(ctx, callExpr) {
    const factory = ctx.factory;
    const [condition, message] = callExpr.arguments;

    // Get source location
    const sourceFile = callExpr.getSourceFile();
    const { line } = sourceFile.getLineAndCharacterOfPosition(callExpr.pos);
    const location = `${sourceFile.fileName}:${line + 1}`;

    // Generate: if (!condition) throw new Error(`${location}: ${message}`)
    return factory.createConditionalExpression(
      condition,
      factory.createToken(ts.SyntaxKind.QuestionToken),
      factory.createVoidZero(),
      factory.createToken(ts.SyntaxKind.ColonToken),
      factory.createCallExpression(
        factory.createIdentifier("(() => { throw new Error(...) })"),
        undefined,
        [],
      ),
    );
  },
});

globalRegistry.register(assertMacro);
```

## Attribute Macro

Attribute macros transform decorated declarations.

### Basic Structure

```typescript
import { defineAttributeMacro, globalRegistry } from "@ttfx/core";
import * as ts from "typescript";

export const myDecorator = defineAttributeMacro({
  name: "my-decorator",
  description: "Transforms a class declaration",

  expand(ctx, node: ts.ClassDeclaration): ts.Statement[] {
    const factory = ctx.factory;

    // Generate additional methods, properties, etc.
    const newMethod = factory.createMethodDeclaration(
      undefined,
      undefined,
      factory.createIdentifier("generatedMethod"),
      undefined,
      undefined,
      [],
      undefined,
      factory.createBlock([]),
    );

    // Return the modified class
    return [
      factory.updateClassDeclaration(
        node,
        node.modifiers,
        node.name,
        node.typeParameters,
        node.heritageClauses,
        [...node.members, newMethod],
      ),
    ];
  },
});

globalRegistry.register(myDecorator);
```

## Tagged Template Macro

Tagged template macros process template literals.

### Basic Structure

```typescript
import { defineTaggedTemplateMacro, globalRegistry } from "@ttfx/core";
import * as ts from "typescript";

export const myTagMacro = defineTaggedTemplateMacro({
  name: "my-tag",
  description: "Processes template literals",

  expand(ctx, taggedTemplate: ts.TaggedTemplateExpression): ts.Expression {
    const factory = ctx.factory;
    const template = taggedTemplate.template;

    if (ts.isNoSubstitutionTemplateLiteral(template)) {
      // Simple template with no interpolations
      const text = template.text;
      // Process and return
      return factory.createStringLiteral(text.toUpperCase());
    }

    if (ts.isTemplateExpression(template)) {
      // Template with interpolations
      const head = template.head.text;
      const spans = template.templateSpans;
      // Process each span...
    }

    return taggedTemplate;
  },
});

globalRegistry.register(myTagMacro);
```

### Example: Regex Validation

```typescript
export const regexMacro = defineTaggedTemplateMacro({
  name: "regex",
  description: "Compile-time validated regular expressions",

  expand(ctx, taggedTemplate) {
    const factory = ctx.factory;
    const template = taggedTemplate.template;

    if (!ts.isNoSubstitutionTemplateLiteral(template)) {
      ctx.reportError(taggedTemplate, "regex`` cannot have interpolations");
      return taggedTemplate;
    }

    const pattern = template.text;

    // Validate at compile time
    try {
      new RegExp(pattern);
    } catch (e) {
      ctx.reportError(taggedTemplate, `Invalid regex: ${e.message}`);
      return taggedTemplate;
    }

    // Return: new RegExp("pattern")
    return factory.createNewExpression(
      factory.createIdentifier("RegExp"),
      undefined,
      [factory.createStringLiteral(pattern)],
    );
  },
});
```

## Labeled Block Macro

Labeled block macros use JavaScript's labeled statements.

### Basic Structure

```typescript
import { defineLabeledBlockMacro, globalRegistry } from "@ttfx/core";
import * as ts from "typescript";

export const myBlockMacro = defineLabeledBlockMacro({
  name: "my-block",
  label: "myLabel",
  description: "Custom block syntax",
  continuationLabels: ["then", "else"],

  expand(ctx, mainBlock, continuation) {
    const factory = ctx.factory;

    // Parse the main block's statements
    if (!ts.isBlock(mainBlock.statement)) {
      ctx.reportError(mainBlock, "Expected a block");
      return mainBlock;
    }

    // Process statements...
    const statements = mainBlock.statement.statements;

    // Generate transformed code
    return factory.createExpressionStatement(
      factory.createCallExpression(/* ... */),
    );
  },
});

globalRegistry.register(myBlockMacro);
```

## MacroContext API

The `MacroContext` provides utilities for macro authors:

```typescript
interface MacroContext {
  // TypeScript compiler API
  factory: ts.NodeFactory;
  typeChecker: ts.TypeChecker;
  program: ts.Program;

  // Error reporting
  reportError(node: ts.Node, message: string): void;
  reportWarning(node: ts.Node, message: string): void;

  // Source file info
  sourceFile: ts.SourceFile;

  // Configuration
  config: MacroTransformerConfig;
}
```

## Best Practices

### 1. Validate Inputs Early

```typescript
expand(ctx, callExpr) {
  if (callExpr.arguments.length !== 2) {
    ctx.reportError(callExpr, "myMacro requires exactly 2 arguments");
    return callExpr; // Return unchanged on error
  }
  // ...
}
```

### 2. Preserve Source Maps

```typescript
// Use setTextRange to preserve source locations
const newNode = factory.createIdentifier("transformed");
ts.setTextRange(newNode, originalNode);
```

### 3. Handle All Cases

```typescript
// Always handle the "else" case
if (ts.isStringLiteral(arg)) {
  // Handle string
} else if (ts.isNumericLiteral(arg)) {
  // Handle number
} else {
  ctx.reportWarning(arg, "Unexpected argument type");
  return callExpr;
}
```

### 4. Provide Good Error Messages

```typescript
ctx.reportError(
  node,
  `Expected a string literal, got ${ts.SyntaxKind[node.kind]}. ` +
    `Example: myMacro("hello")`,
);
```

### 5. Document Your Macro

````typescript
/**
 * Transforms `myMacro(x, y)` into `x + y` at compile time.
 *
 * @example
 * ```typescript
 * const result = myMacro(1, 2);
 * // Compiles to: const result = 1 + 2;
 * ```
 */
export const myMacro = defineExpressionMacro({
  name: "my-macro",
  description: "Adds two values at compile time",
  // ...
});
````

## Testing Macros

```typescript
import { transformFile } from "@ttfx/transformer";

describe("myMacro", () => {
  it("transforms correctly", () => {
    const input = `
      import { myMacro } from "./my-macro";
      const result = myMacro("hello");
    `;

    const output = transformFile(input);

    expect(output).toContain(`const result = "HELLO"`);
  });

  it("reports errors for invalid input", () => {
    const input = `
      import { myMacro } from "./my-macro";
      const result = myMacro(123);
    `;

    expect(() => transformFile(input)).toThrow(/expected a string/i);
  });
});
```

## Next Steps

- [Architecture](./architecture.md) — How the transformer works internally
- [Macro Types](./macro-types.md) — Overview of all macro types
