# Type Macros

Type macros transform type references at compile time.

## When to Use

- Create computed types
- Transform type parameters
- Generate type aliases
- Implement type-level logic

## Basic Structure

```typescript
import { defineTypeMacro, globalRegistry } from "@typesugar/core";
import * as ts from "typescript";

globalRegistry.register(
  defineTypeMacro({
    name: "MyType",
    expand(ctx, typeRef, args) {
      // typeRef: the MyType<...> reference; args: its type arguments
      // Return a new type node
      return ctx.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword);
    },
  })
);
```

The transformer replaces every `MyType<...>` reference in the output. The user's editor
still type-checks against whatever `MyType` it can see, so ship a placeholder type with the
same meaning:

```typescript
// src/index.ts
export type MyType<T> = string;
```

Don't name a type macro after a built-in type such as `Readonly` or `Partial`: it would
replace every use of that name in files where it is registered.

## Tutorial: Creating `Nullable<T>`

```typescript
globalRegistry.register(
  defineTypeMacro({
    name: "Nullable",
    expand(ctx, typeRef, args) {
      if (args.length === 0) {
        ctx.reportError(typeRef, "Nullable requires a type argument");
        return typeRef;
      }
      const f = ctx.factory;
      // T | null | undefined
      return f.createUnionTypeNode([
        args[0],
        f.createLiteralTypeNode(f.createNull()),
        f.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword),
      ]);
    },
  })
);
```

Usage:

```typescript
import type { Nullable } from "./macros"; // export type Nullable<T> = T | null | undefined;

type MaybeString = Nullable<string>;
// Expands to: type MaybeString = string | null | undefined;
```

## Creating Union Types

```typescript
globalRegistry.register(
  defineTypeMacro({
    name: "OneOf",
    expand(ctx, typeRef, args) {
      if (args.length === 0) return ctx.factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword);
      return ctx.factory.createUnionTypeNode([...args]);
    },
  })
);

// OneOf<string, number, boolean>
// → string | number | boolean
```

## Creating Intersection Types

```typescript
globalRegistry.register(
  defineTypeMacro({
    name: "AllOf",
    expand(ctx, typeRef, args) {
      if (args.length === 0) return ctx.factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword);
      return ctx.factory.createIntersectionTypeNode([...args]);
    },
  })
);

// AllOf<{ a: 1 }, { b: 2 }>
// → { a: 1 } & { b: 2 }
```

## Object Types

Generate object type literals:

```typescript
globalRegistry.register(
  defineTypeMacro({
    name: "WithId",
    expand(ctx, typeRef, args) {
      if (args.length === 0) {
        ctx.reportError(typeRef, "WithId requires a type argument");
        return typeRef;
      }
      const f = ctx.factory;
      // { id: string } & T
      return f.createIntersectionTypeNode([
        f.createTypeLiteralNode([
          f.createPropertySignature(
            undefined,
            "id",
            undefined,
            f.createKeywordTypeNode(ts.SyntaxKind.StringKeyword)
          ),
        ]),
        args[0],
      ]);
    },
  })
);

// WithId<{ name: string }>
// → { id: string } & { name: string }
```

## Mapped Types

Create mapped types programmatically:

```typescript
globalRegistry.register(
  defineTypeMacro({
    name: "Frozen",
    expand(ctx, typeRef, args) {
      if (!args[0]) return typeRef;
      const f = ctx.factory;
      // { readonly [K in keyof T]: T[K] }
      return f.createMappedTypeNode(
        f.createToken(ts.SyntaxKind.ReadonlyKeyword),
        f.createTypeParameterDeclaration(
          undefined,
          "K",
          f.createTypeOperatorNode(ts.SyntaxKind.KeyOfKeyword, args[0])
        ),
        undefined,
        undefined,
        f.createIndexedAccessTypeNode(args[0], f.createTypeReferenceNode("K")),
        undefined
      );
    },
  })
);

// Frozen<{ a: number }>
// → { readonly [K in keyof { a: number }]: { a: number }[K] }
```

## Conditional Types

Generate conditional types:

```typescript
globalRegistry.register(
  defineTypeMacro({
    name: "UnwrapPromise",
    expand(ctx, typeRef, args) {
      if (!args[0]) return typeRef;
      const f = ctx.factory;
      // T extends Promise<infer U> ? U : T
      return f.createConditionalTypeNode(
        args[0],
        f.createTypeReferenceNode("Promise", [
          f.createInferTypeNode(f.createTypeParameterDeclaration(undefined, "U")),
        ]),
        f.createTypeReferenceNode("U"),
        args[0]
      );
    },
  })
);

// UnwrapPromise<Promise<number>>
// → Promise<number> extends Promise<infer U> ? U : Promise<number>   (which is number)
```

## Tuple Types

```typescript
globalRegistry.register(
  defineTypeMacro({
    name: "Pair",
    expand(ctx, typeRef, args) {
      if (args.length < 2) {
        ctx.reportError(typeRef, "Pair requires two type arguments");
        return typeRef;
      }
      return ctx.factory.createTupleTypeNode([args[0], args[1]]);
    },
  })
);

// Pair<string, number>
// → [string, number]
```

## Function Types

```typescript
globalRegistry.register(
  defineTypeMacro({
    name: "Handler",
    expand(ctx, typeRef, args) {
      if (!args[0]) return typeRef;
      const f = ctx.factory;
      // (event: T) => void
      return f.createFunctionTypeNode(
        undefined,
        [f.createParameterDeclaration(undefined, undefined, "event", undefined, args[0])],
        f.createKeywordTypeNode(ts.SyntaxKind.VoidKeyword)
      );
    },
  })
);

// Handler<MouseEvent>
// → (event: MouseEvent) => void
```

## Error Handling

```typescript
globalRegistry.register(
  defineTypeMacro({
    name: "RequiredArgs",
    expand(ctx, typeRef, args) {
      if (args.length < 2) {
        ctx.reportError(typeRef, "RequiredArgs requires exactly 2 type arguments");
        return ctx.factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword);
      }
      // Process args...
      return args[0];
    },
  })
);
```

## Testing Type Macros

```typescript
import { describe, it, expect } from "vitest";
import { transformCode } from "@typesugar/transformer";
import "../src/macros"; // registers Nullable

describe("Nullable type", () => {
  it("creates a union with null and undefined", () => {
    const result = transformCode(`type MaybeString = Nullable<string>; export {};`, {
      fileName: "test.ts",
    });
    expect(result.code).toContain("type MaybeString = string | null | undefined;");
  });
});
```

## Best Practices

1. **Validate arguments**: Check count and types
2. **Return `never` on error**: Indicates invalid usage
3. **Preserve readability**: Generated types should be understandable
4. **Document constraints**: Explain type parameter requirements
5. **Ship a matching placeholder type**: Editors and plain `tsc` only see that

## Limitations

- A type macro rewrites the type in the transformer's output. It is not a runtime feature,
  and it cannot see runtime values
- Editors that don't run the transformer see your placeholder type, not the expansion
- Limited to what TypeScript's type system supports

## Next Steps

- [Expression Macros](./expression-macros.md) — Runtime transformations
- [Testing Macros](./testing-macros.md) — Verifying macro output
