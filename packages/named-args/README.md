# @typesugar/named-args

Named and reorderable function arguments for TypeScript, inspired by Kotlin, Swift, and Boost.Parameter.

## The Problem

Positional arguments get unreadable fast:

```typescript
createUser("Alice", 30, true, "admin", null, "UTC", false);
//         ^^^^^  ^^  ^^^^  ^^^^^^^  ^^^^  ^^^^^  ^^^^^
//         what do any of these mean?
```

## The Solution

Wrap your function with `namedArgs()` and call it with an object — parameters are reordered to match the original positional signature automatically:

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

## Default Values

Mark parameters as optional and provide defaults:

```typescript
const params: ParamMeta[] = [
  { name: "name", type: "string", required: true, position: 0 },
  { name: "greeting", type: "string", required: false, defaultValue: "Hello", position: 1 },
];

const greet = namedArgs(greetFn, params);
greet.namedCall({ name: "World" }); // "Hello, World!"
greet.namedCall({ name: "World", greeting: "Hi" }); // "Hi, World!"
```

## Builder Pattern

For functions with many parameters, the builder pattern reads better:

```typescript
import { createBuilder } from "@typesugar/named-args";

const user = createBuilder(createUser, params)
  .set("email", "alice@example.com")
  .set("name", "Alice")
  .set("age", 30)
  .build();
```

Builders are immutable — each `.set()` returns a new builder. You can branch from a partial builder:

```typescript
const base = createBuilder(createUser, params).set("name", "Alice").set("age", 30);

const work = base.set("email", "alice@work.com").build();
const personal = base.set("email", "alice@home.com").build();
```

## Error Handling

`NamedArgsError` is thrown for:

- **Missing required params** — `reason: "missing_required"`
- **Unknown params** — `reason: "unknown_param"`

```typescript
import { NamedArgsError } from "@typesugar/named-args";

try {
  wrapped.namedCall({ name: "Alice" }); // missing "age"
} catch (err) {
  if (err instanceof NamedArgsError) {
    console.log(err.reason); // "missing_required"
    console.log(err.paramName); // "age"
    console.log(err.functionName); // "createUser"
  }
}
```

## Phase 2: Compile-Time Rewriting

Phase 1 (current) resolves named args at runtime via a thin wrapper.

Phase 2 will use the `@namedArgs` macro to rewrite call sites at compile time, turning:

```typescript
create.namedCall({ active: true, name: "Alice", age: 30 });
```

into:

```typescript
createUser("Alice", 30, true);
```

Zero overhead — the object literal never exists at runtime.
