# Named Arguments

Named and reorderable function arguments for TypeScript — call functions with labeled parameters in any order.

## The Problem

Positional arguments get unreadable fast:

```typescript
createUser("Alice", 30, true, "admin", null, "UTC", false);
//         ^^^^^  ^^  ^^^^  ^^^^^^^  ^^^^  ^^^^^  ^^^^^
//         what do any of these mean?
```

## Quick Start

```bash
npm install @typesugar/named-args
```

```typescript
import { namedArgs, type ParamMeta } from "@typesugar/named-args";

function createUser(name: string, age: number, active: boolean) {
  return { name, age, active };
}

const params: ParamMeta[] = [
  { name: "name", type: "string", required: true, position: 0 },
  { name: "age", type: "number", required: true, position: 1 },
  { name: "active", type: "boolean", required: true, position: 2 },
];

const create = namedArgs(createUser, params);

// Named call — order doesn't matter
create.namedCall({ active: true, name: "Alice", age: 30 });

// Positional still works
create("Alice", 30, true);
```

`namedArgs()` wraps the original function and adds a `.namedCall()` method. Under the hood, it reorders your named arguments to match the original positional signature.

## Default Values

Mark parameters as optional and provide defaults:

```typescript
function greet(name: string, greeting: string) {
  return `${greeting}, ${name}!`;
}

const params: ParamMeta[] = [
  { name: "name", type: "string", required: true, position: 0 },
  { name: "greeting", type: "string", required: false, defaultValue: "Hello", position: 1 },
];

const greetNamed = namedArgs(greet, params);

greetNamed.namedCall({ name: "World" });
// "Hello, World!"

greetNamed.namedCall({ name: "World", greeting: "Hey" });
// "Hey, World!"
```

Optional parameters with defaults can be omitted entirely.

## Required vs Optional

| `required` | `defaultValue` | Behavior                                              |
| ---------- | -------------- | ----------------------------------------------------- |
| `true`     | (none)         | Must be provided. Throws `NamedArgsError` if missing. |
| `false`    | value          | Uses default when omitted.                            |
| `false`    | (none)         | Passes `undefined` when omitted.                      |

## Error Handling

`NamedArgsError` gives you structured error information:

```typescript
import { NamedArgsError } from "@typesugar/named-args";

try {
  create.namedCall({ name: "Alice" }); // missing "age"
} catch (err) {
  if (err instanceof NamedArgsError) {
    err.reason; // "missing_required"
    err.paramName; // "age"
    err.functionName; // "createUser"
  }
}
```

Two error reasons:

- `"missing_required"` — a required parameter wasn't provided
- `"unknown_param"` — the caller passed a parameter name that doesn't exist in the metadata

## Builder Pattern

For functions with many parameters, the builder reads better than a large object literal:

```typescript
import { createBuilder } from "@typesugar/named-args";

const user = createBuilder(createUser, params)
  .set("name", "Alice")
  .set("age", 30)
  .set("active", true)
  .build();
```

Builders are immutable — each `.set()` returns a new builder. You can branch from a partial builder:

```typescript
const base = createBuilder(createUser, params).set("name", "Alice").set("age", 30);

const admin = base.set("active", true).build();
const inactive = base.set("active", false).build();
```

This is useful for test fixtures or configuration objects where most fields are shared.

## Future: Compile-Time Rewriting

Phase 1 (current) resolves named args at runtime via a thin wrapper.

Phase 2 will use the `@namedArgs` macro to rewrite call sites at compile time:

```typescript
// You write:
create.namedCall({ active: true, name: "Alice", age: 30 });

// Compiler emits:
createUser("Alice", 30, true);
```

Zero overhead — the object literal never exists at runtime.

## What's Next

- [API Reference](/reference/packages#named-args)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/named-args)
