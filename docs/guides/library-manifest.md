# Library Manifest (`typesugar.manifest.json`)

Third-party libraries can declare typeclass instances, typeclasses, and extension methods
using a manifest file. This enables typesugar to discover and use these declarations
without requiring code transformation in the library itself.

## Schema

```json
{
  "$schema": "https://typesugar.dev/schemas/manifest.v1.json",
  "version": 1,
  "name": "@my-org/my-library",

  "typeclasses": [
    {
      "name": "Codec",
      "module": "@my-org/my-library/typeclasses",
      "methods": ["encode", "decode"],
      "typeParams": ["A"]
    }
  ],

  "instances": [
    {
      "typeclass": "Show",
      "forType": "MyType",
      "module": "@my-org/my-library/instances",
      "export": "showMyType"
    },
    {
      "typeclass": "Codec",
      "forType": "User",
      "module": "@my-org/my-library/instances",
      "export": "userCodec"
    }
  ],

  "extensions": [
    {
      "forType": "MyType",
      "method": "process",
      "module": "@my-org/my-library/extensions",
      "export": "processMyType"
    },
    {
      "forType": "Array",
      "method": "chunked",
      "module": "@my-org/my-library/extensions",
      "export": "chunkedArray"
    }
  ],

  "operators": [
    {
      "symbol": "<+>",
      "forType": "MyMonoid",
      "method": "concat",
      "module": "@my-org/my-library/operators"
    }
  ],

  "derives": [
    {
      "name": "Codec",
      "module": "@my-org/my-library/derives"
    }
  ]
}
```

## Field Reference

### Top-level fields

| Field         | Type   | Description                             |
| ------------- | ------ | --------------------------------------- |
| `$schema`     | string | Schema URL for validation               |
| `version`     | number | Manifest schema version (currently `1`) |
| `name`        | string | Package name (for diagnostics)          |
| `typeclasses` | array  | Typeclass declarations                  |
| `instances`   | array  | Instance registrations                  |
| `extensions`  | array  | Extension method registrations          |
| `operators`   | array  | Custom operator registrations           |
| `derives`     | array  | Derive macro registrations              |

### Typeclass declaration

```typescript
interface TypeclassDeclaration {
  name: string; // Typeclass name (e.g., "Codec")
  module: string; // Module that exports the typeclass
  methods: string[]; // Method names on the typeclass
  typeParams?: string[]; // Type parameters (default: ["A"])
  description?: string; // For documentation
}
```

### Instance registration

```typescript
interface InstanceRegistration {
  typeclass: string; // Typeclass name
  forType: string; // Type this instance is for
  module: string; // Module that exports the instance
  export: string; // Export name of the instance
  typeArgs?: string[]; // Type arguments if generic
  priority?: number; // Override default priority (lower = higher)
}
```

### Extension registration

```typescript
interface ExtensionRegistration {
  forType: string; // Type to extend
  method: string; // Method name
  module: string; // Module that exports the function
  export?: string; // Export name (defaults to method name)
  signature?: string; // For documentation
}
```

### Operator registration

```typescript
interface OperatorRegistration {
  symbol: string; // Operator symbol (e.g., "<+>")
  forType: string; // Type the operator applies to
  method: string; // Method name to call
  module: string; // Module containing the method
  precedence?: number; // Operator precedence
  associativity?: "left" | "right";
}
```

### Derive registration

```typescript
interface DeriveRegistration {
  name: string; // Derive macro name
  module: string; // Module that exports the derive macro
  requires?: string[]; // Required typeclasses (for error messages)
  supports?: string[]; // Supported type kinds: "product", "sum", "enum"
}
```

## Discovery

typesugar discovers manifests in these locations:

1. **`typesugar.manifest.json`** in the package root
2. **`package.json#typesugar`** field
3. **`node_modules/*/typesugar.manifest.json`** (recursive)

Example using `package.json`:

```json
{
  "name": "@my-org/my-library",
  "typesugar": {
    "instances": [
      {
        "typeclass": "Show",
        "forType": "MyType",
        "module": "./dist/instances.js",
        "export": "showMyType"
      }
    ]
  }
}
```

## Priority and Conflicts

Library instances have lower priority than local instances:

| Source            | Priority    |
| ----------------- | ----------- |
| Local `@instance` | 1 (highest) |
| Local `@derive`   | 2           |
| Imported explicit | 3           |
| Library manifest  | 4           |
| Auto-derived      | 5           |
| Prelude           | 6 (lowest)  |

When two libraries provide conflicting instances, typesugar reports an error
with both sources labeled.

## Configuration

Override manifest behavior in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@typesugar/transformer",
        "manifest": {
          "scanNodeModules": true,
          "exclude": ["deprecated-lib"],
          "priorityOverrides": {
            "@my-org/my-library.Show<MyType>": 2
          }
        }
      }
    ]
  }
}
```

## CLI Tools

```bash
# Validate a manifest
typesugar manifest validate ./typesugar.manifest.json

# List all discovered registrations
typesugar manifest list

# Check for conflicts
typesugar manifest check
```

## Best Practices

1. **Be specific**: Only register instances for types you own
2. **Document**: Include descriptions for custom typeclasses
3. **Test**: Verify manifests are loaded correctly
4. **Version**: Bump the package version when changing registrations
5. **Avoid conflicts**: Don't register instances for common types unless you're the primary provider

## Example: Date Library

```json
{
  "$schema": "https://typesugar.dev/schemas/manifest.v1.json",
  "version": 1,
  "name": "@typesugar/dates",

  "typeclasses": [
    {
      "name": "Temporal",
      "module": "@typesugar/dates/typeclasses",
      "methods": ["add", "subtract", "isBefore", "isAfter"],
      "typeParams": ["T"]
    }
  ],

  "instances": [
    {
      "typeclass": "Show",
      "forType": "Date",
      "module": "@typesugar/dates/instances",
      "export": "dateShow"
    },
    {
      "typeclass": "Eq",
      "forType": "Date",
      "module": "@typesugar/dates/instances",
      "export": "dateEq"
    },
    {
      "typeclass": "Ord",
      "forType": "Date",
      "module": "@typesugar/dates/instances",
      "export": "dateOrd"
    },
    {
      "typeclass": "Temporal",
      "forType": "Date",
      "module": "@typesugar/dates/instances",
      "export": "dateTemporal"
    }
  ],

  "extensions": [
    {
      "forType": "Date",
      "method": "format",
      "module": "@typesugar/dates/extensions",
      "export": "formatDate",
      "signature": "(pattern: string) => string"
    }
  ]
}
```
