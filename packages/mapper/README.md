# @typesugar/mapper

> 📖 **Full documentation:** [Object Mapping guide](https://typesugar.org/guides/mapper). The microsite is the canonical reference; this README is a quickstart.

Zero-cost compile-time object mapping and transformation between DTOs, entities, and domain models — inspired by Scala's Chimney and .NET's AutoMapper, with zero runtime overhead.

## Installation

```bash
npm install @typesugar/mapper
```

Requires the typesugar transformer to be configured in your build tool.

## Quick Start

```typescript
import { transformInto } from "@typesugar/mapper";

const user = { first_name: "John", last_name: "Doe", age: 30 };

const dto = transformInto<User, UserDTO>(user, {
  rename: { firstName: "first_name", lastName: "last_name" },
  const: { role: "user" },
});
// dto is { firstName: "John", lastName: "Doe", age: 30, role: "user" }
```

## Documentation

- [Object Mapping guide](https://typesugar.org/guides/mapper) — full reference
- [Validation guide](https://typesugar.org/guides/validate) — planned integration target
