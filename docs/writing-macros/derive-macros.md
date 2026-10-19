# Derive Macros

Derive macros generate code from type structure, triggered by `@derive(MyDerive)`. The
built-in derives (`Eq`, `Ord`, `Clone`, …) generate typeclass instances that work with
`summon()`; a custom derive generates whatever statements you return.

## When to Use

- Generate implementations based on fields
- Create serialization/deserialization
- Build type guards
- Generate default values or constructors

## Basic Structure

```typescript
import { defineDeriveMacro, globalRegistry } from "@typesugar/core";
import * as ts from "typescript";

globalRegistry.register(
  defineDeriveMacro({
    name: "MyDerive",
    expand(ctx, target, typeInfo) {
      // target: the interface, class or type alias carrying @derive(MyDerive)
      // typeInfo: name, fields, kind, variants, ... (see below)

      // Return ONLY the new statements. They are inserted after the declaration,
      // which stays in place, so do not return `target` itself.
      return [];
    },
  })
);
```

Users write `@derive(MyDerive)` with `derive` imported from `typesugar` (or
`@typesugar/derive`). `MyDerive` itself needs no import.

## DeriveTypeInfo Structure

```typescript
interface DeriveTypeInfo {
  name: string; // "User"
  fields: DeriveFieldInfo[]; // properties (for product types)
  typeParameters: ts.TypeParameterDeclaration[]; // generic params, [] if none
  type: ts.Type;
  kind: "product" | "sum" | "primitive";
  variants?: DeriveVariantInfo[]; // for sum types (discriminated unions)
  discriminant?: string; // for sum types: "kind", "_tag", "type", ...
  isRecursive?: boolean;
}

interface DeriveVariantInfo {
  tag: string; // discriminant value: "circle"
  typeName: string; // variant type name: "Circle"
  fields: DeriveFieldInfo[]; // fields other than the discriminant
}

interface DeriveFieldInfo {
  name: string; // "email"
  typeString: string; // "string"
  type: ts.Type;
  optional: boolean;
  readonly: boolean;
}
```

## Tutorial: Creating `@derive(Printable)`

`Printable` generates a `printUser(value)` function that formats every field:

```typescript
import { defineDeriveMacro, globalRegistry } from "@typesugar/core";
import * as ts from "typescript";

globalRegistry.register(
  defineDeriveMacro({
    name: "Printable",
    expand(ctx, target, typeInfo) {
      const f = ctx.factory;
      const { name, fields } = typeInfo;
      const value = f.createIdentifier("value");

      // `User { name: ${value.name}, age: ${value.age} }`
      const spans = fields.map((field, i) => {
        const last = i === fields.length - 1;
        const text = last ? " }" : `, ${fields[i + 1].name}: `;
        return f.createTemplateSpan(
          f.createPropertyAccessExpression(value, field.name),
          last ? f.createTemplateTail(text) : f.createTemplateMiddle(text)
        );
      });
      const body =
        fields.length === 0
          ? f.createNoSubstitutionTemplateLiteral(`${name} {}`)
          : f.createTemplateExpression(
              f.createTemplateHead(`${name} { ${fields[0].name}: `),
              spans
            );

      // export function printUser<T...>(value: User<T...>): string { return `...`; }
      const typeArgs = typeInfo.typeParameters.map((tp) => f.createTypeReferenceNode(tp.name));
      return [
        f.createFunctionDeclaration(
          [f.createModifier(ts.SyntaxKind.ExportKeyword)],
          undefined,
          `print${name}`,
          typeInfo.typeParameters,
          [
            f.createParameterDeclaration(
              undefined,
              undefined,
              value,
              undefined,
              f.createTypeReferenceNode(name, typeArgs.length ? typeArgs : undefined)
            ),
          ],
          f.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
          f.createBlock([f.createReturnStatement(body)])
        ),
      ];
    },
  })
);
```

Usage:

```typescript
import { derive } from "typesugar";

@derive(Printable)
interface User {
  name: string;
  age: number;
}

console.log(printUser({ name: "Alice", age: 30 }));
// User { name: Alice, age: 30 }
```

Compiles to:

```typescript
interface User {
  name: string;
  age: number;
}
export function printUser(value: User): string {
  return `User { name: ${value.name}, age: ${value.age} }`;
}
```

Passing `typeInfo.typeParameters` through makes the generated function generic for a
generic type: `@derive(Printable) interface Box<T> { value: T }` generates
`function printBox<T>(value: Box<T>): string`.

## Handling Different Field Types

Switch on `field.typeString` (or inspect `field.type` with the checker):

```typescript
globalRegistry.register(
  defineDeriveMacro({
    name: "Default",
    expand(ctx, target, typeInfo) {
      const f = ctx.factory;
      if (typeInfo.kind !== "product") {
        ctx.reportError(target, "Default can only be derived for a record type");
        return [];
      }
      const defaultFor = (typeString: string): ts.Expression => {
        if (typeString === "number") return f.createNumericLiteral(0);
        if (typeString === "string") return f.createStringLiteral("");
        if (typeString === "boolean") return f.createFalse();
        if (typeString.endsWith("[]")) return f.createArrayLiteralExpression([]);
        return f.createIdentifier("undefined");
      };
      const props = typeInfo.fields
        .filter((field) => !field.optional) // optional fields may be left out
        .map((field) => f.createPropertyAssignment(field.name, defaultFor(field.typeString)));

      // export function defaultUser(): User { return { name: "", age: 0 }; }
      return [
        f.createFunctionDeclaration(
          [f.createModifier(ts.SyntaxKind.ExportKeyword)],
          undefined,
          `default${typeInfo.name}`,
          undefined,
          [],
          f.createTypeReferenceNode(typeInfo.name),
          f.createBlock([f.createReturnStatement(f.createObjectLiteralExpression(props, true))])
        ),
      ];
    },
  })
);
```

## Sum Types (Discriminated Unions)

For a union of interfaces sharing a discriminant field, `typeInfo.kind` is `"sum"`, and
`variants` and `discriminant` are filled in. This derive generates one type guard per
variant:

```typescript
globalRegistry.register(
  defineDeriveMacro({
    name: "Guards",
    expand(ctx, target, typeInfo) {
      const f = ctx.factory;
      if (typeInfo.kind !== "sum" || !typeInfo.variants || !typeInfo.discriminant) {
        ctx.reportError(target, "Guards requires a discriminated union");
        return [];
      }
      const discriminant = typeInfo.discriminant;

      // export function isCircle(value: Shape): value is Circle { return value.kind === "circle"; }
      return typeInfo.variants.map((variant) =>
        f.createFunctionDeclaration(
          [f.createModifier(ts.SyntaxKind.ExportKeyword)],
          undefined,
          `is${variant.typeName}`,
          undefined,
          [
            f.createParameterDeclaration(
              undefined,
              undefined,
              "value",
              undefined,
              f.createTypeReferenceNode(typeInfo.name)
            ),
          ],
          f.createTypePredicateNode(
            undefined,
            "value",
            f.createTypeReferenceNode(variant.typeName)
          ),
          f.createBlock([
            f.createReturnStatement(
              f.createStrictEquality(
                f.createPropertyAccessExpression(f.createIdentifier("value"), discriminant),
                f.createStringLiteral(variant.tag)
              )
            ),
          ])
        )
      );
    },
  })
);
```

```typescript
interface Circle { kind: "circle"; radius: number }
interface Rect { kind: "rect"; w: number; h: number }

@derive(Guards)
type Shape = Circle | Rect;

// Generates isCircle(value: Shape): value is Circle and isRect(value: Shape): value is Rect
shapes.filter(isCircle);
```

## Simplified Derive API

`@typesugar/macros` has helpers for common shapes. They register the macro for you, and
their callbacks return AST statements:

```typescript
import { defineCustomDerive, defineFieldDerive } from "@typesugar/macros";
import * as ts from "typescript";

// (ctx, info) => ts.Statement[]; info has name, fields (name/type/optional/readonly),
// typeParams, fieldNames, hasField(), getField()
defineCustomDerive("TypeName", (ctx, info) => {
  const f = ctx.factory;
  // export const UserTypeName = "User";
  return [
    f.createVariableStatement(
      [f.createModifier(ts.SyntaxKind.ExportKeyword)],
      f.createVariableDeclarationList(
        [
          f.createVariableDeclaration(
            `${info.name}TypeName`,
            undefined,
            undefined,
            f.createStringLiteral(info.name)
          ),
        ],
        ts.NodeFlags.Const
      )
    ),
  ];
});
```

For field-level derives, the callback runs once per field:

```typescript
// (ctx, typeName, field) => ts.Statement[]
defineFieldDerive("Getters", (ctx, typeName, field) => {
  const f = ctx.factory;
  const cap = field.name[0].toUpperCase() + field.name.slice(1);
  // export function getUserName(value: User) { return value.name; }
  return [
    f.createFunctionDeclaration(
      [f.createModifier(ts.SyntaxKind.ExportKeyword)],
      undefined,
      `get${typeName}${cap}`,
      undefined,
      [
        f.createParameterDeclaration(
          undefined,
          undefined,
          "value",
          undefined,
          f.createTypeReferenceNode(typeName)
        ),
      ],
      undefined,
      f.createBlock([
        f.createReturnStatement(
          f.createPropertyAccessExpression(f.createIdentifier("value"), field.name)
        ),
      ])
    ),
  ];
});
```

## Dependencies Between Derives

There is no `requires` field. If your derive must run after another on the same type, use
`expandAfter`:

```typescript
globalRegistry.register(
  defineDeriveMacro({
    name: "Report",
    expandAfter: ["Printable"], // when both are listed, Printable expands first
    expand(ctx, target, typeInfo) {
      return [];
    },
  })
);
```

`expandAfter` only orders derives that are actually listed; it does not add `Printable` for you.
Report an error if your derive can't work without another one.

## Testing Derives

Expand a file that uses the derive and run the result:

```typescript
import { it, expect } from "vitest";
import { transformCode } from "@typesugar/transformer";
import "../src/macros"; // registers Printable

it("generates printPoint", () => {
  const result = transformCode(
    `
    import { derive } from "typesugar";

    @derive(Printable)
    interface Point { x: number; y: number }
    `,
    { fileName: "test.ts" }
  );
  expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  expect(result.code).toContain("export function printPoint(value: Point): string");
});
```

[Testing Macros](./testing-macros.md) shows how to execute the expanded code.

## Best Practices

1. **Return only new statements**: The declaration stays where it is
2. **Handle all field types**: Primitives, objects, arrays, dates
3. **Support optional fields**: Check `field.optional`
4. **Handle generics**: Pass `typeInfo.typeParameters` through
5. **Generate type-safe code**: Include proper type annotations

## Next Steps

- [Expression Macros](./expression-macros.md) — Function call macros
- [Testing Macros](./testing-macros.md) — Verifying macro output
- [Publishing Macros](./publishing-macros.md) — Distributing derives
