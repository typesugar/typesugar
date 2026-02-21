# Attribute Macros

Attribute macros transform decorated declarations (classes, functions, methods).

## When to Use

- Transform classes: `@myMacro class Foo {}`
- Transform functions: `@myMacro function foo() {}`
- Add methods or properties
- Generate companion code

## Basic Structure

```typescript
import { defineAttributeMacro } from "@typesugar/core";
import * as ts from "typescript";

defineAttributeMacro("myMacro", {
  expand(ctx, decorator, target, args) {
    // decorator: the @myMacro(...) node
    // target: the decorated class/function/etc
    // args: decorator arguments

    // Return the transformed node (or array of nodes)
    return target;
  },
});
```

## Tutorial: Creating `@logged`

A decorator that logs method entry and exit.

```typescript
import { defineAttributeMacro } from "@typesugar/core";
import { quote, quoteStatements, ident, spread } from "@typesugar/core/quote";

defineAttributeMacro("logged", {
  expand(ctx, decorator, target) {
    if (!ts.isMethodDeclaration(target)) {
      ctx.reportError(decorator, "@logged can only be applied to methods");
      return target;
    }

    const methodName = target.name.getText(ctx.sourceFile);
    const params = target.parameters;
    const body = target.body;

    if (!body) return target;

    const newBody = quote(ctx)`{
      console.log("Entering ${methodName}");
      try {
        const __result = (() => ${body})();
        console.log("Exiting ${methodName}");
        return __result;
      } catch (e) {
        console.log("Error in ${methodName}:", e);
        throw e;
      }
    }`;

    return ctx.factory.updateMethodDeclaration(
      target,
      target.modifiers?.filter((m) => !ts.isDecorator(m)),
      target.asteriskToken,
      target.name,
      target.questionToken,
      target.typeParameters,
      target.parameters,
      target.type,
      newBody as ts.Block
    );
  },
});
```

## Class Decorators

Transform entire classes:

```typescript
defineAttributeMacro("singleton", {
  expand(ctx, decorator, target) {
    if (!ts.isClassDeclaration(target)) {
      ctx.reportError(decorator, "@singleton requires a class");
      return target;
    }

    const className = target.name?.getText(ctx.sourceFile) ?? "Anonymous";
    const instanceName = ctx.generateUniqueName("instance");

    return quoteStatements(ctx)`
      ${target}
      
      const ${instanceName}: ${ident(className)} | undefined = undefined;
      
      ${ident(className)}.getInstance = function(): ${ident(className)} {
        if (!${instanceName}) {
          ${instanceName} = new ${ident(className)}();
        }
        return ${instanceName};
      };
    `;
  },
});
```

## Decorator Arguments

Access decorator arguments:

```typescript
defineAttributeMacro("route", {
  expand(ctx, decorator, target, args) {
    // args is ts.NodeArray<ts.Expression>
    const path = args[0];
    const method = args[1];

    if (!path) {
      ctx.reportError(decorator, "@route requires a path argument");
      return target;
    }

    // Use the arguments...
    const pathValue = ctx.evaluate(path);
    console.log("Route path:", pathValue);

    return target;
  },
});

// Usage: @route("/users", "GET")
```

## Returning Multiple Nodes

Attribute macros can return an array:

```typescript
defineAttributeMacro("withFactory", {
  expand(ctx, decorator, target) {
    if (!ts.isClassDeclaration(target)) return target;

    const className = target.name?.getText(ctx.sourceFile);

    // Return the class plus a factory function
    return [
      target,
      ...quoteStatements(ctx)`
        function create${ident(className)}(...args: ConstructorParameters<typeof ${ident(className)}>): ${ident(className)} {
          return new ${ident(className)}(...args);
        }
      `,
    ];
  },
});
```

## Modifying Class Members

Add methods to a class:

```typescript
defineAttributeMacro("addToString", {
  expand(ctx, decorator, target) {
    if (!ts.isClassDeclaration(target)) return target;

    const className = target.name?.getText(ctx.sourceFile) ?? "?";
    const members = [...(target.members ?? [])];

    // Add toString method
    const toStringMethod = ctx.factory.createMethodDeclaration(
      undefined,
      undefined,
      ctx.factory.createIdentifier("toString"),
      undefined,
      undefined,
      [],
      ctx.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
      ctx.factory.createBlock([
        ctx.factory.createReturnStatement(ctx.factory.createStringLiteral(`[${className}]`)),
      ])
    );

    members.push(toStringMethod);

    return ctx.factory.updateClassDeclaration(
      target,
      target.modifiers?.filter((m) => !ts.isDecorator(m)),
      target.name,
      target.typeParameters,
      target.heritageClauses,
      members
    );
  },
});
```

## Decorator Ordering

Multiple decorators are processed in order:

```typescript
@first
@second
@third
class MyClass {}
// Processed: first, then second, then third
```

Use `expandAfter` for dependencies:

```typescript
defineAttributeMacro("dependent", {
  expandAfter: ["prerequisite"],
  expand(ctx, decorator, target) {
    // Runs after @prerequisite
    return target;
  },
});
```

## Type Information

Access type information from the decorated item:

```typescript
defineAttributeMacro("typeInfo", {
  expand(ctx, decorator, target) {
    if (ts.isClassDeclaration(target) && target.name) {
      const type = ctx.typeChecker.getTypeAtLocation(target);
      const props = ctx.getPropertiesOfType(type);

      console.log(
        "Properties:",
        props.map((p) => p.getName())
      );
    }
    return target;
  },
});
```

## Error Handling

Report errors and return the original:

```typescript
defineAttributeMacro("requireClass", {
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
});
```

## Best Practices

1. **Check target type**: Validate the decorator is on the right kind of node
2. **Preserve modifiers**: Don't accidentally remove other decorators
3. **Handle missing body**: Methods/functions might be abstract
4. **Use updateXxx**: Preserve node properties you don't change
5. **Report clear errors**: Tell users what went wrong

## Next Steps

- [Derive Macros](./derive-macros.md) — Specialized attribute macros
- [Quasiquoting](./quasiquoting.md) — Building AST with `quote()`
- [Testing Macros](./testing-macros.md) — Verifying macro output
