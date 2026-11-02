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
      { "name": "@typesugar/transformer/language-service" },
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

A macro package has two entries: a **runtime entry** (`.`) with the placeholder
functions users import, and a **macro entry** (`./macros`) that defines the macros
and registers them. Only the transformer loads the macro entry, at build time.

Let's create a simple `double()` macro that duplicates an expression at compile time:

```typescript
// src/macros.ts — the macro entry
import { defineExpressionMacro, globalRegistry } from "@typesugar/core";
import * as ts from "typescript";

export const doubleMacro = defineExpressionMacro({
  name: "double",
  module: "my-macros", // only expand double() imported from this package
  expand(ctx, callExpr, args) {
    const arg = args[0];
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

// defineExpressionMacro only builds the definition; registering it is a separate step
globalRegistry.register(doubleMacro);
```

```typescript
// src/index.ts — the runtime entry (no typescript / @typesugar/core imports)
export function double<T extends number | string>(value: T): T {
  throw new Error("double() should be compiled away");
}
```

Usage:

```typescript
import { double } from "my-macros";

const x = double(21); // Compiles to: (21) + (21) → 42
const s = double("ha"); // Compiles to: ("ha") + ("ha") → "haha"
```

## Building AST Nodes

Build output with `ctx.factory` (the `ts.NodeFactory`), as above, rather than by
printing code strings and parsing them back: AST construction is type-checked,
composes with other transformations, and doesn't depend on re-parsing.
`@typesugar/macros` does export a quasi-quote helper (`quote`, `quoteStatements`,
`ident`, `spread`) and `ctx.parseExpression` / `ctx.parseStatements` exist, but they
round-trip through text; see [Quasiquoting](../writing-macros/quasiquoting.md)
before reaching for them.

## Creating a Derive Macro

Derive macros generate code from a type's structure. `typeInfo` gives the type's
`name`, its `fields` (each with `name`, `typeString`, `optional`, …) and its `kind`
(`"product"` or `"sum"`):

```typescript
// src/macros.ts
import { defineDeriveMacro, globalRegistry } from "@typesugar/core";
import * as ts from "typescript";

export const fieldNamesDerive = defineDeriveMacro({
  name: "FieldNames",
  expand(ctx, _target, typeInfo) {
    const f = ctx.factory;
    // Generate: export const <Name>FieldNames = ["field1", "field2", ...];
    return [
      f.createVariableStatement(
        [f.createModifier(ts.SyntaxKind.ExportKeyword)],
        f.createVariableDeclarationList(
          [
            f.createVariableDeclaration(
              `${typeInfo.name}FieldNames`,
              undefined,
              undefined,
              f.createArrayLiteralExpression(
                typeInfo.fields.map((field) => f.createStringLiteral(field.name))
              )
            ),
          ],
          ts.NodeFlags.Const
        )
      ),
    ];
  },
});

globalRegistry.register(fieldNamesDerive);
```

Usage:

```typescript
import { derive } from "typesugar";

@derive(FieldNames)
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}

PointFieldNames; // ["x", "y"]
```

## Creating a Tagged Template Macro

```typescript
import { defineTaggedTemplateMacro, globalRegistry } from "@typesugar/core";
import * as ts from "typescript";

export const upperMacro = defineTaggedTemplateMacro({
  name: "upper",
  module: "my-macros",
  expand(ctx, node) {
    // node is a ts.TaggedTemplateExpression
    const template = node.template;

    if (ts.isNoSubstitutionTemplateLiteral(template)) {
      // upper`hello` → "HELLO"
      return ctx.createStringLiteral(template.text.toUpperCase());
    }

    ctx.reportError(node, "upper`...` does not support interpolations");
    return node;
  },
});

globalRegistry.register(upperMacro);
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
- `ctx.parseExpression(code)` / `ctx.parseStatements(code)` — parse code text to AST
  (prefer `ctx.factory`; see above)

**Type Utilities:**

- `ctx.getTypeOf(node)` — get the type of a node
- `ctx.getTypeString(node)` — get type as string
- `ctx.isAssignableTo(source, target)` — check assignability
- `ctx.getPropertiesOfType(type)` — get type's properties

**Diagnostics:**

- `ctx.reportError(node, message)` — emit compile error
- `ctx.reportWarning(node, message)` — emit warning
- `ctx.diagnostic(descriptor)` — emit a catalogued diagnostic (code, notes, help)

**Compile-Time:**

- `ctx.evaluate(node)` — evaluate at compile time; returns a tagged `ComptimeValue`
  (`{ kind: "number", value }`, …, or `{ kind: "error", message }`)
- `ctx.isComptime(node)` — check if evaluatable at compile time
- `ctx.generateUniqueName(prefix)` — generate hygienic name
- `ctx.safeRef(symbol, from)` / `ctx.ensureImport(symbol, from)` — refer to an
  export of another module without name collisions (`ensureImport` also adds the
  import)

## Testing Macros

Import your macro entry (so the macros register), expand source with
`transformCode` from `@typesugar/transformer`, and check the diagnostics and the
output — ideally by running it:

```typescript
import { describe, it, expect } from "vitest";
import { transformCode } from "@typesugar/transformer";
import "../src/macros"; // registers double()

describe("double macro", () => {
  it("doubles numeric literals", () => {
    const result = transformCode(`import { double } from "my-macros"; const x = double(21);`, {
      fileName: "test.ts",
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("const x = (21) + (21);");
  });

  it("reports error for no arguments", () => {
    const result = transformCode(`import { double } from "my-macros"; double();`, {
      fileName: "test.ts",
    });
    expect(result.diagnostics.map((d) => d.message)).toContainEqual(
      expect.stringMatching(/requires an argument/)
    );
  });
});
```

For unit-testing an `expand` function directly, `@typesugar/testing/macros` exports
`createMacroTestContext`. See [Testing Macros](../writing-macros/testing-macros.md).

## Publishing Your Macros

### Package Structure

```
my-macros/
  package.json
  tsconfig.json
  src/
    index.ts          # Runtime entry: placeholders users import
    macros.ts         # Macro entry: definitions + globalRegistry.register(...)
  dist/
    index.js / index.cjs / index.d.ts
    macros.js / macros.cjs / macros.d.ts
```

### package.json

```json
{
  "name": "my-macros",
  "type": "module",
  "main": "./dist/index.cjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./macros": {
      "types": "./dist/macros.d.ts",
      "import": "./dist/macros.js",
      "require": "./dist/macros.cjs"
    }
  },
  "typesugar": {
    "macros": "./macros"
  },
  "peerDependencies": {
    "@typesugar/core": ">=0.1.0",
    "typescript": ">=5.0.0"
  }
}
```

### Key Points

1. **Declare `typesugar.macros`** — The transformer only loads a package's macros if
   its `package.json` has a `typesugar.macros` field naming the macro entry (PEP-055).
   Without it, your macros are never registered. The transformer loads that entry
   with `require()`, so ship a CommonJS build of it.
2. **Users must approve your package** — Packages outside `@typesugar/*` are refused
   until the user runs `npx typesugar approve-macros`, which adds your package to
   `security.allowedMacroPackages` in their `typesugar.config.ts`. Say so in your
   README.
3. **Export runtime placeholders** — The functions users import, which throw if not
   compiled away. Keep `typescript` and `@typesugar/core` out of the runtime entry.
4. **Set `module` on each macro** — so only calls imported from your package expand.
5. **Document the build requirement** — Users must have `@typesugar/transformer` (or
   `unplugin-typesugar`) configured.

See [Publishing Macros](../writing-macros/publishing-macros.md) for the build setup.

## What's Next?

- [Writing Macros: Expression Macros](../writing-macros/expression-macros.md)
- [Writing Macros: Attribute Macros](../writing-macros/attribute-macros.md)
- [Writing Macros: Derive Macros](../writing-macros/derive-macros.md)
- [Writing Macros: Quasiquoting](../writing-macros/quasiquoting.md)
- [Writing Macros: Testing](../writing-macros/testing-macros.md)
- [Writing Macros: Publishing](../writing-macros/publishing-macros.md)
- [Reference: MacroContext API](../reference/macro-context.md)
