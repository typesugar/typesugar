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

Parse a code string into an expression AST. Prefer building nodes with
`ctx.factory`: string→AST parsing round-trips through text, strips source
positions, and throws on malformed input.

```typescript
const expr = ctx.parseExpression("a + b * c");
```

### parseStatements

```typescript
ctx.parseStatements(code: string): ts.Statement[]
```

Parse a code string into statements (same caveat as `parseExpression`).

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
ctx.evaluate(node: ts.Node): ComptimeValue
```

Evaluate an expression at compile time. The result is a tagged union, not a plain
JS value:

```typescript
type ComptimeValue =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "bigint"; value: bigint }
  | { kind: "null" }
  | { kind: "undefined" }
  | { kind: "array"; elements: ComptimeValue[] }
  | { kind: "object"; properties: Map<string, ComptimeValue> }
  | { kind: "function"; fn: (...args: ComptimeValue[]) => ComptimeValue }
  | { kind: "type"; type: ts.Type }
  | { kind: "error"; message: string };
```

```typescript
const v = ctx.evaluate(args[0]);
if (v.kind === "number") {
  return ctx.createNumericLiteral(v.value * 2);
}
if (v.kind === "error") {
  ctx.reportError(args[0], v.message);
}
```

Failure is `{ kind: "error", message }`, never `undefined`.

### isComptime

```typescript
ctx.isComptime(node: ts.Node): boolean
```

Check if a node can be evaluated at compile time.

```typescript
if (ctx.isComptime(arg)) {
  const value = ctx.evaluate(arg); // a ComptimeValue — check value.kind
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
const f = ctx.factory;
const result = ctx.generateUniqueName("result");
// const <result> = <expr>;
const decl = f.createVariableStatement(
  undefined,
  f.createVariableDeclarationList(
    [f.createVariableDeclaration(result, undefined, undefined, expr)],
    ts.NodeFlags.Const
  )
);
```

### safeRef / ensureImport

```typescript
ctx.safeRef(symbol: string, from: string): ts.Identifier
ctx.ensureImport(symbol: string, from: string): ts.Identifier
```

Refer to an export of another module from generated code. `safeRef` returns an
identifier that doesn't collide with a user binding of the same name;
`ensureImport` also adds the `import` to the file if it isn't there.

```typescript
const parseError = ctx.ensureImport("ParseError", "@typesugar/parser");
```

## Diagnostics with Codes

### diagnostic

```typescript
ctx.diagnostic(descriptor: DiagnosticDescriptor) // builder: .at(node).note(...).help(...).emit()
```

Report a catalogued diagnostic (a `TS9xxx` code with notes and help text) instead
of a plain `reportError` string. `ctx.getDiagnostics()` returns everything reported
so far in this context.

## Example Usage

```typescript
import { defineExpressionMacro, globalRegistry } from "@typesugar/core";
import * as ts from "typescript";

export const exampleMacro = defineExpressionMacro({
  name: "example",
  module: "my-macros",
  expand(ctx, callExpr, args) {
    const f = ctx.factory;

    // Validate
    if (args.length === 0) {
      ctx.reportError(callExpr, "Missing argument");
      return callExpr;
    }

    // Evaluate if constant: example(21) → 42
    if (ctx.isComptime(args[0])) {
      const v = ctx.evaluate(args[0]);
      if (v.kind === "number") return ctx.createNumericLiteral(v.value * 2);
    }

    // Otherwise: ((temp) => temp * 2)(arg), with a hygienic parameter name
    const temp = ctx.generateUniqueName("temp");
    const fn = f.createArrowFunction(
      undefined,
      undefined,
      [f.createParameterDeclaration(undefined, undefined, temp)],
      undefined,
      f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      f.createBinaryExpression(temp, ts.SyntaxKind.AsteriskToken, f.createNumericLiteral(2))
    );
    return f.createCallExpression(f.createParenthesizedExpression(fn), undefined, [args[0]]);
  },
});

globalRegistry.register(exampleMacro);
```
