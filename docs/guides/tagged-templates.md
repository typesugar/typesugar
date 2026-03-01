# Tagged Templates

typesugar provides type-safe tagged templates for SQL, regex, HTML, and more.

## SQL

### Basic Usage

```typescript
import { sql } from "@typesugar/sql";

const userId = 42;
const status = "active";

const query = sql`
  SELECT * FROM users 
  WHERE id = ${userId} AND status = ${status}
`;

console.log(query.text); // "SELECT * FROM users WHERE id = $1 AND status = $2"
console.log(query.params); // [42, "active"]
```

### Parameterized Queries

Interpolations become parameters, preventing SQL injection:

```typescript
const userInput = "'; DROP TABLE users; --";
const query = sql`SELECT * FROM users WHERE name = ${userInput}`;
// Safe: userInput is a parameter, not interpolated into the query string
```

### Raw SQL

For table names or other non-parameterizable parts:

```typescript
import { sql, raw } from "@typesugar/sql";

const tableName = "users";
const query = sql`SELECT * FROM ${raw(tableName)} WHERE id = ${userId}`;
// "SELECT * FROM users WHERE id = $1"
```

### Composing Queries

```typescript
const whereClause = sql`WHERE status = ${status}`;
const query = sql`SELECT * FROM users ${whereClause}`;
```

## Regex

### Basic Usage

```typescript
import { regex } from "@typesugar/strings";

// Validated at compile time
const emailPattern = regex`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`;

"test@example.com".match(emailPattern); // matches
```

### Compile-Time Validation

Invalid regex patterns cause build errors:

```typescript
// Build error: Invalid regular expression
const bad = regex`[a-z`;
```

### Flags

```typescript
const pattern = regex`hello`i;  // case-insensitive
const global = regex`\d+`g;     // global
```

### Interpolation

```typescript
const domain = "example\\.com"; // Escaped for regex
const pattern = regex`^.+@${domain}$`;
```

## HTML

### Type-Safe HTML

```typescript
import { html } from "@typesugar/strings";

const userInput = "<script>alert('xss')</script>";
const markup = html`<div class="user-content">${userInput}</div>`;
// Escapes: <div class="user-content">&lt;script&gt;alert('xss')&lt;/script&gt;</div>
```

### Raw HTML

```typescript
import { html, raw } from "@typesugar/strings";

const trustedHtml = "<strong>Bold</strong>";
const markup = html`<div>${raw(trustedHtml)}</div>`;
// No escaping: <div><strong>Bold</strong></div>
```

## Units

### Dimensional Analysis

```typescript
import { units } from "@typesugar/units";

const speed = units`100 km/h`;
const time = units`2 h`;
const distance = units`${speed} * ${time}`; // 200 km

// Type error: incompatible units
const wrong = units`${speed} + ${distance}`;
```

### Conversions

```typescript
const meters = units`1000 m`;
const kilometers = meters.to("km"); // 1 km
```

### Supported Units

- Length: m, km, mi, ft, in
- Time: s, min, h, d
- Mass: kg, g, lb
- Temperature: C, F, K
- And more...

## Creating Custom Tagged Templates

```typescript
import { defineTaggedTemplateMacro } from "@typesugar/core";

defineTaggedTemplateMacro("myTag", {
  expand(ctx, node) {
    const template = node.template;
    // Process the template...
    return ctx.createStringLiteral("processed");
  },
});
```

See [Writing Macros: Tagged Templates](../writing-macros/tagged-template-macros.md) for details.

## How It Works

Tagged template macros process the template at compile time:

1. **Analyze** the template strings and expressions
2. **Validate** (for regex, JSON, etc.)
3. **Transform** into optimized runtime code

```typescript
// Source
const query = sql`SELECT * FROM users WHERE id = ${userId}`;

// Compiled
const query = { text: "SELECT * FROM users WHERE id = $1", params: [userId] };
```

## Type Safety

Tagged templates provide full type inference:

```typescript
// sql returns SqlQuery<[number, string]>
const query = sql`SELECT * FROM users WHERE id = ${42} AND name = ${"Alice"}`;
```

## Best Practices

### Do

- Use `sql` for all database queries
- Use `regex` for patterns (compile-time validation)
- Use `html` for user-generated content

### Don't

- Use string concatenation for SQL
- Trust user input in `raw()`
- Ignore type errors from tagged templates
