# Type Macros

Type macros transform type references at compile time.

## When to Use

- Create computed types
- Transform type parameters
- Generate type aliases
- Implement type-level logic

## Basic Structure

```typescript
import { defineTypeMacro } from "@typesugar/core";
import * as ts from "typescript";

defineTypeMacro("MyType", {
  expand(ctx, typeRef: ts.TypeReferenceNode): ts.TypeNode {
    // typeRef.typeArguments contains type parameters
    const args = typeRef.typeArguments;

    // Return a new type node
    return ctx.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword);
  },
});
```

## Tutorial: Creating `Nullable<T>`

```typescript
import { defineTypeMacro } from "@typesugar/core";

defineTypeMacro("Nullable", {
  expand(ctx, typeRef) {
    const args = typeRef.typeArguments;

    if (!args || args.length === 0) {
      ctx.reportError(typeRef, "Nullable requires a type argument");
      return typeRef;
    }

    const innerType = args[0];

    // T | null | undefined
    return ctx.factory.createUnionTypeNode([
      innerType,
      ctx.factory.createLiteralTypeNode(ctx.factory.createNull()),
      ctx.factory.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword),
    ]);
  },
});
```

Usage:

```typescript
type MaybeString = Nullable<string>;
// Expands to: string | null | undefined
```

## Creating Union Types

```typescript
defineTypeMacro("OneOf", {
  expand(ctx, typeRef) {
    const args = typeRef.typeArguments;

    if (!args || args.length === 0) {
      return ctx.factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword);
    }

    return ctx.factory.createUnionTypeNode([...args]);
  },
});

// OneOf<string, number, boolean>
// → string | number | boolean
```

## Creating Intersection Types

```typescript
defineTypeMacro("AllOf", {
  expand(ctx, typeRef) {
    const args = typeRef.typeArguments;

    if (!args || args.length === 0) {
      return ctx.factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword);
    }

    return ctx.factory.createIntersectionTypeNode([...args]);
  },
});

// AllOf<A, B, C>
// → A & B & C
```

## Object Types

Generate object type literals:

```typescript
defineTypeMacro("WithId", {
  expand(ctx, typeRef) {
    const args = typeRef.typeArguments;

    if (!args || args.length === 0) {
      ctx.reportError(typeRef, "WithId requires a type argument");
      return typeRef;
    }

    const innerType = args[0];

    // { id: string } & T
    return ctx.factory.createIntersectionTypeNode([
      ctx.factory.createTypeLiteralNode([
        ctx.factory.createPropertySignature(
          undefined,
          ctx.factory.createIdentifier("id"),
          undefined,
          ctx.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword)
        ),
      ]),
      innerType,
    ]);
  },
});

// WithId<{ name: string }>
// → { id: string } & { name: string }
```

## Mapped Types

Create mapped types programmatically:

```typescript
defineTypeMacro("Readonly", {
  expand(ctx, typeRef) {
    const args = typeRef.typeArguments;
    if (!args?.[0]) return typeRef;

    // { readonly [K in keyof T]: T[K] }
    return ctx.factory.createMappedTypeNode(
      ctx.factory.createToken(ts.SyntaxKind.ReadonlyKeyword),
      ctx.factory.createTypeParameterDeclaration(
        undefined,
        ctx.factory.createIdentifier("K"),
        ctx.factory.createTypeOperatorNode(ts.SyntaxKind.KeyOfKeyword, args[0]),
        undefined
      ),
      undefined,
      undefined,
      ctx.factory.createIndexedAccessTypeNode(args[0], ctx.factory.createTypeReferenceNode("K")),
      undefined
    );
  },
});
```

## Conditional Types

Generate conditional types:

```typescript
defineTypeMacro("UnwrapPromise", {
  expand(ctx, typeRef) {
    const args = typeRef.typeArguments;
    if (!args?.[0]) return typeRef;

    // T extends Promise<infer U> ? U : T
    return ctx.factory.createConditionalTypeNode(
      args[0],
      ctx.factory.createTypeReferenceNode("Promise", [
        ctx.factory.createInferTypeNode(
          ctx.factory.createTypeParameterDeclaration(
            undefined,
            ctx.factory.createIdentifier("U"),
            undefined,
            undefined
          )
        ),
      ]),
      ctx.factory.createTypeReferenceNode("U"),
      args[0]
    );
  },
});
```

## Tuple Types

```typescript
defineTypeMacro("Pair", {
  expand(ctx, typeRef) {
    const args = typeRef.typeArguments;

    if (!args || args.length < 2) {
      ctx.reportError(typeRef, "Pair requires two type arguments");
      return typeRef;
    }

    return ctx.factory.createTupleTypeNode([args[0], args[1]]);
  },
});

// Pair<string, number>
// → [string, number]
```

## Function Types

```typescript
defineTypeMacro("Handler", {
  expand(ctx, typeRef) {
    const args = typeRef.typeArguments;
    if (!args?.[0]) return typeRef;

    // (event: T) => void
    return ctx.factory.createFunctionTypeNode(
      undefined,
      [
        ctx.factory.createParameterDeclaration(
          undefined,
          undefined,
          ctx.factory.createIdentifier("event"),
          undefined,
          args[0],
          undefined
        ),
      ],
      ctx.factory.createKeywordTypeNode(ts.SyntaxKind.VoidKeyword)
    );
  },
});

// Handler<MouseEvent>
// → (event: MouseEvent) => void
```

## Type Parameter Constraints

Access and use constraints:

```typescript
defineTypeMacro("Constrained", {
  expand(ctx, typeRef) {
    // Create a type parameter with constraint
    // <T extends object>
    const typeParam = ctx.factory.createTypeParameterDeclaration(
      undefined,
      ctx.factory.createIdentifier("T"),
      ctx.factory.createKeywordTypeNode(ts.SyntaxKind.ObjectKeyword),
      undefined
    );

    // Use in a mapped type...
    return ctx.factory.createMappedTypeNode(/* ... */);
  },
});
```

## Error Handling

```typescript
defineTypeMacro("RequiredArgs", {
  expand(ctx, typeRef) {
    const args = typeRef.typeArguments;

    if (!args || args.length < 2) {
      ctx.reportError(typeRef, "RequiredArgs requires exactly 2 type arguments");
      return ctx.factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword);
    }

    // Process args...
    return args[0];
  },
});
```

## Testing Type Macros

```typescript
import { expandCode } from "@typesugar/testing";

describe("Nullable type", () => {
  it("creates union with null and undefined", async () => {
    const result = await expandCode(`
      type MaybeString = Nullable<string>;
    `);

    expect(result.code).toContain("string | null | undefined");
  });
});
```

## Best Practices

1. **Validate arguments**: Check count and types
2. **Return `never` on error**: Indicates invalid usage
3. **Preserve readability**: Generated types should be understandable
4. **Document constraints**: Explain type parameter requirements

## Limitations

- Type macros run at type-check time, not runtime
- Cannot access runtime values
- Limited to what TypeScript's type system supports

## Next Steps

- [Expression Macros](./expression-macros.md) — Runtime transformations
- [Testing Macros](./testing-macros.md) — Verifying macro output
