# @typesugar/reflect

> 📖 **Full documentation:** [Reflection guide](https://typesugar.org/guides/reflect). The microsite is the canonical reference; this README is a quickstart.

Compile-time type reflection macros — introspect types, extract metadata, and generate validators with zero runtime overhead.

## Installation

```bash
npm install @typesugar/reflect
```

## Quick Start

```typescript
import { typeInfo, fieldNames, validator } from "@typesugar/reflect";

interface User {
  id: number;
  name: string;
  email?: string;
}

const fields = fieldNames<User>();
// Compiles to: ["id", "name", "email"]

const validateUser = validator<User>();
// Generates a runtime validator from the type
```

## Documentation

- [Reflection guide](https://typesugar.org/guides/reflect) — full reference
- [Validation guide](https://typesugar.org/guides/validate) — richer runtime validation
