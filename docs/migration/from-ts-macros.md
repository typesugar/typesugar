# typesugar for ts-macros Users

This guide maps ts-macros concepts to typesugar.

## Overview

| ts-macros        | typesugar       |
| ---------------- | --------------- |
| `$macro!()`      | `myMacro()`     |
| Compiler plugin  | Compiler plugin |
| String templates | Quasiquoting    |
| Built-in macros  | Packages        |

## Macro Definition

In typesugar a macro is a definition object passed to `defineExpressionMacro(...)`
(and friends), which you then **register** with `globalRegistry.register(...)`. The
definitions live in your package's macro entry (`./macros`), which the transformer
loads because your `package.json` declares `"typesugar": { "macros": "./macros" }`
(see [Publishing Macros](../writing-macros/publishing-macros.md)). The runtime entry
exports placeholder functions with the same names.

### Basic Expression Macro

```typescript
// ts-macros
import { macro } from "ts-macros";

export const $double = macro((value: number) => {
  return `${value} + ${value}`;
});

// typesugar — src/macros.ts (macro entry)
import { defineExpressionMacro, globalRegistry } from "@typesugar/core";
import * as ts from "typescript";

export const doubleMacro = defineExpressionMacro({
  name: "double",
  module: "my-macros", // expand only when imported from this package
  expand(ctx, _callExpr, [value]) {
    // (value) + (value)
    const f = ctx.factory;
    return f.createBinaryExpression(
      f.createParenthesizedExpression(value),
      ts.SyntaxKind.PlusToken,
      f.createParenthesizedExpression(value)
    );
  },
});
globalRegistry.register(doubleMacro);

// typesugar — src/index.ts (runtime entry)
export function double(value: number): number {
  throw new Error("Should be compiled away");
}
```

### With Multiple Arguments

```typescript
// ts-macros
export const $add = macro((a: number, b: number) => {
  return `${a} + ${b}`;
});

// typesugar
export const addMacro = defineExpressionMacro({
  name: "add",
  module: "my-macros",
  expand(ctx, _callExpr, [a, b]) {
    return ctx.factory.createBinaryExpression(a, ts.SyntaxKind.PlusToken, b);
  },
});
globalRegistry.register(addMacro);
```

## Usage Syntax

```typescript
// ts-macros
const result = $double!(5);

// typesugar
const result = double(5); // No special syntax
```

## String Templates → AST (or Quasiquoting)

typesugar macros return AST nodes. Building them with `ctx.factory` is the
recommended style: it is type-checked and doesn't round-trip through the parser. If
you are porting many string templates, `@typesugar/macros` also exports a
quasi-quote helper that parses a template with spliced nodes:

```typescript
// ts-macros
return `${a} + ${b}`;

// typesugar, quasi-quote
import { quote } from "@typesugar/macros";
return quote(ctx)`${a} + ${b}`;

// typesugar, AST (preferred)
return ctx.factory.createBinaryExpression(a, ts.SyntaxKind.PlusToken, b);
```

The other quasi-quote helpers are `quoteStatements` (several statements), `ident`
(splice an identifier by name), `raw` and `spread`. See
[Quasiquoting](../writing-macros/quasiquoting.md).

## Type Access

### Getting Type Info

```typescript
// ts-macros
import { $$typeToString } from "ts-macros";

export const $showType = macro(<T>() => {
  return `"${$$typeToString<T>()}"`;
});

// typesugar
export const showTypeMacro = defineExpressionMacro({
  name: "showType",
  module: "my-macros",
  expand(ctx, callExpr) {
    const typeArg = callExpr.typeArguments?.[0];
    if (!typeArg) return callExpr;

    const type = ctx.typeChecker.getTypeFromTypeNode(typeArg);
    const typeStr = ctx.typeChecker.typeToString(type);

    return ctx.createStringLiteral(typeStr); // showType<User>() → "User"
  },
});
globalRegistry.register(showTypeMacro);
```

### Type Properties

```typescript
// ts-macros
import { $$propsOfType } from "ts-macros";

export const $keys = macro(<T>() => {
  const props = $$propsOfType<T>();
  return `[${props.map((p) => `"${p.name}"`).join(", ")}]`;
});

// typesugar
export const keysMacro = defineExpressionMacro({
  name: "keys",
  module: "my-macros",
  expand(ctx, callExpr) {
    const typeArg = callExpr.typeArguments?.[0];
    if (!typeArg) return callExpr;

    const type = ctx.typeChecker.getTypeFromTypeNode(typeArg);
    const props = ctx.getPropertiesOfType(type);
    const names = props.map((p) => ctx.createStringLiteral(p.getName()));

    return ctx.createArrayLiteral(names); // keys<User>() → ["id", "name"]
  },
});
globalRegistry.register(keysMacro);
```

## Decorator Macros

```typescript
// ts-macros
import { decoratorMacro } from "ts-macros";

export const $logged = decoratorMacro((target: Function) => {
  return `
    function ${target.name}(...args) {
      console.log("Calling ${target.name}");
      return originalFn.apply(this, args);
    }
  `;
});

// typesugar
export const loggedMacro = defineAttributeMacro({
  name: "logged",
  module: "my-macros",
  validTargets: ["function"],
  expand(ctx, _decorator, target) {
    if (!ts.isFunctionDeclaration(target) || !target.body || !target.name) return target;
    const f = ctx.factory;
    // console.log("Calling <name>");
    const log = f.createExpressionStatement(
      f.createCallExpression(
        f.createPropertyAccessExpression(f.createIdentifier("console"), "log"),
        undefined,
        [f.createStringLiteral(`Calling ${target.name.text}`)]
      )
    );
    // Same function, decorator removed, log prepended to the body
    return f.updateFunctionDeclaration(
      target,
      target.modifiers?.filter((m) => !ts.isDecorator(m)),
      target.asteriskToken,
      target.name,
      target.typeParameters,
      target.parameters,
      target.type,
      f.updateBlock(target.body, [log, ...target.body.statements])
    );
  },
});
globalRegistry.register(loggedMacro);

// Usage: the decorator form triggers a custom attribute macro
// (the `/** @tag */` JSDoc form is only recognised for typesugar's built-in tags)
@logged
function greet(name: string) {
  return "hi " + name;
}
```

## Compile-Time Evaluation

```typescript
// ts-macros
import { $$comptime } from "ts-macros";

const value = $$comptime!(() => {
  return 1 + 2 + 3;
});

// typesugar
import { comptime } from "typesugar";

const value = comptime(() => {
  return 1 + 2 + 3;
});
```

## Configuration

### ts-macros

```json
{
  "compilerOptions": {
    "plugins": [{ "transform": "ts-macros/transform" }]
  }
}
```

### typesugar

```json
{
  "compilerOptions": {
    "plugins": [
      { "name": "@typesugar/transformer/language-service" },
      { "transform": "@typesugar/transformer", "type": "program" }
    ]
  }
}
```

## Key Differences

### Macro Invocation

ts-macros uses `$macro!()` syntax. typesugar uses regular function call syntax:

```typescript
// ts-macros
$double!(5);

// typesugar
double(5);
```

### AST Construction

ts-macros uses string templates. typesugar macros return AST nodes, built with
`ctx.factory` (or, when porting, the `quote` helper from `@typesugar/macros`):

```typescript
// ts-macros: string interpolation
return `${a} + ${b}`;

// typesugar: AST
return ctx.factory.createBinaryExpression(a, ts.SyntaxKind.PlusToken, b);
```

### Type Information

ts-macros has special `$$` functions. typesugar uses the TypeScript API directly:

```typescript
// ts-macros
const type = $$typeToString<T>();

// typesugar
const type = ctx.typeChecker.typeToString(ctx.getTypeOf(node));
```

### Runtime Placeholders

typesugar requires runtime placeholders for type checking:

```typescript
// Required for type checking
export function double(value: number): number {
  throw new Error("Should be compiled away");
}
```

ts-macros doesn't require this because of the `$!` syntax.

## Migration Steps

1. **Update imports**: `ts-macros` → `@typesugar/core`
2. **Convert macro definitions**: `macro()` → `defineExpressionMacro({ name, module, expand })`, then `globalRegistry.register(...)` in a `./macros` entry
3. **Declare the macro entry**: add `"typesugar": { "macros": "./macros" }` to `package.json`
4. **Add runtime placeholders**: Export functions that throw
5. **Update call sites**: `$macro!(args)` → `macro(args)`
6. **Convert string templates**: build AST with `ctx.factory` (or `quote()` from `@typesugar/macros`)
7. **Update config**: Change plugin in tsconfig.json
8. **Approve the package in consuming projects**: macro packages outside `@typesugar/*` need `npx typesugar approve-macros` once per project

## Feature Comparison

| Feature           | ts-macros    | typesugar                                 |
| ----------------- | ------------ | ----------------------------------------- |
| Expression macros | Yes          | Yes                                       |
| Decorator macros  | Yes          | Yes                                       |
| Type macros       | Limited      | Yes                                       |
| Compile-time eval | Yes          | Yes                                       |
| Quasiquoting      | No (strings) | Yes (`@typesugar/macros`)                 |
| IDE support       | Limited      | Full (language service)                   |
| Testing utilities | No           | `transformCode`, `createMacroTestContext` |
| Built-in macros   | Few          | Many (packages)                           |
