# Opt-Out Directives

Sometimes you need to disable typesugar transformations temporarily — for debugging, performance testing, or interoperability with other tools. typesugar provides multiple granularity levels for opting out.

## Quick Reference

| Scope    | Syntax                                  | Effect                                     |
| -------- | --------------------------------------- | ------------------------------------------ |
| File     | `"use no typesugar"`                    | Skips all transformations for the file     |
| Function | `"use no typesugar"` (in function body) | Skips transformations inside that function |
| Line     | `// @ts-no-typesugar`                   | Skips transformation of that line          |
| Feature  | `"use no typesugar {feature}"`          | Skips only specific features               |

## File-Level Opt-Out

Place at the top of your file (after imports):

```typescript
import { Option, match } from "@typesugar/fp";

("use no typesugar");

// Everything below is untransformed
function process(opt: Option<number>) {
  // This won't expand the match macro
  return match(opt, {
    Some: (n) => n * 2,
    None: () => 0,
  });
}
```

## Function-Level Opt-Out

Place as the first statement in a function body:

```typescript
import { comptime, match } from "typesugar";

function normalFunction() {
  // This WILL be transformed
  const x = comptime(() => 1 + 2);
  return x;
}

function debugFunction() {
  "use no typesugar";

  // This WON'T be transformed
  const y = comptime(() => 3 + 4); // Left as-is for debugging
  return y;
}
```

## Line-Level Opt-Out

Use inline comments to skip specific lines:

```typescript
import { specialize } from "typesugar";

const fast = specialize(add); // Transformed: inlined

const slow = specialize(add); // @ts-no-typesugar — Left as-is
```

You can also use `@ts-no-typesugar-all` to skip all typesugar transformations on that line:

```typescript
// @ts-no-typesugar-all
const x = extend(myValue, Show).show(); // No transformation at all
```

## Feature-Specific Opt-Out

Disable only certain categories of transformation:

```typescript
"use no typesugar extensions";

// Extension methods won't be rewritten
(42).clamp(0, 100); // Will error at runtime — clamp is not a native method

// But macros still work
const x = comptime(() => 1 + 1); // → 2
```

Available features:

| Feature       | What it disables                                                 |
| ------------- | ---------------------------------------------------------------- |
| `macros`      | Expression macros, tagged templates, type macros, labeled blocks |
| `derive`      | `@derive()` decorator expansion                                  |
| `extensions`  | Standalone extension method rewriting                            |
| `typeclasses` | `@typeclass`, `@instance`, `summon()`                            |
| `operators`   | Operator overloading (when implemented)                          |

You can combine multiple features:

```typescript
"use no typesugar extensions";
"use no typesugar derive";

// Both extensions and derive are disabled
```

Or use line-level feature opt-out:

```typescript
x.clamp(0, 100); // @ts-no-typesugar extensions
```

## Use Cases

### Debugging Macro Expansion

When something isn't working as expected:

```typescript
function buggyCode() {
  "use no typesugar";

  // See exactly what TypeScript sees without transformations
  const result = match(option, {
    Some: (x) => x,
    None: () => defaultValue,
  });

  // Check if the bug is in the macro or your logic
  console.log(result);
}
```

### Performance Benchmarking

Compare transformed vs. non-transformed performance:

```typescript
function baseline() {
  "use no typesugar";

  // Manual implementation for benchmark baseline
  const arr = [];
  for (let i = 0; i < 1000; i++) {
    arr.push(i);
  }
  return arr;
}

function optimized() {
  // typesugar-transformed version
  return comptime(() => {
    const arr = [];
    for (let i = 0; i < 1000; i++) {
      arr.push(i);
    }
    return arr;
  });
}
```

### Interoperability

When mixing with other transform tools:

```typescript
// React Compiler handles this file
"use no typesugar";

import { useState } from "react";

function Counter() {
  const [count, setCount] = useState(0);
  // Let React Compiler optimize this without typesugar interference
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
```

### Gradual Adoption

Enable typesugar for specific files while keeping others untransformed:

```typescript
// legacy-code.ts
"use no typesugar";

// Keep existing code unchanged during migration
export function legacyFunction() {
  // ...
}
```

## Configuration-Level Opt-Out

You can also configure opt-out patterns in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@typesugar/transformer",
        "resolution": {
          "mode": "automatic",
          "fileOverrides": {
            "**/*.legacy.ts": "explicit",
            "**/vendor/**": "explicit"
          }
        }
      }
    ]
  }
}
```

See the [Resolution Modes](./resolution-modes.md) guide for more configuration options.

## Notes

- Opt-out is detected at transform time, not compile time — the directive string itself is removed from output
- Opt-out applies to the current scope and all nested scopes
- When debugging, remember that opted-out code may have type errors if it depends on macro-generated types
