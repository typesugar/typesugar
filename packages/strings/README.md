# @typesugar/strings

> Compile-time validated string macros.

## Overview

`@typesugar/strings` provides tagged template macros for string processing with compile-time validation: regex validation, HTML XSS escaping, printf-style formatting, and raw strings.

## Installation

```bash
npm install @typesugar/strings
# or
pnpm add @typesugar/strings
```

## Usage

### regex — Compile-Time Validated Regular Expressions

```typescript
import { regex } from "@typesugar/strings";

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

### fmt — Printf-Style Formatting

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

const regex = raw`\d+\.\d+`;
// Result: "\\d+\\.\\d+"
```

## API Reference

### Tagged Template Macros

- `regex` — Compile-time validated regular expressions
- `html` — HTML with automatic XSS escaping
- `fmt` — Printf-style string formatting
- `raw` — Raw strings without escape processing

### Functions

- `register()` — Register macros (called automatically on import)

### Runtime Helper

```typescript
// Used internally by html macro
function __typesugar_escapeHtml(str: unknown): string;
```

## Compile-Time Benefits

| Macro   | Compile-Time Feature                        |
| ------- | ------------------------------------------- |
| `regex` | Syntax validation, catches invalid patterns |
| `html`  | Auto-injection of escape calls              |
| `fmt`   | Could be extended for type checking         |
| `raw`   | Escape sequence preservation                |

## License

MIT
