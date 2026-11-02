# Attribute Macros

Attribute macros transform decorated declarations (classes, functions, methods).

## When to Use

- Transform classes: `@myMacro class Foo {}`
- Transform methods and functions: `@myMacro greet() {}`
- Add methods or properties
- Generate companion code

## Basic Structure

```typescript
import { defineAttributeMacro, globalRegistry } from "@typesugar/core";
import * as ts from "typescript";

globalRegistry.register(
  defineAttributeMacro({
    name: "myMacro",
    validTargets: ["class"], // required: where the decorator may appear
    expand(ctx, decorator, target, args) {
      // decorator: the @myMacro(...) node
      // target: the decorated class/method/etc. (typed ts.Node; narrow it with ts.isXxx)
      // args: decorator arguments

      // Return the transformed node (or an array of nodes)
      return target;
    },
  })
);
```

`validTargets` is required. The possible values are `"class"`, `"method"`, `"property"`,
`"function"`, `"parameter"`, `"interface"` and `"type"`.

The transformer removes the `@myMacro` decorator from the output even if `expand` returns
the target unchanged, so the placeholder never runs. Users still need a placeholder to
import, so their editor accepts the decorator:

```typescript
// src/index.ts
export function myMacro(...args: unknown[]): any {}
```

## Tutorial: Creating `@logged`

A decorator that logs method entry and exit.

```typescript
import { defineAttributeMacro, globalRegistry, type MacroContext } from "@typesugar/core";
import * as ts from "typescript";

function logStatement(ctx: MacroContext, text: string): ts.Statement {
  const f = ctx.factory;
  return f.createExpressionStatement(
    f.createCallExpression(
      f.createPropertyAccessExpression(f.createIdentifier("console"), "log"),
      undefined,
      [f.createStringLiteral(text)]
    )
  );
}

globalRegistry.register(
  defineAttributeMacro({
    name: "logged",
    validTargets: ["method"],
    expand(ctx, decorator, target) {
      if (!ts.isMethodDeclaration(target) || !target.body) {
        ctx.reportError(decorator, "@logged can only be applied to methods with a body");
        return target;
      }
      const f = ctx.factory;
      const methodName = target.name.getText(ctx.sourceFile);

      // { console.log("Entering m"); try { <body> } finally { console.log("Exiting m"); } }
      const newBody = f.createBlock(
        [
          logStatement(ctx, `Entering ${methodName}`),
          f.createTryStatement(
            target.body,
            undefined,
            f.createBlock([logStatement(ctx, `Exiting ${methodName}`)])
          ),
        ],
        true
      );

      return f.updateMethodDeclaration(
        target,
        target.modifiers?.filter((m) => !ts.isDecorator(m)),
        target.asteriskToken,
        target.name,
        target.questionToken,
        target.typeParameters,
        target.parameters,
        target.type,
        newBody
      );
    },
  })
);
```

Usage and output:

```typescript
class Service {
  @logged
  greet(name: string): string {
    return `hi ${name}`;
  }
}

// Compiles to:
class Service {
  greet(name: string): string {
    console.log("Entering greet");
    try {
      return `hi ${name}`;
    } finally {
      console.log("Exiting greet");
    }
  }
}
```

## Class Decorators

Transform entire classes. This `@singleton` adds a module-level accessor next to the class,
using a [quasiquote](./quasiquoting.md) for the generated code:

```typescript
import { quoteStatements, ident } from "@typesugar/macros";

globalRegistry.register(
  defineAttributeMacro({
    name: "singleton",
    validTargets: ["class"],
    expand(ctx, decorator, target) {
      if (!ts.isClassDeclaration(target) || !target.name) {
        ctx.reportError(decorator, "@singleton needs a named class");
        return target;
      }
      const className = target.name.text;
      const instance = ctx.generateUniqueName("instance");
      const cls = ctx.factory.updateClassDeclaration(
        target,
        target.modifiers?.filter((m) => !ts.isDecorator(m)),
        target.name,
        target.typeParameters,
        target.heritageClauses,
        target.members
      );
      return [
        cls,
        ...quoteStatements(ctx)`
          let ${instance}: ${ident(className)} | undefined;
          export function get${ident(className)}(): ${ident(className)} {
            return (${instance} ??= new ${ident(className)}());
          }
        `,
      ];
    },
  })
);

// @singleton class Config { value = 7; }
// → class Config { value = 7; }
//   let __typesugar_instance_…__: Config | undefined;
//   export function getConfig(): Config { return (__typesugar_instance_…__ ??= new Config()); }
```

## Decorator Arguments

Access decorator arguments through `args`:

```typescript
globalRegistry.register(
  defineAttributeMacro({
    name: "route",
    validTargets: ["method"],
    expand(ctx, decorator, target, args) {
      const [path] = args;
      if (!path || !ts.isStringLiteral(path)) {
        ctx.reportError(decorator, '@route needs a string literal path, e.g. @route("/users")');
        return target;
      }
      if (!path.text.startsWith("/")) {
        ctx.reportWarning(path, `route path "${path.text}" should start with "/"`);
      }
      return target;
    },
  })
);

// Usage: @route("/users")
// @route("users") compiles, with the warning: route path "users" should start with "/"
```

## Returning Multiple Nodes

Attribute macros can return an array. This one keeps the class and adds a factory function
after it:

```typescript
globalRegistry.register(
  defineAttributeMacro({
    name: "withFactory",
    validTargets: ["class"],
    expand(ctx, decorator, target) {
      if (!ts.isClassDeclaration(target) || !target.name) {
        ctx.reportError(decorator, "@withFactory needs a named class");
        return target;
      }
      const f = ctx.factory;
      const className = target.name.text;
      const args = f.createIdentifier("args");

      // function createX(...args: ConstructorParameters<typeof X>): X { return new X(...args); }
      const factoryFn = f.createFunctionDeclaration(
        undefined,
        undefined,
        `create${className}`,
        undefined,
        [
          f.createParameterDeclaration(
            undefined,
            f.createToken(ts.SyntaxKind.DotDotDotToken),
            args,
            undefined,
            f.createTypeReferenceNode("ConstructorParameters", [
              f.createTypeQueryNode(f.createIdentifier(className)),
            ])
          ),
        ],
        f.createTypeReferenceNode(className),
        f.createBlock([
          f.createReturnStatement(
            f.createNewExpression(f.createIdentifier(className), undefined, [
              f.createSpreadElement(args),
            ])
          ),
        ])
      );
      return [target, factoryFn];
    },
  })
);

// @withFactory class Box { constructor(public v: number) {} }
// → class Box { constructor(public v: number) { } }
//   function createBox(...args: ConstructorParameters<typeof Box>): Box { return new Box(...args); }
```

Generated declarations exist only in the output. The user's editor doesn't know about
`createBox` unless you also ship a declaration for it.

## Modifying Class Members

Add methods to a class:

```typescript
globalRegistry.register(
  defineAttributeMacro({
    name: "addToString",
    validTargets: ["class"],
    expand(ctx, decorator, target) {
      if (!ts.isClassDeclaration(target)) return target;
      const f = ctx.factory;
      const className = target.name?.text ?? "?";

      const toStringMethod = f.createMethodDeclaration(
        undefined,
        undefined,
        "toString",
        undefined,
        undefined,
        [],
        f.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
        f.createBlock([f.createReturnStatement(f.createStringLiteral(`[${className}]`))])
      );

      return f.updateClassDeclaration(
        target,
        target.modifiers?.filter((m) => !ts.isDecorator(m)),
        target.name,
        target.typeParameters,
        target.heritageClauses,
        [...target.members, toStringMethod]
      );
    },
  })
);

// String(new Point(1, 2)) === "[Point]"
```

## Decorator Ordering

When several attribute or derive macros decorate the same declaration, use `expandAfter`
to say which must run first:

```typescript
globalRegistry.register(
  defineAttributeMacro({
    name: "dependent",
    validTargets: ["class"],
    expandAfter: ["prerequisite"], // @prerequisite expands before @dependent
    expand(ctx, decorator, target) {
      return target;
    },
  })
);
```

`expandAfter` only orders macros on the same node; the transformer is a single top-to-bottom
pass over the file.

## Type Information

Use the type checker on the decorated declaration. This macro adds a static list of the
class's property names:

```typescript
globalRegistry.register(
  defineAttributeMacro({
    name: "fieldList",
    validTargets: ["class"],
    expand(ctx, decorator, target) {
      if (!ts.isClassDeclaration(target) || !target.name) return target;
      const f = ctx.factory;
      const type = ctx.typeChecker.getTypeAtLocation(target);
      const names = ctx
        .getPropertiesOfType(type)
        .map((p) => p.getName())
        .filter((n) => n !== "prototype");

      // static readonly fields = ["a", "b"];
      const fieldsProp = f.createPropertyDeclaration(
        [f.createToken(ts.SyntaxKind.StaticKeyword), f.createToken(ts.SyntaxKind.ReadonlyKeyword)],
        "fields",
        undefined,
        undefined,
        f.createArrayLiteralExpression(names.map((n) => f.createStringLiteral(n)))
      );
      return f.updateClassDeclaration(
        target,
        target.modifiers?.filter((m) => !ts.isDecorator(m)),
        target.name,
        target.typeParameters,
        target.heritageClauses,
        [...target.members, fieldsProp]
      );
    },
  })
);

// @fieldList class Pair { a = 1; b = "two"; }
// → class Pair { a = 1; b = "two"; static readonly fields = ["a", "b"]; }
```

`target` here is real user source, so the checker can be asked about it. A node your
macro (or another macro) generated has no position, and checker calls on it can throw;
check `isSyntheticNode(node)` from `@typesugar/core` first.

## Error Handling

Report errors and return the original:

```typescript
globalRegistry.register(
  defineAttributeMacro({
    name: "requireClass",
    validTargets: ["class"],
    expand(ctx, decorator, target) {
      if (!ts.isClassDeclaration(target)) {
        ctx.reportError(decorator, "@requireClass can only decorate classes");
        return target; // Return unchanged
      }
      if (!target.name) {
        ctx.reportError(target, "@requireClass requires a named class");
        return target;
      }
      // Transform...
      return target;
    },
  })
);
```

## Best Practices

1. **Set `validTargets`** and still check the target's kind with `ts.isXxx`
2. **Preserve modifiers**: Filter out only the decorators, keep `export`, `async` and so on
3. **Handle missing body**: Methods/functions might be abstract or overloads
4. **Use updateXxx**: Preserve node properties you don't change
5. **Report clear errors**: Tell users what went wrong

## Next Steps

- [Derive Macros](./derive-macros.md) — Specialized attribute macros
- [Quasiquoting](./quasiquoting.md) — Building AST with `quote()`
- [Testing Macros](./testing-macros.md) — Verifying macro output
