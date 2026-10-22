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

Make it the first statement of the file, before the imports, written as a plain
string statement (`"use no typesugar";`, not `("use no typesugar");`):

```typescript
"use no typesugar";

import { comptime } from "typesugar";

// Everything in this file is untransformed
export const y = comptime(() => 3 + 4); // left as a runtime call (which throws)
```

A parenthesised `("use no typesugar");` is an ordinary expression, not a directive, and
is ignored. Prettier adds those parentheses to a string statement that comes after an
import, which is another reason to keep the directive at the very top.

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
const fast = add(numericPoint, p1, p2); // Auto-specialized: inlined

const slow = add(numericPoint, p1, p2); // @ts-no-typesugar — Left as-is
```

You can also use `@ts-no-typesugar-all` to skip all typesugar transformations on that line.
Like every line marker, it applies only to the line it is written on, not to the next line:

```typescript
const x = (42).clamp(0, 100); // @ts-no-typesugar-all — no transformation at all
```

## Feature-Specific Opt-Out

Disable only certain categories of transformation:

```typescript
"use no typesugar extensions";

import { comptime } from "typesugar";
import { clamp } from "@typesugar/std";

// Extension methods won't be rewritten
(42).clamp(0, 100); // Will error at runtime — clamp is not a native method

// But macros still work
const x = comptime(() => 1 + 1); // → 2
```

Available features:

| Feature       | What it disables                                                                       |
| ------------- | -------------------------------------------------------------------------------------- |
| `macros`      | Expression macros, tagged templates, type macros, labeled blocks                       |
| `derive`      | `@derive()` decorator expansion                                                        |
| `extensions`  | Standalone extension method rewriting, typeclass instance-method sugar (`a.equals(b)`) |
| `typeclasses` | `@typeclass`, `@impl`, `summon()`                                                      |
| `operators`   | Operator overloading                                                                   |

You can combine multiple features:

```typescript
"use no typesugar extensions";
"use no typesugar derive";

// Both extensions and derive are disabled (keep these before the imports)
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

## Notes

- Opt-out is detected at transform time; the directive string stays in the output, where it is a harmless no-op
- There is no configuration-file opt-out: use the directives above, or leave the files out of the bundler plugin's `include` / add them to `exclude`
- Opt-out applies to the current scope and all nested scopes
- When debugging, remember that opted-out code may have type errors if it depends on macro-generated types
