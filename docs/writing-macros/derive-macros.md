# Derive Macros

Derive macros generate code from type structure, triggered by `@derive(MyDerive)`.

## When to Use

- Generate implementations based on fields
- Create serialization/deserialization
- Build type guards
- Generate builder patterns

## Basic Structure

```typescript
import { defineDeriveMacro, type DeriveTypeInfo } from "@typesugar/core";
import { quoteStatements } from "@typesugar/core/quote";

defineDeriveMacro("MyDerive", {
  expand(ctx, target, typeInfo: DeriveTypeInfo) {
    // typeInfo contains:
    // - name: string (type name)
    // - fields: FieldInfo[] (properties)
    // - isClass: boolean
    // - isInterface: boolean
    // - variants?: VariantInfo[] (for unions)

    return quoteStatements(ctx)`
      ${target}
      // Generated code here
    `;
  },
});
```

## DeriveTypeInfo Structure

```typescript
interface DeriveTypeInfo {
  name: string; // "User"
  fields: FieldInfo[]; // Properties
  isClass: boolean;
  isInterface: boolean;
  typeParameters?: TypeParam[]; // Generic params
  variants?: VariantInfo[]; // For discriminated unions
}

interface FieldInfo {
  name: string; // "email"
  type: ts.Type; // TypeScript type
  typeString: string; // "string"
  optional: boolean;
  readonly: boolean;
}
```

## Tutorial: Creating `@derive(Printable)`

```typescript
import { defineDeriveMacro } from "@typesugar/core";
import { quoteStatements, ident } from "@typesugar/core/quote";

defineDeriveMacro("Printable", {
  expand(ctx, target, typeInfo) {
    const { name, fields } = typeInfo;

    // Build field printing
    const fieldPrints = fields.map((f) => `  ${f.name}: \${this.${f.name}}`).join(",\\n");

    return quoteStatements(ctx)`
      ${target}
      
      ${ident(name)}.prototype.print = function(): string {
        return \`${name} {
${fieldPrints}
}\`;
      };
    `;
  },
});
```

Usage:

```typescript
@derive(Printable)
class User {
  constructor(
    public name: string,
    public age: number
  ) {}
}

new User("Alice", 30).print();
// User {
//   name: Alice,
//   age: 30
// }
```

## Simplified Derive API

For simple derives, use the simplified API:

```typescript
import { defineCustomDerive } from "@typesugar/core";

// String-based (returns code as string)
defineCustomDerive("Simple", (typeInfo) => {
  return `
    ${typeInfo.name}.prototype.simplify = function() {
      return { type: "${typeInfo.name}" };
    };
  `;
});
```

Or for field-level derives:

```typescript
import { defineFieldDerive } from "@typesugar/core";

defineFieldDerive("Validate", (field) => {
  if (field.typeString === "string") {
    return `if (typeof value.${field.name} !== "string") throw new Error("Invalid ${field.name}");`;
  }
  return "";
});
```

## Handling Different Field Types

```typescript
defineDeriveMacro("Clone", {
  expand(ctx, target, typeInfo) {
    const cloneExprs = typeInfo.fields
      .map((f) => {
        if (f.typeString.startsWith("Array<")) {
          return `${f.name}: [...this.${f.name}]`;
        } else if (f.typeString === "Date") {
          return `${f.name}: new Date(this.${f.name})`;
        } else if (f.typeString.includes("{")) {
          // Object type
          return `${f.name}: { ...this.${f.name} }`;
        } else {
          // Primitive
          return `${f.name}: this.${f.name}`;
        }
      })
      .join(", ");

    return quoteStatements(ctx)`
      ${target}
      
      ${ident(typeInfo.name)}.prototype.clone = function(): ${ident(typeInfo.name)} {
        return new ${ident(typeInfo.name)}(${cloneExprs});
      };
    `;
  },
});
```

## Sum Types (Discriminated Unions)

Handle discriminated unions:

```typescript
defineDeriveMacro("Match", {
  expand(ctx, target, typeInfo) {
    if (!typeInfo.variants) {
      ctx.reportError(target, "Match requires a discriminated union");
      return target;
    }

    const cases = typeInfo.variants
      .map(
        (v) => `
      ${v.discriminant}: (value: ${v.name}) => R
    `
      )
      .join(",\n");

    return quoteStatements(ctx)`
      ${target}
      
      type ${ident(typeInfo.name)}Matcher<R> = {
        ${cases}
      };
      
      function match${ident(typeInfo.name)}<R>(
        value: ${ident(typeInfo.name)},
        matcher: ${ident(typeInfo.name)}Matcher<R>
      ): R {
        return matcher[value.tag](value as any);
      }
    `;
  },
});
```

## Generic Types

Handle generic type parameters:

```typescript
defineDeriveMacro("Functor", {
  expand(ctx, target, typeInfo) {
    if (!typeInfo.typeParameters?.length) {
      ctx.reportError(target, "Functor requires a type parameter");
      return target;
    }

    const typeParam = typeInfo.typeParameters[0].name;

    return quoteStatements(ctx)`
      ${target}
      
      ${ident(typeInfo.name)}.prototype.map = function<B>(
        f: (a: ${ident(typeParam)}) => B
      ): ${ident(typeInfo.name)}<B> {
        // Implementation...
      };
    `;
  },
});
```

## Dependencies Between Derives

Specify that one derive requires another:

```typescript
defineDeriveMacro("Ord", {
  requires: ["Eq"], // Must derive Eq first
  expand(ctx, target, typeInfo) {
    // Can assume equals() exists
    return quoteStatements(ctx)`
      ${target}
      
      ${ident(typeInfo.name)}.prototype.compare = function(other: ${ident(typeInfo.name)}): number {
        // Implementation using equals()...
      };
    `;
  },
});
```

## Static Methods

Add static methods:

```typescript
defineDeriveMacro("Default", {
  expand(ctx, target, typeInfo) {
    const defaults = typeInfo.fields
      .map((f) => {
        switch (f.typeString) {
          case "number":
            return "0";
          case "string":
            return '""';
          case "boolean":
            return "false";
          default:
            return "undefined as any";
        }
      })
      .join(", ");

    return quoteStatements(ctx)`
      ${target}
      
      ${ident(typeInfo.name)}.default = function(): ${ident(typeInfo.name)} {
        return new ${ident(typeInfo.name)}(${defaults});
      };
    `;
  },
});
```

## Testing Derives

```typescript
import { expandCode } from "@typesugar/testing";

describe("Printable derive", () => {
  it("generates print method", async () => {
    const result = await expandCode(`
      import { derive } from "@typesugar/derive";
      
      @derive(Printable)
      class Point {
        constructor(public x: number, public y: number) {}
      }
    `);

    expect(result.code).toContain("Point.prototype.print");
    expect(result.code).toContain("x: ${this.x}");
  });
});
```

## Best Practices

1. **Handle all field types**: Primitives, objects, arrays, dates
2. **Support optional fields**: Check `field.optional`
3. **Handle generics**: Use type parameters correctly
4. **Declare dependencies**: Use `requires` for derive ordering
5. **Generate type-safe code**: Include proper type annotations

## Next Steps

- [Expression Macros](./expression-macros.md) — Function call macros
- [Testing Macros](./testing-macros.md) — Verifying macro output
- [Publishing Macros](./publishing-macros.md) — Distributing derives
