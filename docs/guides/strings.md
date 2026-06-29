# String Macros

Compile-time validated string templates: regex validation, HTML XSS escaping, string formatting, and raw strings.

> 🧊 **Frozen ([PEP-048](https://github.com/typesugar/typesugar/blob/main/peps/PEP-048-package-triage.md)).** Not under active development and excluded from release. It still lives in the repo and builds, but is not part of typesugar's actively-maintained surface.

`@typesugar/strings` provides tagged template macros for string processing with compile-time validation: regex validation, HTML XSS escaping, string formatting, and raw strings.

## Quick Start

```bash
npm install @typesugar/strings
# or
pnpm add @typesugar/strings
```

```typescript
import { regex, html, raw } from "@typesugar/strings";

// Validated at compile time
const email = regex`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`;

// Auto-escapes interpolations
const safe = html`<div>${userInput}</div>`;
```

## Available Macros

### regex — Compile-Time Validated Regular Expressions

```typescript
import { regex } from "@typesugar/strings";

const pattern = regex`^[a-z]+$`;
// Compiles to: new RegExp("^[a-z]+$")

// Validated at compile time
const email = regex`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`;
// Compiles to: new RegExp("^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$")

// Invalid regex causes compile-time error
const bad = regex`[invalid`;
// Error: Invalid regular expression: Unterminated character class
```

### html — XSS-Safe HTML Templates

```typescript
import { html } from "@typesugar/strings";

const userInput = "<script>alert('xss')</script>";

// Interpolations are automatically escaped
const safe = html`<div>${userInput}</div>`;
// Result: "<div>&lt;script&gt;alert('xss')&lt;/script&gt;</div>"
```

### fmt — String Formatting

Currently converts interpolations to strings. Printf-style format specifiers (%d, %s, %f) are planned for Phase 2.

```typescript
import { fmt } from "@typesugar/strings";

const name = "Alice";
const age = 30;

const message = fmt`Hello, ${name}! You are ${age} years old.`;
// Result: "Hello, Alice! You are 30 years old."
```

### raw — Raw Strings (No Escape Processing)

```typescript
import { raw } from "@typesugar/strings";

// Escape sequences preserved
const path = raw`C:\Users\name\Documents`;
// Result: "C:\\Users\\name\\Documents"

const pattern = raw`\d+\.\d+`;
// Result: "\\d+\\.\\d+"
```

## API Reference

### Tagged Template Macros

- `regex` — Compile-time validated regular expressions
- `html` — HTML with automatic XSS escaping
- `fmt` — String formatting (printf-style specifiers planned for Phase 2)
- `raw` — Raw strings without escape processing

### Functions

- `register()` — Register macros (called automatically on import)

### Runtime Helper

```typescript
// Used internally by html macro
function __typesugar_escapeHtml(str: unknown): string;
```

## Compile-Time Benefits

| Macro   | Compile-Time Feature                          |
| ------- | --------------------------------------------- |
| `regex` | Syntax validation, catches invalid patterns   |
| `html`  | Auto-injection of escape calls                |
| `fmt`   | String coercion; format specifiers in Phase 2 |
| `raw`   | Escape sequence preservation                  |

## Learn More

- [API Reference](/reference/packages#strings)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/strings)
