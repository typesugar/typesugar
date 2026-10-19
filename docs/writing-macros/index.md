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

- [Quasiquoting](./quasiquoting.md) — Building AST from templates with `quote()`
- [Testing Macros](./testing-macros.md) — Verifying macro output
- [Publishing Macros](./publishing-macros.md) — Packaging, and getting your macros discovered

## Quick Start

### 1. Set Up

```bash
npm install --save-dev @typesugar/core @typesugar/transformer @typesugar/testing typescript
```

### 2. Create a Macro

A macro is a definition object passed to one of the `define*Macro` functions. Defining a
macro does **not** register it: you must also pass it to `globalRegistry.register(...)`,
at module scope, so registration happens when the module is loaded.

```typescript
// src/macros.ts — the macro definitions (build-time code; imports typescript)
import { defineExpressionMacro, globalRegistry } from "@typesugar/core";
import * as ts from "typescript";

globalRegistry.register(
  defineExpressionMacro({
    name: "double",
    module: "my-macros", // only expand double() imported from "my-macros"
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
  })
);
```

Users also need something to import and type-check against: a runtime placeholder with
the macro's signature. Keep it in a separate file from the definitions, so that importing
it does not pull `typescript` into the app:

```typescript
// src/index.ts — the runtime entry users import
export function double(x: number): number {
  throw new Error("double() should be compiled away. Is the typesugar transformer configured?");
}
```

### 3. Use It

```typescript
import { double } from "my-macros";

const x = double(21); // Compiles to: const x = (21) + (21);
```

The transformer only runs macros that are registered when it runs. For a macro package,
that happens through the `typesugar.macros` field in its `package.json`; see
[Publishing Macros](./publishing-macros.md#getting-discovered). In tests, you import the
definitions module yourself.

### 4. Test It

```typescript
import { it, expect } from "vitest";
import { transformCode } from "@typesugar/transformer";
import "../src/macros"; // registers double

it("expands double()", () => {
  const result = transformCode(`import { double } from "my-macros"; const x = double(21);`, {
    fileName: "test.ts",
  });
  expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  expect(result.code).toContain("const x = (21) + (21);");
});
```

See [Testing Macros](./testing-macros.md) for running the output, checking errors, and
unit-testing `expand` directly.

## MacroContext API

Every macro receives a context. The most-used members:

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
  createBooleanLiteral(value: boolean): ts.Expression;

  // Type utilities
  getTypeOf(node: ts.Node): ts.Type;
  getTypeString(node: ts.Node): string;
  isAssignableTo(source: ts.Type, target: ts.Type): boolean;
  getPropertiesOfType(type: ts.Type): ts.Symbol[];

  // Diagnostics
  reportError(node: ts.Node, message: string): void;
  reportWarning(node: ts.Node, message: string): void;

  // Compile-time evaluation
  evaluate(node: ts.Node): ComptimeValue; // { kind: "number", value: 42 }, { kind: "error", message }, ...
  isComptime(node: ts.Node): boolean;

  // Names and imports
  generateUniqueName(prefix: string): ts.Identifier;
  ensureImport(symbol: string, from: string): ts.Identifier;
}
```

`parseExpression(code)` and `parseStatements(code)` also exist, but this project builds
AST with `ctx.factory` rather than parsing code strings (see the [Quasiquoting](./quasiquoting.md)
page for when templates are the better tool).

See [MacroContext Reference](../reference/macro-context.md) for the full API.

## Definition Functions

Each function takes one definition object and returns it with its `kind` filled in.
Register the result with `globalRegistry.register(...)`.

```typescript
import {
  defineExpressionMacro,
  defineAttributeMacro,
  defineDeriveMacro,
  defineTaggedTemplateMacro,
  defineTypeMacro,
  defineLabeledBlockMacro,
  globalRegistry,
} from "@typesugar/core";

// Expression macro: myMacro(...)
globalRegistry.register(defineExpressionMacro({ name: "myMacro", expand(ctx, callExpr, args) { ... } }));

// Attribute macro: @myMacro (validTargets is required)
globalRegistry.register(defineAttributeMacro({ name: "myMacro", validTargets: ["class"], expand(ctx, decorator, target, args) { ... } }));

// Derive macro: @derive(MyDerive)
globalRegistry.register(defineDeriveMacro({ name: "MyDerive", expand(ctx, target, typeInfo) { ... } }));

// Tagged template: tag`...`
globalRegistry.register(defineTaggedTemplateMacro({ name: "tag", expand(ctx, node) { ... } }));

// Type macro: MyType<T>
globalRegistry.register(defineTypeMacro({ name: "MyType", expand(ctx, typeRef, args) { ... } }));

// Labeled block: label: { ... }
globalRegistry.register(defineLabeledBlockMacro({ name: "myBlock", label: "label", expand(ctx, mainBlock, continuation) { ... } }));
```

Common optional fields on every definition:

- `module` / `exportName`: import scoping. With `module` set, the macro only expands when
  the user imports its placeholder from that module (or from a barrel that re-exports it).
  Without it, any call with a matching name expands. Set it for anything you publish.
- `expandAfter`: names of macros that must expand first on the same declaration.
- `description`: shown in tooling.

### Macro identity: module and export name

A macro with a `module` is identified by its kind, its `module` and its export name
(`exportName ?? name`), not by its name alone. Two packages can register macros with the
same name, and both stay loaded: `@typesugar/validate`'s `assert<T>()` and
`@typesugar/testing`'s `assert(cond)` are different macros. The transformer follows the
user's import to the module that declares the placeholder and expands that module's macro,
so the result never depends on which package loaded first. Aliased imports
(`import { assert as check }`) and namespace imports (`v.assert<T>()`) resolve the same way.

The rules for registering:

- Registering the same definition again (an ESM and a CJS copy of one package) does nothing.
- A different definition with the same kind, `module` and export name throws, naming both.
- A macro without a `module` is identified by its kind and name. It expands wherever the
  name appears, so only one module-less macro can have a given name. It can share the name
  with macros that do have a `module`; those still win when their own module is imported.
- A labeled-block label (`let:`) belongs to one macro. A label is syntax with no import to
  tell two macros apart, so a second macro claiming a taken label throws.

Lookups that only have a name, such as `@derive(Name)` arguments and JSDoc tags, use the one
macro of that name if only one exists. If several modules provide it, they use the one whose
module the file imports. If that still leaves more than one, the name is left unexpanded and
the transformer prints a warning.

## Best Practices

### Do

- Return the original node on error (after reporting)
- Build AST with `ctx.factory`; reach for quasiquoting when a template is clearly easier to read
- Generate hygienic names with `ctx.generateUniqueName()`
- Write tests that run the expanded code, not just match its text
- Document expected inputs and outputs

### Don't

- Mutate input nodes (create new ones)
- Build code as strings and parse it back
- Declare the placeholder in the same file that uses the macro (a macro call is only
  expanded when the placeholder is imported)
- Create macros with surprising behavior
