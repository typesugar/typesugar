# Tagged Template Macros

Tagged template macros process template literals at compile time.

## When to Use

- Create DSLs: `` query`SELECT ...` ``
- Validate at compile time: `` pattern`[a-z]+` ``
- Transform templates: `` html`<div>...</div>` ``
- Embed external content

## Basic Structure

```typescript
import { defineTaggedTemplateMacro, globalRegistry } from "@typesugar/core";
import * as ts from "typescript";

globalRegistry.register(
  defineTaggedTemplateMacro({
    name: "myTag",
    expand(ctx, node) {
      const template = node.template;
      // Handle the template...
      return ctx.createStringLiteral("result");
    },
  })
);
```

```typescript
// src/index.ts — runtime placeholder
export function myTag(strings: TemplateStringsArray, ...values: unknown[]): string {
  throw new Error("myTag should be compiled away");
}
```

Tag names are global: typesugar's own packages register `sql`, `regex`, `html`, `fmt`,
`raw` and others, so pick a name that doesn't clash.

## Template Structure

A tagged template has two cases:

### No Substitutions

```typescript
tag`hello world`;
// template is NoSubstitutionTemplateLiteral
// template.text = "hello world"
```

### With Substitutions

```typescript
tag`hello ${name}!`;
// template is TemplateExpression
// template.head.text = "hello "
// template.templateSpans[0].expression = name
// template.templateSpans[0].literal.text = "!"
```

## Tutorial: Creating `upper`

A tag that uppercases static strings at compile time:

```typescript
globalRegistry.register(
  defineTaggedTemplateMacro({
    name: "upper",
    expand(ctx, node) {
      const template = node.template;

      if (ts.isNoSubstitutionTemplateLiteral(template)) {
        // Simple case: no interpolations
        return ctx.createStringLiteral(template.text.toUpperCase());
      }

      // With interpolations: uppercase static parts, keep dynamic ones
      const f = ctx.factory;
      const head = f.createTemplateHead(template.head.text.toUpperCase());
      const spans = template.templateSpans.map((span, i) => {
        const isLast = i === template.templateSpans.length - 1;
        const literal = isLast
          ? f.createTemplateTail(span.literal.text.toUpperCase())
          : f.createTemplateMiddle(span.literal.text.toUpperCase());
        return f.createTemplateSpan(span.expression, literal);
      });
      return f.createTemplateExpression(head, spans);
    },
  })
);

// upper`hello ${name}!`  →  `HELLO ${name}!`
```

## Tutorial: Creating `query`

Parameterized SQL-style queries:

```typescript
globalRegistry.register(
  defineTaggedTemplateMacro({
    name: "query",
    expand(ctx, node) {
      const f = ctx.factory;
      const template = node.template;
      let text: string;
      const params: ts.Expression[] = [];

      if (ts.isNoSubstitutionTemplateLiteral(template)) {
        text = template.text;
      } else {
        text = template.head.text;
        template.templateSpans.forEach((span, i) => {
          params.push(span.expression);
          text += `$${i + 1}${span.literal.text}`;
        });
      }

      // { text: "...", params: [a, b] }
      return f.createObjectLiteralExpression([
        f.createPropertyAssignment("text", f.createStringLiteral(text)),
        f.createPropertyAssignment("params", f.createArrayLiteralExpression(params)),
      ]);
    },
  })
);
```

```typescript
const q1 = query`SELECT * FROM users`;
const q2 = query`SELECT * FROM users WHERE id = ${id} AND name = ${name}`;

// Compiles to:
const q1 = { text: "SELECT * FROM users", params: [] };
const q2 = { text: "SELECT * FROM users WHERE id = $1 AND name = $2", params: [id, name] };
```

The interpolated expressions are passed to `createArrayLiteralExpression` as nodes. Don't
turn nodes into strings to build code.

## Compile-Time Validation

Validate templates at build time:

```typescript
globalRegistry.register(
  defineTaggedTemplateMacro({
    name: "pattern",
    expand(ctx, node) {
      const template = node.template;
      if (!ts.isNoSubstitutionTemplateLiteral(template)) {
        ctx.reportError(node, "pattern does not support interpolations");
        return node;
      }

      const source = template.text;
      try {
        new RegExp(source);
      } catch (e) {
        ctx.reportError(node, (e as Error).message);
        return node;
      }

      return ctx.factory.createRegularExpressionLiteral(`/${source.replace(/\//g, "\\/")}/`);
    },
  })
);

// pattern`[a-z]+`  →  /[a-z]+/
// pattern`[a-z`    →  error: Invalid regular expression: /[a-z/: Unterminated character class
```

## Accessing Type Arguments

Some tagged templates have type arguments:

```typescript
tag<Type>`template`;
// node.typeArguments contains [Type]
```

```typescript
globalRegistry.register(
  defineTaggedTemplateMacro({
    name: "typed",
    expand(ctx, node) {
      const typeArg = node.typeArguments?.[0];
      const typeText = typeArg ? typeArg.getText(ctx.sourceFile) : "unknown";
      return ctx.createStringLiteral(`${typeText}: ${node.template.getText(ctx.sourceFile)}`);
    },
  })
);

// typed<number>`x`  →  "number: `x`"
```

## Returning Complex Types

Generate typed objects:

```typescript
globalRegistry.register(
  defineTaggedTemplateMacro({
    name: "config",
    expand(ctx, node) {
      const template = node.template;
      if (!ts.isNoSubstitutionTemplateLiteral(template)) {
        ctx.reportError(node, "config requires a static template");
        return node;
      }

      // Parse "key: value" lines at compile time
      const f = ctx.factory;
      const props: ts.PropertyAssignment[] = [];
      for (const line of template.text.trim().split("\n")) {
        const [key, value] = line.split(":").map((s) => s.trim());
        if (key && value) props.push(f.createPropertyAssignment(key, f.createStringLiteral(value)));
      }
      return f.createObjectLiteralExpression(props, true);
    },
  })
);

// config`
//   host: localhost
//   port: 8080
// `
// → { host: "localhost", port: "8080" }
```

## Handling Raw Strings

`rawText` is the template text exactly as written, with escapes not processed:

```typescript
globalRegistry.register(
  defineTaggedTemplateMacro({
    name: "verbatim",
    expand(ctx, node) {
      const template = node.template;
      if (!ts.isNoSubstitutionTemplateLiteral(template)) {
        ctx.reportError(node, "verbatim does not support interpolations");
        return node;
      }
      return ctx.createStringLiteral(template.rawText ?? template.text);
    },
  })
);

// verbatim`a\nb` is the 4-character string a\nb (a backslash, not a newline)
```

## Error Reporting

Provide helpful compile-time errors. This tag parses JSON at build time and turns the value
into AST:

```typescript
import type { MacroContext } from "@typesugar/core";

/** Turn a JSON value into an AST expression. */
function jsonToAst(ctx: MacroContext, value: unknown): ts.Expression {
  const f = ctx.factory;
  if (value === null) return f.createNull();
  if (Array.isArray(value))
    return f.createArrayLiteralExpression(value.map((v) => jsonToAst(ctx, v)));
  switch (typeof value) {
    case "string":
      return f.createStringLiteral(value);
    case "number":
      return value < 0
        ? f.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, f.createNumericLiteral(-value))
        : f.createNumericLiteral(value);
    case "boolean":
      return value ? f.createTrue() : f.createFalse();
    default:
      return f.createObjectLiteralExpression(
        Object.entries(value as object).map(([k, v]) =>
          f.createPropertyAssignment(f.createStringLiteral(k), jsonToAst(ctx, v))
        )
      );
  }
}

globalRegistry.register(
  defineTaggedTemplateMacro({
    name: "json",
    expand(ctx, node) {
      const template = node.template;
      if (!ts.isNoSubstitutionTemplateLiteral(template)) {
        ctx.reportError(node, "json requires a static template");
        return node;
      }
      try {
        return jsonToAst(ctx, JSON.parse(template.text));
      } catch (e) {
        ctx.reportError(node, `Invalid JSON: ${(e as Error).message}`);
        return node;
      }
    },
  })
);

// json`{"a": [1, -2, true, null]}`  →  { "a": [1, -2, true, null] }
// json`{a:1}`  →  error: Invalid JSON: Expected property name or '}' in JSON at position 1 ...
```

(Negative numbers need `createPrefixUnaryExpression`: `createNumericLiteral` only accepts
non-negative values.)

## Testing Tagged Templates

```typescript
import { describe, it, expect } from "vitest";
import { transformCode } from "@typesugar/transformer";
import "../src/macros"; // registers query

describe("query tag", () => {
  it("extracts parameters", () => {
    const result = transformCode(
      `
      import { query } from "./macros";
      const id = 42;
      const q = query\`SELECT * FROM users WHERE id = \${id}\`;
      `,
      { fileName: "test.ts" }
    );
    expect(result.code).toContain('text: "SELECT * FROM users WHERE id = $1"');
    expect(result.code).toContain("params: [id]");
  });
});
```

See [Testing Macros](./testing-macros.md) for running the output.

## Best Practices

1. **Handle both template types**: NoSubstitutionTemplateLiteral and TemplateExpression
2. **Validate early**: Catch errors at compile time
3. **Report on the right node**: Pass the template (or a span) to `ctx.reportError` so the error points at it
4. **Type the output**: Generate well-typed code
5. **Document syntax**: Explain what the tag expects

## Next Steps

- [Expression Macros](./expression-macros.md) — Function call macros
- [Testing Macros](./testing-macros.md) — Verifying macro output
