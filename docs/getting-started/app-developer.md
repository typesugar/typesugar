# App Developer Guide

You want to use typesugar features directly in your application or library. This guide walks you through installation, configuration, and your first macros.

## Quick Setup

Run the setup wizard:

```bash
npx typesugar init
```

Select "I want to use typesugar in my app/library" when prompted. This installs everything you need and creates an example file.

## Manual Setup

### Step 1: Install Packages

Install the core transformer and the macro packages you want to use:

```bash
# Core (required)
npm install --save-dev @typesugar/transformer ts-patch

# Popular macro packages (install what you need)
npm install @typesugar/comptime      # Compile-time evaluation
npm install @typesugar/derive        # Auto-derive implementations
npm install @typesugar/reflect       # Type reflection
npm install @typesugar/sql           # Type-safe SQL
```

Or install the umbrella package that includes everything:

```bash
npm install typesugar
npm install --save-dev ts-patch
```

### Step 2: Configure tsconfig.json

Add the transformer plugin:

```json
{
  "compilerOptions": {
    "plugins": [
      { "name": "typesugar/language-service" },
      { "transform": "@typesugar/transformer", "type": "program" }
    ]
  }
}
```

The `language-service` plugin provides IDE support (optional but recommended).

### Step 3: Install ts-patch

```bash
npx ts-patch install
```

Add to your `prepare` script:

```json
{
  "scripts": {
    "prepare": "ts-patch install -s"
  }
}
```

### Step 4: Configure Your Bundler

If you use Vite, Webpack, esbuild, or another bundler:

```bash
npm install --save-dev unplugin-typesugar
```

**Vite:**

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import typesugar from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [typesugar()],
});
```

See [environment-specific guides](./index.md#environment-specific-guides) for other bundlers.

## Your First Macros

### Compile-Time Evaluation

`comptime()` runs code at build time and inlines the result:

```typescript
import { comptime } from "@typesugar/comptime";

// This runs at compile time, not runtime
const BUILD_TIME = comptime(new Date().toISOString());
const COMPUTED = comptime(() => {
  let sum = 0;
  for (let i = 1; i <= 100; i++) sum += i;
  return sum;
});

console.log(`Built at: ${BUILD_TIME}`); // "Built at: 2024-01-15T10:30:00.000Z"
console.log(`Sum: ${COMPUTED}`); // "Sum: 5050"
```

After compilation:

```javascript
const BUILD_TIME = "2024-01-15T10:30:00.000Z";
const COMPUTED = 5050;
```

### Derive Macros

`@derive()` auto-generates common implementations:

```typescript
import { derive, Eq, Clone, Debug, Json } from "@typesugar/derive";

@derive(Eq, Clone, Debug, Json)
class User {
  constructor(
    public id: number,
    public name: string,
    public email: string
  ) {}
}

const user = new User(1, "Alice", "alice@example.com");

// Auto-generated methods:
user.equals(user.clone()); // true
user.debug(); // "User { id: 1, name: \"Alice\", email: \"alice@example.com\" }"
user.toJson(); // "{\"id\":1,\"name\":\"Alice\",\"email\":\"alice@example.com\"}"
User.fromJson("..."); // Parse JSON back to User
```

Available derives: `Eq`, `Ord`, `Clone`, `Debug`, `Hash`, `Default`, `Json`, `Builder`, `TypeGuard`

### Type-Safe SQL

The `sql` tagged template creates parameterized queries:

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

### Type Reflection

Get type information at compile time:

```typescript
import { typeInfo, fieldNames, validator } from "@typesugar/reflect";

interface User {
  id: number;
  name: string;
  email: string;
}

const fields = fieldNames<User>(); // ["id", "name", "email"]
const validate = validator<User>(); // Runtime type guard

if (validate(unknownData)) {
  // unknownData is now typed as User
}
```

## See Macro Expansion

To see what your macros expand to:

```bash
npx typesugar expand src/main.ts
```

Or with a diff:

```bash
npx typesugar expand src/main.ts --diff
```

## Verify Setup

Run diagnostics:

```bash
npx typesugar doctor
```

## Package Reference

| Package                | Features                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `@typesugar/comptime`  | `comptime()`                                                                                  |
| `@typesugar/derive`    | `@derive()`, `Eq`, `Ord`, `Clone`, `Debug`, `Hash`, `Default`, `Json`, `Builder`, `TypeGuard` |
| `@typesugar/reflect`   | `typeInfo<T>()`, `fieldNames<T>()`, `validator<T>()`, `@reflect`                              |
| `@typesugar/sql`       | `sql` tagged template                                                                         |
| `@typesugar/operators` | `@operators()`, `ops()`, `pipe()`                                                             |
| `@typesugar/typeclass` | `@typeclass`, `@instance`, `@deriving`, `summon<T>()`                                         |
| `@typesugar/contracts` | `requires:`, `ensures:`, `invariant:`                                                         |
| `@typesugar/std`       | `match()`, `when()`, `otherwise()`, `isType()`, `P`, extension methods                        |
| `@typesugar/fp`        | `Option`, `Result`, `IO`                                                                      |
| `@typesugar/strings`   | `regex`, `html`, `json` tagged templates                                                      |
| `@typesugar/units`     | `units` tagged template for dimensional analysis                                              |

## What's Next?

- [Compile-Time Evaluation Guide](../guides/comptime.md)
- [Derive Macros Guide](../guides/derive.md)
- [Typeclasses Guide](../guides/typeclasses.md)
- [Editor Setup](./editor-setup.md)
- [Troubleshooting](./troubleshooting.md)
