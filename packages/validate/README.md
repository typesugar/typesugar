# @typesugar/validate

> 📖 **Full documentation:** [Validation guide](https://typesugar.org/guides/validate). The microsite is the canonical reference; this README is a quickstart.

Zero-cost validation macros and a library-agnostic `Schema` typeclass: compile-time type guards, assertions, and validation with rich error accumulation.

## Installation

```bash
npm install @typesugar/validate
```

## Quick Start

```typescript
import { is } from "@typesugar/validate";

interface User {
  name: string;
  age: number;
  email?: string;
}

const isUser = is<User>();

if (isUser(data)) {
  console.log(data.name); // data is typed as User
}
```

## Documentation

- [Validation guide](https://typesugar.org/guides/validate) — full reference
- [Specialization guide](https://typesugar.org/guides/specialize) — make `Schema<F>` zero-cost
