# @ttfx/core

> Foundation types, registry, and context for the ttfx macro system.

## Overview

`@ttfx/core` is the foundational package of the ttfx ecosystem. It defines the interfaces that all macros implement, the global registry where macros are registered, and the `MacroContext` that provides type checker access during macro expansion.

**You need this package if you're writing custom macros.** If you're just using ttfx macros, import from `ttfx` instead.

## Installation

```bash
npm install @ttfx/core
# or
pnpm add @ttfx/core
```

## Runtime Safety Primitives

In addition to macro infrastructure, `@ttfx/core` provides fundamental runtime safety utilities:

```typescript
import { invariant, unreachable, debugOnly } from "@ttfx/core";

// Assert invariants (strippable in production)
function divide(a: number, b: number): number {
  invariant(b !== 0, "Division by zero");
  return a / b;
}

// Mark unreachable code paths (for exhaustiveness checking)
type Shape = { kind: "circle" } | { kind: "square" };
function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle": return Math.PI;
    case "square": return 1;
    default: unreachable(shape); // Type error if Shape is extended
  }
}

// Debug-only code (stripped in production builds)
debugOnly(() => {
  console.log("Internal state:", state);
  validateDeepInvariants(state);
});
```

## Macro Types

ttfx supports six kinds of macros:

| Kind | Interface | Trigger | Example |
|------|-----------|---------|---------|
| **Expression** | `ExpressionMacro` | Function call | `comptime(() => 1 + 1)` |
| **Attribute** | `AttributeMacro` | Decorator | `@operators class Vec { }` |
| **Derive** | `DeriveMacro` | `@derive(Name)` | `@derive(Eq, Clone)` |
| **Tagged Template** | `TaggedTemplateMacroDef` | Tagged template | `` sql`SELECT * FROM users` `` |
| **Type** | `TypeMacro` | Type reference | `type X = Add<1, 2>` |
| **Labeled Block** | `LabeledBlockMacro` | Labeled statement | `let: { x << expr }` |

## Defining a Custom Macro

### Expression Macro

```typescript
import { defineExpressionMacro, globalRegistry } from "@ttfx/core";

const myMacro = defineExpressionMacro({
  name: "myMacro",
  module: "@my-org/my-macros",
  description: "Doubles a numeric literal at compile time",
  expand(ctx, callExpr, args) {
    const arg = args[0];
    const type = ctx.typeChecker.getTypeAtLocation(arg);
    if (type.isNumberLiteral()) {
      return ctx.factory.createNumericLiteral(type.value * 2);
    }
    ctx.reportError(arg, "myMacro expects a numeric literal");
    return callExpr;
  },
});

globalRegistry.register(myMacro);
```

### Tagged Template Macro

```typescript
import { defineTaggedTemplateMacro, globalRegistry } from "@ttfx/core";

const greetMacro = defineTaggedTemplateMacro({
  name: "greet",
  module: "@my-org/my-macros",
  description: "Validates greeting templates at compile time",
  expand(ctx, taggedTemplate, tag, template) {
    // Validate template at compile time, emit optimized code
    return ctx.factory.createStringLiteral("Hello, World!");
  },
});

globalRegistry.register(greetMacro);
```

## MacroContext

The `MacroContext` is passed to every macro's `expand()` function. It provides:

```typescript
interface MacroContext {
  /** TypeScript's type checker — full type information access */
  typeChecker: ts.TypeChecker;

  /** AST node factory for creating new nodes */
  factory: ts.NodeFactory;

  /** The source file being transformed */
  sourceFile: ts.SourceFile;

  /** Report an error at a specific node */
  reportError(node: ts.Node, message: string): void;

  /** Report a warning */
  reportWarning(node: ts.Node, message: string): void;

  /** Generate a unique identifier name (hygienic) */
  generateUniqueName(prefix: string): string;

  /** Parse a string as a TypeScript expression */
  parseExpression(code: string): ts.Expression;
}
```

## Registry

The `globalRegistry` is a singleton that holds all registered macros:

```typescript
import { globalRegistry } from "@ttfx/core";

// Register a macro
globalRegistry.register(myMacro);

// Look up by name
const macro = globalRegistry.get("myMacro");

// Look up by module + name (import-scoped)
const macro = globalRegistry.getByModule("@my-org/my-macros", "myMacro");
```

## API Reference

### Types

- `MacroKind` — `"expression" | "attribute" | "derive" | "tagged-template" | "type" | "labeled-block"`
- `MacroDefinition` — Union of all macro definition types
- `ExpressionMacro` — Expression macro definition
- `AttributeMacro` — Attribute (decorator) macro definition
- `DeriveMacro` — Derive macro definition
- `TaggedTemplateMacroDef` — Tagged template macro definition
- `TypeMacro` — Type-level macro definition
- `LabeledBlockMacro` — Labeled block macro definition
- `DeriveTypeInfo` — Type information passed to derive macros
- `DeriveFieldInfo` — Field information within `DeriveTypeInfo`
- `ComptimeValue` — Values representable at compile time

### Functions

- `defineExpressionMacro(def)` — Create an expression macro definition
- `defineAttributeMacro(def)` — Create an attribute macro definition
- `defineDeriveMacro(def)` — Create a derive macro definition
- `defineTaggedTemplateMacro(def)` — Create a tagged template macro definition
- `defineTypeMacro(def)` — Create a type macro definition
- `defineLabeledBlockMacro(def)` — Create a labeled block macro definition

### Singletons

- `globalRegistry` — The global `MacroRegistry` instance

## License

MIT
