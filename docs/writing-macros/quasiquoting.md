# Quasiquoting

Quasiquoting builds AST from a template string, splicing in nodes you already have.

This project builds generated code with `ctx.factory` (`ts.factory.create*`) by default:
it is type-safe and never round-trips through the parser. Quasiquoting is the alternative
for code where a template is much easier to read than the factory calls, such as a
multi-statement body. The helpers below are exported from `@typesugar/macros`.

## Basic Usage

```typescript
import { quote, quoteStatements } from "@typesugar/macros";

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

Spliced expressions are inserted as a single operand: with `sum = 1 + 2`,
`` quote(ctx)`${sum} * 2` `` produces `(1 + 2) * 2`.

### ident()

Mark a string as an identifier name. The name is inserted verbatim — quote has
**no automatic hygiene**, so it is not renamed and can collide with user names.
For a collision-free temporary use `ctx.generateUniqueName(prefix)`:

```typescript
import { ident } from "@typesugar/macros";

const varName = "myVariable";
const stmts = quoteStatements(ctx)`const ${ident(varName)} = 42;`;
// Produces: const myVariable = 42;
```

### raw()

Insert an exact name, e.g. for intentional capture. `raw()` currently behaves
exactly like `ident()` (neither one mangles names); it exists to make intentional
references to user-visible names obvious at the call site:

```typescript
import { raw } from "@typesugar/macros";

const expr = quote(ctx)`${raw("arguments")}[0]`;
// Captures the actual arguments variable
```

### spread()

Splice an array of statements:

```typescript
import { spread } from "@typesugar/macros";

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
import { quoteType } from "@typesugar/macros";

const type: ts.TypeNode = quoteType(ctx)`Array<${elementType}>`;
```

### quoteBlock()

Returns a block statement:

```typescript
import { quoteBlock } from "@typesugar/macros";

const block: ts.Block = quoteBlock(ctx)`
  const x = ${expr};
  return x;
`;
// Produces: { const x = <expr>; return x; }
```

## Convenience Helpers

### quoteCall()

Create a function call:

```typescript
import { quoteCall } from "@typesugar/macros";

const call = quoteCall(ctx, "console.log", [arg1, arg2]);
// Produces: console.log(arg1, arg2)
```

### quotePropAccess()

Create property access:

```typescript
import { quotePropAccess } from "@typesugar/macros";

const access = quotePropAccess(ctx, obj, "property");
// Produces: obj.property
```

### quoteMethodCall()

Create method call:

```typescript
import { quoteMethodCall } from "@typesugar/macros";

const call = quoteMethodCall(ctx, obj, "method", [arg1]);
// Produces: obj.method(arg1)
```

### quoteConst()

Create const declaration:

```typescript
import { quoteConst } from "@typesugar/macros";

const decl = quoteConst(ctx, "x", initializer);
// Produces: const x = initializer;
```

### quoteLet()

Create let declaration:

```typescript
import { quoteLet } from "@typesugar/macros";

const decl = quoteLet(ctx, "x", initializer);
// Produces: let x = initializer;
```

### quoteReturn()

Create return statement:

```typescript
import { quoteReturn } from "@typesugar/macros";

const ret = quoteReturn(ctx, expr);
// Produces: return expr;
```

### quoteIf()

Create if statement:

```typescript
import { quoteIf } from "@typesugar/macros";

const ifStmt = quoteIf(ctx, condition, thenBlock, elseBlock);
// Produces: if (condition) { thenBlock } else { elseBlock }
```

### quoteArrow()

Create arrow function:

```typescript
import { quoteArrow } from "@typesugar/macros";

const arrow = quoteArrow(ctx, ["x", "y"], quote(ctx)`${ident("x")} + ${ident("y")}`);
// Produces: (x, y) => x + y
```

### quoteFunction()

Create function declaration:

```typescript
import { quoteFunction } from "@typesugar/macros";

const fn = quoteFunction(
  ctx,
  "add",
  [{ name: "a" }, { name: "b" }], // each: { name, type?, optional? }
  [quoteReturn(ctx, quote(ctx)`${ident("a")} + ${ident("b")}`)]
);
// Produces: function add(a, b) { return a + b; }
```

## Complex Example

Building a memoization wrapper:

```typescript
import { defineExpressionMacro, globalRegistry } from "@typesugar/core";
import { quote } from "@typesugar/macros";

globalRegistry.register(
  defineExpressionMacro({
    name: "memoize",
    expand(ctx, callExpr, args) {
      const fn = args[0];
      if (!fn) {
        ctx.reportError(callExpr, "memoize() requires a function");
        return callExpr;
      }
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
  })
);
```

## Nesting Quotes

Quotes can be nested:

```typescript
const inner = quote(ctx)`x + y`;
const outer = quote(ctx)`${inner} * 2`;
// Produces: (x + y) * 2   (a spliced expression is parenthesized as one operand)
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

`spread()` splices statements, not expressions, so build array literals with the factory:

```typescript
const arr = ctx.factory.createArrayLiteralExpression(elements);
// Produces: [1, 2]
```

### Template Literal

```typescript
const template = quote(ctx)`
  \`Hello, \${${name}}!\`
`;
```

## Limitations

1. **No control flow in templates**: Use helpers for if/else
2. **Statements vs expressions**: Use the right quote function. `quote()` parses one
   expression, so a declaration such as `const x = 1` needs `quoteStatements()`
3. **Splices are nodes**: Interpolating a string with `${}` that isn't wrapped in
   `ident()` or `raw()`, or joining nodes into a string, does not produce valid code
4. **Escaping**: Use `\\` for literal backslashes in templates

## Best Practices

1. **Default to `ctx.factory`**: Quasiquote where a template is clearly easier to read
2. **Use helpers**: `quoteIf`, `quoteConst`, etc. for common patterns
3. **Generate unique names**: Avoid variable capture
4. **Keep templates readable**: Break complex templates into parts
