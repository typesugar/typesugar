# @typesugar/strings

> 📖 **Full documentation:** [String Macros guide](https://typesugar.org/guides/strings). The microsite is the canonical reference; this README is a quickstart.

> 🧊 **Frozen ([PEP-048](../../peps/PEP-048-package-triage.md)).** Not under active development and excluded from release. It still lives in the repo and builds, but is not part of typesugar's actively-maintained surface.

Compile-time validated string macros: regex validation, HTML XSS escaping, formatting, and raw strings.

## Installation

```bash
npm install @typesugar/strings
```

## Quick Start

```typescript
import { regex, html } from "@typesugar/strings";

// Validated at compile time
const email = regex`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`;

// Interpolations are automatically XSS-escaped
const userInput = "<script>alert('xss')</script>";
const safe = html`<div>${userInput}</div>`;
// Result: "<div>&lt;script&gt;alert('xss')&lt;/script&gt;</div>"
```

## Documentation

- [String Macros guide](https://typesugar.org/guides/strings) — full reference
