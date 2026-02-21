# Tagged Template Macros

Tagged template macros process template literals at compile time.

## When to Use

- Create DSLs: `` sql`SELECT ...` ``
- Validate at compile time: `` regex`[a-z]+` ``
- Transform templates: `` html`<div>...</div>` ``
- Embed external content

## Basic Structure

```typescript
import { defineTaggedTemplateMacro } from "@typesugar/core";
import * as ts from "typescript";

defineTaggedTemplateMacro("myTag", {
  expand(ctx, node: ts.TaggedTemplateExpression): ts.Expression {
    const template = node.template;

    // Handle the template...
    return ctx.createStringLiteral("result");
  },
});

// Runtime placeholder
export function myTag(strings: TemplateStringsArray, ...values: unknown[]): string {
  throw new Error("myTag should be compiled away");
}
```

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
import { defineTaggedTemplateMacro } from "@typesugar/core";
import * as ts from "typescript";

defineTaggedTemplateMacro("upper", {
  expand(ctx, node) {
    const template = node.template;

    if (ts.isNoSubstitutionTemplateLiteral(template)) {
      // Simple case: no interpolations
      return ctx.createStringLiteral(template.text.toUpperCase());
    }

    // With interpolations: uppercase static parts, keep dynamic
    const head = ctx.factory.createTemplateHead(template.head.text.toUpperCase());

    const spans = template.templateSpans.map((span, i) => {
      const isLast = i === template.templateSpans.length - 1;
      const literal = isLast
        ? ctx.factory.createTemplateTail(span.literal.text.toUpperCase())
        : ctx.factory.createTemplateMiddle(span.literal.text.toUpperCase());

      return ctx.factory.createTemplateSpan(span.expression, literal);
    });

    return ctx.factory.createTemplateExpression(head, spans);
  },
});
```

## Tutorial: Creating `sql`

Type-safe SQL with parameterized queries:

```typescript
import { defineTaggedTemplateMacro } from "@typesugar/core";
import { quote } from "@typesugar/core/quote";
import * as ts from "typescript";

defineTaggedTemplateMacro("sql", {
  expand(ctx, node) {
    const template = node.template;

    if (ts.isNoSubstitutionTemplateLiteral(template)) {
      return quote(ctx)`{
        text: ${ctx.createStringLiteral(template.text)},
        params: []
      }`;
    }

    // Build parameterized query
    let text = template.head.text;
    const params: ts.Expression[] = [];

    template.templateSpans.forEach((span, i) => {
      params.push(span.expression);
      text += `$${i + 1}` + span.literal.text;
    });

    return quote(ctx)`{
      text: ${ctx.createStringLiteral(text)},
      params: [${params.map((p) => p).join(", ")}]
    }`;
  },
});
```

## Compile-Time Validation

Validate templates at build time:

```typescript
defineTaggedTemplateMacro("regex", {
  expand(ctx, node) {
    const template = node.template;

    if (!ts.isNoSubstitutionTemplateLiteral(template)) {
      ctx.reportError(node, "regex tag does not support interpolations");
      return node;
    }

    const pattern = template.text;

    // Validate the regex
    try {
      new RegExp(pattern);
    } catch (e) {
      ctx.reportError(node, `Invalid regex: ${e}`);
      return node;
    }

    return quote(ctx)`new RegExp(${ctx.createStringLiteral(pattern)})`;
  },
});
```

## Accessing Tag Arguments

Some tagged templates have type arguments:

```typescript
tag<Type>`template`;
// node.typeArguments contains [Type]
```

```typescript
defineTaggedTemplateMacro("typed", {
  expand(ctx, node) {
    const typeArgs = node.typeArguments;

    if (typeArgs && typeArgs.length > 0) {
      const firstType = typeArgs[0];
      // Use the type...
    }

    return ctx.createStringLiteral("result");
  },
});
```

## Returning Complex Types

Generate typed objects:

```typescript
defineTaggedTemplateMacro("config", {
  expand(ctx, node) {
    const template = node.template;

    if (!ts.isNoSubstitutionTemplateLiteral(template)) {
      return node;
    }

    // Parse YAML-like config at compile time
    const text = template.text;
    const lines = text.trim().split("\n");
    const entries: string[] = [];

    for (const line of lines) {
      const [key, value] = line.split(":").map((s) => s.trim());
      if (key && value) {
        entries.push(`${key}: ${JSON.stringify(value)}`);
      }
    }

    return ctx.parseExpression(`({ ${entries.join(", ")} })`);
  },
});
```

## Handling Raw Strings

Access raw (unescaped) text:

```typescript
defineTaggedTemplateMacro("raw", {
  expand(ctx, node) {
    const template = node.template;

    if (ts.isNoSubstitutionTemplateLiteral(template)) {
      // template.rawText is the unescaped version
      return ctx.createStringLiteral(template.rawText ?? template.text);
    }

    // Handle template expression...
    return node;
  },
});
```

## Error Reporting

Provide helpful compile-time errors:

```typescript
defineTaggedTemplateMacro("json", {
  expand(ctx, node) {
    const template = node.template;

    if (!ts.isNoSubstitutionTemplateLiteral(template)) {
      ctx.reportError(node, "json tag requires a static template");
      return node;
    }

    try {
      const parsed = JSON.parse(template.text);
      return ctx.parseExpression(JSON.stringify(parsed));
    } catch (e) {
      ctx.reportError(node, `Invalid JSON: ${e}`);
      return node;
    }
  },
});
```

## Testing Tagged Templates

```typescript
import { expandCode } from "@typesugar/testing";

describe("sql tag", () => {
  it("extracts parameters", async () => {
    const result = await expandCode(`
      import { sql } from "./sql";
      const id = 42;
      const query = sql\`SELECT * FROM users WHERE id = \${id}\`;
    `);

    expect(result.code).toContain('text: "SELECT * FROM users WHERE id = $1"');
    expect(result.code).toContain("params: [id]");
  });

  it("handles no interpolations", async () => {
    const result = await expandCode(`
      import { sql } from "./sql";
      const query = sql\`SELECT * FROM users\`;
    `);

    expect(result.code).toContain("params: []");
  });
});
```

## Best Practices

1. **Handle both template types**: NoSubstitutionTemplateLiteral and TemplateExpression
2. **Validate early**: Catch errors at compile time
3. **Preserve source info**: Use proper span positions for errors
4. **Type the output**: Generate well-typed code
5. **Document syntax**: Explain what the tag expects

## Next Steps

- [Expression Macros](./expression-macros.md) — Function call macros
- [Testing Macros](./testing-macros.md) — Verifying macro output
