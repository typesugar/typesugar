# MacroContext API

The `MacroContext` is passed to every macro's `expand` function.

## Compiler Access

### program

```typescript
ctx.program: ts.Program
```

The TypeScript program being compiled.

### typeChecker

```typescript
ctx.typeChecker: ts.TypeChecker
```

The TypeScript type checker. Use for type queries:

```typescript
const type = ctx.typeChecker.getTypeAtLocation(node);
const symbol = ctx.typeChecker.getSymbolAtLocation(node);
const signature = ctx.typeChecker.getSignatureFromDeclaration(decl);
```

### sourceFile

```typescript
ctx.sourceFile: ts.SourceFile
```

The current source file being processed.

```typescript
const fileName = ctx.sourceFile.fileName;
const text = node.getText(ctx.sourceFile);
```

### factory

```typescript
ctx.factory: ts.NodeFactory
```

The TypeScript node factory. Use for creating AST nodes:

```typescript
ctx.factory.createIdentifier("name");
ctx.factory.createNumericLiteral(42);
ctx.factory.createBinaryExpression(left, operator, right);
```

### transformContext

```typescript
ctx.transformContext: ts.TransformationContext
```

The transformation context. Rarely needed directly.

## Node Creation Helpers

### createIdentifier

```typescript
ctx.createIdentifier(name: string): ts.Identifier
```

Create an identifier node.

```typescript
const id = ctx.createIdentifier("myVariable");
```

### createStringLiteral

```typescript
ctx.createStringLiteral(value: string): ts.StringLiteral
```

Create a string literal.

```typescript
const str = ctx.createStringLiteral("hello");
```

### createNumericLiteral

```typescript
ctx.createNumericLiteral(value: number): ts.NumericLiteral
```

Create a numeric literal.

```typescript
const num = ctx.createNumericLiteral(42);
```

### createBooleanLiteral

```typescript
ctx.createBooleanLiteral(value: boolean): ts.Expression
```

Create a boolean literal (true or false).

```typescript
const bool = ctx.createBooleanLiteral(true);
```

### createArrayLiteral

```typescript
ctx.createArrayLiteral(elements: ts.Expression[]): ts.ArrayLiteralExpression
```

Create an array literal.

```typescript
const arr = ctx.createArrayLiteral([ctx.createNumericLiteral(1), ctx.createNumericLiteral(2)]);
```

### createObjectLiteral

```typescript
ctx.createObjectLiteral(
  properties: Array<{ name: string; value: ts.Expression }>
): ts.ObjectLiteralExpression
```

Create an object literal.

```typescript
const obj = ctx.createObjectLiteral([
  { name: "x", value: ctx.createNumericLiteral(1) },
  { name: "y", value: ctx.createNumericLiteral(2) },
]);
```

### parseExpression

```typescript
ctx.parseExpression(code: string): ts.Expression
```

Parse a code string into an expression AST.

```typescript
const expr = ctx.parseExpression("a + b * c");
```

### parseStatements

```typescript
ctx.parseStatements(code: string): ts.Statement[]
```

Parse a code string into statements.

```typescript
const stmts = ctx.parseStatements(`
  const x = 1;
  console.log(x);
`);
```

## Type Utilities

### getTypeOf

```typescript
ctx.getTypeOf(node: ts.Node): ts.Type
```

Get the TypeScript type of a node.

```typescript
const type = ctx.getTypeOf(expression);
```

### getTypeString

```typescript
ctx.getTypeString(node: ts.Node): string
```

Get the type as a string representation.

```typescript
const typeStr = ctx.getTypeString(expr);
// e.g., "number", "string[]", "{ x: number; y: number }"
```

### isAssignableTo

```typescript
ctx.isAssignableTo(source: ts.Type, target: ts.Type): boolean
```

Check if source type is assignable to target type.

```typescript
const numberType = ctx.typeChecker.getNumberType();
const argType = ctx.getTypeOf(arg);
if (ctx.isAssignableTo(argType, numberType)) {
  // arg is a number
}
```

### getPropertiesOfType

```typescript
ctx.getPropertiesOfType(type: ts.Type): ts.Symbol[]
```

Get all properties of a type.

```typescript
const type = ctx.getTypeOf(classNode);
const props = ctx.getPropertiesOfType(type);
for (const prop of props) {
  console.log(prop.getName());
}
```

### getSymbol

```typescript
ctx.getSymbol(node: ts.Node): ts.Symbol | undefined
```

Get the symbol for a node.

```typescript
const symbol = ctx.getSymbol(identifier);
if (symbol) {
  const decls = symbol.getDeclarations();
}
```

## Diagnostics

### reportError

```typescript
ctx.reportError(node: ts.Node, message: string): void
```

Report a compile-time error.

```typescript
if (!arg) {
  ctx.reportError(callExpr, "Missing required argument");
  return callExpr;
}
```

### reportWarning

```typescript
ctx.reportWarning(node: ts.Node, message: string): void
```

Report a compile-time warning.

```typescript
if (deprecated) {
  ctx.reportWarning(node, "This API is deprecated");
}
```

## Compile-Time Evaluation

### evaluate

```typescript
ctx.evaluate(node: ts.Node): unknown
```

Evaluate an expression at compile time.

```typescript
const arg = callExpr.arguments[0];
const value = ctx.evaluate(arg);
// value is the JS value (number, string, object, etc.)
```

Returns `undefined` if evaluation fails.

### isComptime

```typescript
ctx.isComptime(node: ts.Node): boolean
```

Check if a node can be evaluated at compile time.

```typescript
if (ctx.isComptime(arg)) {
  const value = ctx.evaluate(arg);
  // Safe to use value
} else {
  ctx.reportError(arg, "Argument must be a compile-time constant");
}
```

## Hygiene

### generateUniqueName

```typescript
ctx.generateUniqueName(prefix: string): ts.Identifier
```

Generate a unique identifier to avoid name collisions.

```typescript
const temp = ctx.generateUniqueName("temp");
// Creates something like __temp_42
```

Use for any generated variables to ensure hygiene:

```typescript
const result = ctx.generateUniqueName("result");
return quote(ctx)`
  const ${result} = ${expr};
  return ${result};
`;
```

## Example Usage

```typescript
defineExpressionMacro("example", {
  expand(ctx, callExpr) {
    // Get arguments
    const args = callExpr.arguments;

    // Validate
    if (args.length === 0) {
      ctx.reportError(callExpr, "Missing argument");
      return callExpr;
    }

    // Get type info
    const argType = ctx.getTypeString(args[0]);

    // Evaluate if constant
    if (ctx.isComptime(args[0])) {
      const value = ctx.evaluate(args[0]);
      return ctx.createNumericLiteral((value as number) * 2);
    }

    // Generate unique name
    const temp = ctx.generateUniqueName("temp");

    // Build result
    return quote(ctx)`
      (() => {
        const ${temp} = ${args[0]};
        return ${temp} * 2;
      })()
    `;
  },
});
```
