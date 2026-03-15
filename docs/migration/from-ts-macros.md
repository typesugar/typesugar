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

### Basic Expression Macro

```typescript
// ts-macros
import { macro } from "ts-macros";

export const $double = macro((value: number) => {
  return `${value} + ${value}`;
});

// typesugar
import { defineExpressionMacro } from "@typesugar/core";
import { quote } from "@typesugar/core/quote";

defineExpressionMacro("double", {
  expand(ctx, callExpr) {
    const value = callExpr.arguments[0];
    return quote(ctx)`${value} + ${value}`;
  },
});

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
defineExpressionMacro("add", {
  expand(ctx, callExpr) {
    const [a, b] = callExpr.arguments;
    return quote(ctx)`${a} + ${b}`;
  },
});
```

## Usage Syntax

```typescript
// ts-macros
const result = $double!(5);

// typesugar
const result = double(5); // No special syntax
```

## String Templates → Quasiquoting

### Simple Templates

```typescript
// ts-macros
return `console.log(${expr})`;

// typesugar
return quote(ctx)`console.log(${expr})`;
```

### Multiple Statements

```typescript
// ts-macros
return `
  const temp = ${expr};
  console.log(temp);
  temp;
`;

// typesugar
return quoteStatements(ctx)`
  const temp = ${expr};
  console.log(temp);
  return temp;
`;
```

### Identifiers

```typescript
// ts-macros
const name = "myVar";
return `const ${name} = 42`;

// typesugar
import { ident } from "@typesugar/core/quote";

const name = "myVar";
return quote(ctx)`const ${ident(name)} = 42`;
```

## Type Access

### Getting Type Info

```typescript
// ts-macros
import { $$typeToString } from "ts-macros";

export const $showType = macro(<T>() => {
  return `"${$$typeToString<T>()}"`;
});

// typesugar
defineExpressionMacro("showType", {
  expand(ctx, callExpr) {
    const typeArg = callExpr.typeArguments?.[0];
    if (!typeArg) return callExpr;

    const type = ctx.typeChecker.getTypeFromTypeNode(typeArg);
    const typeStr = ctx.typeChecker.typeToString(type);

    return ctx.createStringLiteral(typeStr);
  },
});
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
defineExpressionMacro("keys", {
  expand(ctx, callExpr) {
    const typeArg = callExpr.typeArguments?.[0];
    if (!typeArg) return callExpr;

    const type = ctx.typeChecker.getTypeFromTypeNode(typeArg);
    const props = ctx.getPropertiesOfType(type);
    const names = props.map((p) => ctx.createStringLiteral(p.getName()));

    return ctx.createArrayLiteral(names);
  },
});
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
defineAttributeMacro("logged", {
  expand(ctx, decorator, target) {
    if (!ts.isFunctionDeclaration(target)) return target;

    const name = target.name?.getText(ctx.sourceFile);
    return quoteStatements(ctx)`
      function ${ident(name)}(...args) {
        console.log("Calling ${name}");
        return originalFn.apply(this, args);
      }
    `;
  },
});
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
      { "name": "typesugar/language-service" },
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

ts-macros uses string templates. typesugar uses quasiquoting with full type safety:

```typescript
// ts-macros: string interpolation
return `${a} + ${b}`;

// typesugar: AST splicing
return quote(ctx)`${a} + ${b}`;
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
2. **Convert macro definitions**: `macro()` → `defineExpressionMacro()`
3. **Add runtime placeholders**: Export functions that throw
4. **Update call sites**: `$macro!(args)` → `macro(args)`
5. **Convert string templates**: Use `quote()` instead
6. **Update config**: Change plugin in tsconfig.json

## Feature Comparison

| Feature           | ts-macros    | typesugar               |
| ----------------- | ------------ | ----------------------- |
| Expression macros | Yes          | Yes                     |
| Decorator macros  | Yes          | Yes                     |
| Type macros       | Limited      | Yes                     |
| Compile-time eval | Yes          | Yes                     |
| Quasiquoting      | No (strings) | Yes                     |
| IDE support       | Limited      | Full (language service) |
| Testing utilities | No           | Yes                     |
| Built-in macros   | Few          | Many (packages)         |
