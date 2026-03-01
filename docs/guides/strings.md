# String Macros

Compile-time validated string templates: regex validation, HTML XSS escaping, and raw strings.

## Quick Start

```bash
npm install @typesugar/strings
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
const pattern = regex`^[a-z]+$`;
// Compiles to: new RegExp("^[a-z]+$")

// Invalid regex causes compile-time error
const bad = regex`[invalid`;
// Error: Invalid regular expression: Unterminated character class
```

### html — XSS-Safe HTML Templates

```typescript
const userInput = "<script>alert('xss')</script>";
const safe = html`<div>${userInput}</div>`;
// Result: "<div>&lt;script&gt;alert('xss')&lt;/script&gt;</div>"
```

### raw — Raw Strings (No Escape Processing)

```typescript
const path = raw`C:\Users\name\Documents`;
// Result: "C:\\Users\\name\\Documents"
```

## Learn More

- [API Reference](/reference/packages#strings)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/strings)
