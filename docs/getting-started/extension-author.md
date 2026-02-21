# Extension Author Guide

You want to create custom macros, syntax extensions, or publish a typesugar-powered library. This guide covers the macro authoring workflow, from setup to publishing.

## Quick Setup

Run the setup wizard:

```bash
npx typesugar init
```

Select "I want to write custom macros or extensions" when prompted. This installs all the packages you need for macro development.

## Manual Setup

### Step 1: Install Packages

```bash
# Core packages for macro authoring
npm install typesugar @typesugar/core
npm install --save-dev @typesugar/transformer @typesugar/testing ts-patch
```

### Step 2: Configure tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "outDir": "./dist",
    "plugins": [
      { "name": "typesugar/language-service" },
      { "transform": "@typesugar/transformer", "type": "program" }
    ]
  }
}
```

### Step 3: Install ts-patch

```bash
npx ts-patch install
```

## Macro Types Overview

typesugar supports six kinds of macros:

| Kind            | Trigger           | Example                 |
| --------------- | ----------------- | ----------------------- |
| Expression      | Function call     | `myMacro(arg)`          |
| Attribute       | Decorator         | `@myMacro class Foo {}` |
| Derive          | `@derive()`       | `@derive(MyDerive)`     |
| Tagged Template | Template literal  | `` myTag`template` ``   |
| Type            | Type reference    | `MyType<T>`             |
| Labeled Block   | Labeled statement | `myLabel: { ... }`      |

## Your First Expression Macro

Let's create a simple `double()` macro that duplicates an expression at compile time:

```typescript
// src/macros/double.ts
import { defineExpressionMacro, type MacroContext } from "@typesugar/core";
import * as ts from "typescript";

defineExpressionMacro("double", {
  expand(ctx: MacroContext, callExpr: ts.CallExpression) {
    const arg = callExpr.arguments[0];
    if (!arg) {
      ctx.reportError(callExpr, "double() requires an argument");
      return callExpr;
    }

    // Generate: (arg) + (arg)
    return ctx.factory.createBinaryExpression(
      ctx.factory.createParenthesizedExpression(arg),
      ts.SyntaxKind.PlusToken,
      ctx.factory.createParenthesizedExpression(arg)
    );
  },
});

// Runtime placeholder (never actually called)
export function double<T extends number | string>(value: T): T {
  throw new Error("double() should be compiled away");
}
```

Usage:

```typescript
import { double } from "./macros/double";

const x = double(21); // Compiles to: (21) + (21) → 42
const s = double("ha"); // Compiles to: ("ha") + ("ha") → "haha"
```

## Using Quasiquoting

For complex AST generation, use the `quote()` helper instead of raw factory calls:

```typescript
import { defineExpressionMacro } from "@typesugar/core";
import { quote, ident } from "@typesugar/core/quote";

defineExpressionMacro("assert", {
  expand(ctx, callExpr) {
    const condition = callExpr.arguments[0];
    const message = callExpr.arguments[1];

    // Generate: if (!(condition)) { throw new Error(message) }
    return quote(ctx)`
      if (!(${condition})) {
        throw new Error(${message ?? ctx.createStringLiteral("Assertion failed")})
      }
    `;
  },
});
```

Quasiquoting helpers:

- `${expr}` — splice an expression
- `${ident("name")}` — create an identifier
- `${spread(stmts)}` — splice an array of statements

## Creating a Derive Macro

Derive macros generate implementations from type structure:

```typescript
import { defineDeriveMacro, type DeriveTypeInfo } from "@typesugar/core";
import { quoteStatements } from "@typesugar/core/quote";

defineDeriveMacro("Printable", {
  expand(ctx, target, typeInfo: DeriveTypeInfo) {
    const { name, fields } = typeInfo;

    const fieldPrints = fields.map((f) => `${f.name}: \${this.${f.name}}`).join(", ");

    return quoteStatements(ctx)`
      ${target}
      
      // Augment the class with a print method
      ${target}.prototype.print = function() {
        return \`${name} { ${fieldPrints} }\`;
      };
    `;
  },
});
```

Usage:

```typescript
@derive(Printable)
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}

new Point(1, 2).print(); // "Point { x: 1, y: 2 }"
```

## Creating a Tagged Template Macro

```typescript
import { defineTaggedTemplateMacro } from "@typesugar/core";

defineTaggedTemplateMacro("upper", {
  expand(ctx, node) {
    // node is a ts.TaggedTemplateExpression
    const template = node.template;

    if (ts.isNoSubstitutionTemplateLiteral(template)) {
      // Simple case: no interpolations
      const text = template.text.toUpperCase();
      return ctx.createStringLiteral(text);
    }

    // With interpolations: transform at compile time where possible
    // or generate runtime code for dynamic parts
    ctx.reportWarning(node, "upper`...` with interpolations falls back to runtime");
    return node;
  },
});
```

## MacroContext API

Every macro receives a `MacroContext` with:

**Compiler Access:**

- `ctx.program` — the `ts.Program`
- `ctx.typeChecker` — TypeScript's type checker
- `ctx.sourceFile` — current source file
- `ctx.factory` — `ts.NodeFactory` for creating nodes

**Node Creation:**

- `ctx.createIdentifier(name)`
- `ctx.createStringLiteral(value)`
- `ctx.createNumericLiteral(value)`
- `ctx.createArrayLiteral(elements)`
- `ctx.createObjectLiteral(properties)`
- `ctx.parseExpression(code)` — parse code string to AST
- `ctx.parseStatements(code)` — parse code to statements

**Type Utilities:**

- `ctx.getTypeOf(node)` — get the type of a node
- `ctx.getTypeString(node)` — get type as string
- `ctx.isAssignableTo(source, target)` — check assignability
- `ctx.getPropertiesOfType(type)` — get type's properties

**Diagnostics:**

- `ctx.reportError(node, message)` — emit compile error
- `ctx.reportWarning(node, message)` — emit warning

**Compile-Time:**

- `ctx.evaluate(node)` — evaluate expression at compile time
- `ctx.isComptime(node)` — check if evaluatable at compile time
- `ctx.generateUniqueName(prefix)` — generate hygienic name

## Testing Macros

Use `@typesugar/testing` for macro tests:

```typescript
import { describe, it, expect } from "vitest";
import { expandMacro, assertExpands } from "@typesugar/testing";

describe("double macro", () => {
  it("doubles numeric literals", () => {
    assertExpands(
      `import { double } from "./double"; const x = double(21);`,
      `const x = (21) + (21);`
    );
  });

  it("reports error for no arguments", async () => {
    const result = await expandMacro(`double()`);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ message: /requires an argument/ })
    );
  });
});
```

## Publishing Your Macros

### Package Structure

```
my-macro-package/
  package.json
  tsconfig.json
  src/
    index.ts          # Exports runtime placeholders
    macros/
      my-macro.ts     # Macro definition (registers with defineXxxMacro)
  dist/
    index.js
    index.d.ts
```

### package.json

```json
{
  "name": "my-macro-package",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "peerDependencies": {
    "@typesugar/transformer": ">=0.1.0",
    "typescript": ">=5.0.0"
  },
  "dependencies": {
    "@typesugar/core": "^0.1.0"
  }
}
```

### Key Points

1. **Export runtime placeholders** — Functions users import that throw if not compiled away
2. **Register macros at import time** — `defineExpressionMacro()` etc. run when your module is imported
3. **Use `@typesugar/core` as a dependency** — It's the macro registration API
4. **Document the build requirement** — Users must have `@typesugar/transformer` configured

## What's Next?

- [Writing Macros: Expression Macros](../writing-macros/expression-macros.md)
- [Writing Macros: Attribute Macros](../writing-macros/attribute-macros.md)
- [Writing Macros: Derive Macros](../writing-macros/derive-macros.md)
- [Writing Macros: Quasiquoting](../writing-macros/quasiquoting.md)
- [Writing Macros: Testing](../writing-macros/testing-macros.md)
- [Writing Macros: Publishing](../writing-macros/publishing-macros.md)
- [Reference: MacroContext API](../reference/macro-context.md)
