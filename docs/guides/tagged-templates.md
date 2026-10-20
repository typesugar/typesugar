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

console.log(query.text); // "\n  SELECT * FROM users\n  WHERE id = $1 AND status = $2\n"
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

For table names or other non-parameterizable parts, interpolate a `Fragment`:
`Fragment.ident` quotes an identifier, and `Fragment.raw` splices text in
unchanged (never pass it user input).

```typescript
import { sql, Fragment } from "@typesugar/sql";

const tableName = "users";
const query = sql`SELECT * FROM ${Fragment.ident(tableName)} WHERE id = ${userId}`;
// 'SELECT * FROM "users" WHERE id = $1'

const unquoted = sql`SELECT * FROM ${Fragment.raw(tableName)} WHERE id = ${userId}`;
// "SELECT * FROM users WHERE id = $1"
```

### Composing Queries

```typescript
const whereClause = sql`WHERE status = ${status}`;
const query = sql`SELECT * FROM users ${whereClause}`;
// "SELECT * FROM users WHERE status = $1"
```

See the [SQL guide](./sql.md) for typed queries and `ConnectionIO`.

## Regex

> From `@typesugar/strings`, which is frozen ([PEP-048](https://github.com/typesugar/typesugar/blob/main/peps/PEP-048-package-triage.md)): still published, not under active development.

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
// Build error: Invalid regular expression ... Unterminated character class
const bad = regex`[a-z`;
```

`regex` takes no flags and no interpolations (`${...}` in the template is a
compile error: "regex does not support interpolations"). For flags or a
dynamic pattern, use `new RegExp(pattern, flags)` directly.

## HTML

> From `@typesugar/strings`, which is frozen ([PEP-048](https://github.com/typesugar/typesugar/blob/main/peps/PEP-048-package-triage.md)): still published, not under active development.

### Type-Safe HTML

```typescript
import { html } from "@typesugar/strings";

const userInput = "<script>alert('xss')</script>";
const markup = html`<div class="user-content">${userInput}</div>`;
// Escapes: <div class="user-content">&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;</div>
```

Every interpolation is escaped; there is no "trusted HTML" opt-out inside
`html`. (`@typesugar/strings`' `raw` is a separate tagged template for raw
string literals, not an HTML marker.) To include markup you trust, concatenate
it outside the template.

## Units

> From `@typesugar/units`, which is frozen ([PEP-048](https://github.com/typesugar/typesugar/blob/main/peps/PEP-048-package-triage.md)): still published, not under active development.

### Unit Literals

```typescript
import { units, kilometers } from "@typesugar/units";

const speed = units`100 km/h`; // expands to kilometersPerHour(100)
const time = units`2 h`; // expands to hours(2)
const distance = speed.mul(time); // arithmetic uses methods, not operators

const m = units`1000 m`;
m.to(kilometers).toString(); // "1 km"
```

`units` literals take a single number and unit; substitutions (`${...}`) are a
compile error ("units template literals with substitutions are not yet
supported"). `.to()` takes a unit constructor such as `kilometers`, not a
string. A literal is typed `Unit<any>` in your source, so dimension checking
needs the typed constructors; see the [Units guide](./units.md).

## Creating Custom Tagged Templates

```typescript
import { defineTaggedTemplateMacro, globalRegistry } from "@typesugar/core";

export const myTagMacro = defineTaggedTemplateMacro({
  name: "myTag",
  module: "my-package", // the macro only fires on a `myTag` imported from here
  expand(ctx, node) {
    const template = node.template;
    // Process the template...
    return ctx.createStringLiteral("processed");
  },
});

// defineTaggedTemplateMacro only builds the definition; register it to use it
globalRegistry.register(myTagMacro);
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

// Compiled (the template is split at compile time; __sql_build makes the Fragment)
const query = __sql_build(["SELECT * FROM users WHERE id = ", ""], [userId]);
```

## Type Safety

`sql` returns an untyped `Fragment`. For parameter and result types, use
`sql$`:

```typescript
import { sql$ } from "@typesugar/sql";

// TypedFragment<[number, string], SqlRow>
const query = sql$`SELECT * FROM users WHERE id = ${42} AND name = ${"Alice"}`;
```

## Best Practices

### Do

- Use `sql` for all database queries
- Use `regex` for patterns (compile-time validation)
- Use `html` for user-generated content

### Don't

- Use string concatenation for SQL
- Pass user input to `Fragment.raw()`
- Ignore type errors from tagged templates
