# Quasiquoting

Quasiquoting provides a clean way to construct AST from template strings with splicing.

## Basic Usage

```typescript
import { quote, quoteStatements } from "@typesugar/core/quote";

// Single expression
const expr = quote(ctx)`${a} + ${b}`;

// Multiple statements
const stmts = quoteStatements(ctx)`
  const x = ${initializer};
  console.log(x);
`;
```

## Splicing Expressions

Use `${}` to splice AST nodes:

```typescript
const left = ctx.createNumericLiteral(1);
const right = ctx.createNumericLiteral(2);

const sum = quote(ctx)`${left} + ${right}`;
// Produces: 1 + 2
```

## Splice Helpers

### ident()

Force identifier treatment:

```typescript
import { ident } from "@typesugar/core/quote";

const varName = "myVariable";
const expr = quote(ctx)`const ${ident(varName)} = 42`;
// Produces: const myVariable = 42
```

### raw()

Create an unhygienic identifier (intentional capture):

```typescript
import { raw } from "@typesugar/core/quote";

const expr = quote(ctx)`${raw("arguments")}[0]`;
// Captures the actual arguments variable
```

### spread()

Splice an array of statements:

```typescript
import { spread } from "@typesugar/core/quote";

const statements = [
  ctx.factory.createExpressionStatement(/* ... */),
  ctx.factory.createExpressionStatement(/* ... */),
];

const block = quoteStatements(ctx)`
  console.log("start");
  ${spread(statements)}
  console.log("end");
`;
```

## Quote Types

### quote()

Returns a single expression:

```typescript
const expr: ts.Expression = quote(ctx)`1 + 2`;
```

### quoteStatements()

Returns an array of statements:

```typescript
const stmts: ts.Statement[] = quoteStatements(ctx)`
  const x = 1;
  const y = 2;
`;
```

### quoteType()

Returns a type node:

```typescript
import { quoteType } from "@typesugar/core/quote";

const type: ts.TypeNode = quoteType(ctx)`Array<${elementType}>`;
```

### quoteBlock()

Returns a block statement:

```typescript
import { quoteBlock } from "@typesugar/core/quote";

const block: ts.Block = quoteBlock(ctx)`{
  const x = ${expr};
  return x;
}`;
```

## Convenience Helpers

### quoteCall()

Create a function call:

```typescript
import { quoteCall } from "@typesugar/core/quote";

const call = quoteCall(ctx, "console.log", [arg1, arg2]);
// Produces: console.log(arg1, arg2)
```

### quotePropAccess()

Create property access:

```typescript
import { quotePropAccess } from "@typesugar/core/quote";

const access = quotePropAccess(ctx, obj, "property");
// Produces: obj.property
```

### quoteMethodCall()

Create method call:

```typescript
import { quoteMethodCall } from "@typesugar/core/quote";

const call = quoteMethodCall(ctx, obj, "method", [arg1]);
// Produces: obj.method(arg1)
```

### quoteConst()

Create const declaration:

```typescript
import { quoteConst } from "@typesugar/core/quote";

const decl = quoteConst(ctx, "x", initializer);
// Produces: const x = initializer;
```

### quoteLet()

Create let declaration:

```typescript
import { quoteLet } from "@typesugar/core/quote";

const decl = quoteLet(ctx, "x", initializer);
// Produces: let x = initializer;
```

### quoteReturn()

Create return statement:

```typescript
import { quoteReturn } from "@typesugar/core/quote";

const ret = quoteReturn(ctx, expr);
// Produces: return expr;
```

### quoteIf()

Create if statement:

```typescript
import { quoteIf } from "@typesugar/core/quote";

const ifStmt = quoteIf(ctx, condition, thenBlock, elseBlock);
// Produces: if (condition) { thenBlock } else { elseBlock }
```

### quoteArrow()

Create arrow function:

```typescript
import { quoteArrow } from "@typesugar/core/quote";

const arrow = quoteArrow(ctx, ["x", "y"], quote(ctx)`${ident("x")} + ${ident("y")}`);
// Produces: (x, y) => x + y
```

### quoteFunction()

Create function declaration:

```typescript
import { quoteFunction } from "@typesugar/core/quote";

const fn = quoteFunction(
  ctx,
  "add",
  ["a", "b"],
  [quoteReturn(ctx, quote(ctx)`${ident("a")} + ${ident("b")}`)]
);
// Produces: function add(a, b) { return a + b; }
```

## Complex Example

Building a memoization wrapper:

```typescript
import { defineExpressionMacro } from "@typesugar/core";
import { quote, quoteStatements, ident, spread } from "@typesugar/core/quote";

defineExpressionMacro("memoize", {
  expand(ctx, callExpr) {
    const fn = callExpr.arguments[0];
    const cache = ctx.generateUniqueName("cache");
    const key = ctx.generateUniqueName("key");

    return quote(ctx)`
      (() => {
        const ${cache} = new Map();
        return (...args) => {
          const ${key} = JSON.stringify(args);
          if (${cache}.has(${key})) return ${cache}.get(${key});
          const result = ${fn}(...args);
          ${cache}.set(${key}, result);
          return result;
        };
      })()
    `;
  },
});
```

## Nesting Quotes

Quotes can be nested:

```typescript
const inner = quote(ctx)`x + y`;
const outer = quote(ctx)`(${inner}) * 2`;
// Produces: (x + y) * 2
```

## Type Safety

Quasiquoting is fully typed:

```typescript
const expr: ts.Expression = quote(ctx)`1 + 2`; // OK
const stmts: ts.Statement[] = quoteStatements(ctx)`const x = 1;`; // OK

// Type error: quote returns Expression, not Statement[]
const wrong: ts.Statement[] = quote(ctx)`1 + 2`;
```

## Common Patterns

### Wrapping in IIFE

```typescript
const wrapped = quote(ctx)`
  (() => {
    ${spread(statements)}
    return ${result};
  })()
`;
```

### Object Literal

```typescript
const obj = quote(ctx)`
  ({
    x: ${xValue},
    y: ${yValue},
  })
`;
```

### Array Literal

```typescript
const arr = quote(ctx)`
  [${spread(elements.map((e) => e))}]
`;
```

### Template Literal

```typescript
const template = quote(ctx)`
  \`Hello, \${${name}}!\`
`;
```

## Limitations

1. **No control flow in templates**: Use helpers for if/else
2. **Statements vs expressions**: Use the right quote function
3. **Escaping**: Use `\\` for literal backslashes in templates

## Best Practices

1. **Prefer quasiquoting**: Much cleaner than factory calls
2. **Use helpers**: `quoteIf`, `quoteConst`, etc. for common patterns
3. **Generate unique names**: Avoid variable capture
4. **Keep templates readable**: Break complex templates into parts
