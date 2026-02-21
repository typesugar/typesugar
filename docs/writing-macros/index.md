# Writing Macros

This section covers creating custom macros for typesugar.

## Macro Types

| Type                                           | Trigger             | Use Case                     |
| ---------------------------------------------- | ------------------- | ---------------------------- |
| [Expression](./expression-macros.md)           | `myMacro(...)`      | Transform function calls     |
| [Attribute](./attribute-macros.md)             | `@myMacro`          | Transform decorated items    |
| [Derive](./derive-macros.md)                   | `@derive(MyDerive)` | Generate code from types     |
| [Tagged Template](./tagged-template-macros.md) | `` tag`...` ``      | Process template literals    |
| [Type](./type-macros.md)                       | `MyType<T>`         | Transform type references    |
| [Labeled Block](./labeled-block-macros.md)     | `label: { }`        | Transform labeled statements |

## Tutorials

1. [Expression Macros](./expression-macros.md) — Your first macro
2. [Attribute Macros](./attribute-macros.md) — Decorators that transform
3. [Derive Macros](./derive-macros.md) — Code generation from types
4. [Tagged Template Macros](./tagged-template-macros.md) — DSLs in templates
5. [Type Macros](./type-macros.md) — Type-level transformations
6. [Labeled Block Macros](./labeled-block-macros.md) — Block-level syntax

## Techniques

- [Quasiquoting](./quasiquoting.md) — Building AST with `quote()`
- [Testing Macros](./testing-macros.md) — Verifying macro output
- [Publishing Macros](./publishing-macros.md) — Packaging and distribution

## Quick Start

### 1. Set Up

```bash
npm install @typesugar/core
npm install --save-dev @typesugar/transformer @typesugar/testing
```

### 2. Create a Macro

```typescript
// src/macros/double.ts
import { defineExpressionMacro } from "@typesugar/core";
import * as ts from "typescript";

defineExpressionMacro("double", {
  expand(ctx, callExpr) {
    const arg = callExpr.arguments[0];
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

export function double<T extends number>(x: T): T {
  throw new Error("double() should be compiled away");
}
```

### 3. Use It

```typescript
import { double } from "./macros/double";

const x = double(21); // Compiles to: (21) + (21)
```

### 4. Test It

```typescript
import { assertExpands } from "@typesugar/testing";

assertExpands(`import { double } from "./double"; const x = double(21);`, `const x = (21) + (21);`);
```

## MacroContext API

Every macro receives a context with:

```typescript
interface MacroContext {
  // Compiler access
  program: ts.Program;
  typeChecker: ts.TypeChecker;
  sourceFile: ts.SourceFile;
  factory: ts.NodeFactory;

  // Node creation
  createIdentifier(name: string): ts.Identifier;
  createStringLiteral(value: string): ts.StringLiteral;
  createNumericLiteral(value: number): ts.NumericLiteral;
  parseExpression(code: string): ts.Expression;
  parseStatements(code: string): ts.Statement[];

  // Type utilities
  getTypeOf(node: ts.Node): ts.Type;
  getTypeString(node: ts.Node): string;
  isAssignableTo(source: ts.Type, target: ts.Type): boolean;

  // Diagnostics
  reportError(node: ts.Node, message: string): void;
  reportWarning(node: ts.Node, message: string): void;

  // Compile-time
  evaluate(node: ts.Node): unknown;
  isComptime(node: ts.Node): boolean;
  generateUniqueName(prefix: string): ts.Identifier;
}
```

See [MacroContext Reference](../reference/macro-context.md) for full API.

## Registration Functions

```typescript
// Expression macro: myMacro(...)
defineExpressionMacro("myMacro", { expand(ctx, callExpr) { ... } });

// Attribute macro: @myMacro
defineAttributeMacro("myMacro", { expand(ctx, decorator, target) { ... } });

// Derive macro: @derive(MyDerive)
defineDeriveMacro("MyDerive", { expand(ctx, target, typeInfo) { ... } });

// Tagged template: tag`...`
defineTaggedTemplateMacro("tag", { expand(ctx, node) { ... } });

// Type macro: MyType<T>
defineTypeMacro("MyType", { expand(ctx, typeRef) { ... } });

// Labeled block: label: { ... }
defineLabeledBlockMacro("label", { expand(ctx, block) { ... } });
```

## Best Practices

### Do

- Return the original node on error (after reporting)
- Use quasiquoting for complex AST
- Generate hygienic names with `ctx.generateUniqueName()`
- Write tests for every macro
- Document expected inputs and outputs

### Don't

- Mutate input nodes (create new ones)
- Use string concatenation for AST
- Forget to handle edge cases
- Create macros with surprising behavior
