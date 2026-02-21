# Developer Experience

typesugar is designed so that when something goes wrong, you spend your time fixing the problem — not figuring out what the problem is.

## The Three Pillars

1. **Error messages that help** — Rust-style diagnostics with labeled spans, notes, and auto-fixable suggestions
2. **Import suggestions** — "Did you mean to import...?" when symbols aren't in scope
3. **Tool compatibility** — ESLint, TypeScript, and "organize imports" all understand typesugar imports

## Error Messages

typesugar errors follow the Rust/Elm model: show the code, point at the problem, explain why, suggest a fix.

```
error[TS9001]: No instance found for `Eq<Color>`
  --> src/palette.ts:12:5
   |
10 |   interface Palette { primary: Color; accent: Color }
11 |
12 |   p1 === p2
   |      ^^^ Eq<Palette> requires Eq for all fields
   |
 8 |   interface Color { r: number; g: number; b: number }
   |   --------- field `primary` has type `Color`
   |
   = note: Auto-derivation requires Eq instances for all fields
   = help: Add @derive(Eq) to Color, or provide @instance Eq<Color>
```

Every error includes:

| Part                     | What it does                                                  |
| ------------------------ | ------------------------------------------------------------- |
| `error[TS9001]`          | Error code — look it up with `npx typesugar --explain TS9001` |
| Primary span (`^^^`)     | Points at exactly what went wrong                             |
| Secondary labels (`---`) | Shows related code that contributes to the error              |
| `= note:`                | Explains _why_ this is an error                               |
| `= help:`                | Tells you _what to do_ about it                               |
| `= suggestion:`          | Machine-applicable fix — your IDE can apply it in one click   |

For the full catalog of error codes and examples, see the [Error Messages Guide](./error-messages.md).

## Import Suggestions

Scala 3 taught us that missing implicits/imports are the #1 pain point in typeclass-heavy code. typesugar tackles this head-on.

When you use a symbol that isn't imported, typesugar checks its index of known exports and suggests the right import:

```
error[TS9061]: Macro `comptime` is not defined
  --> src/app.ts:3:15
   |
 3 |   const x = comptime(() => 1 + 1);
   |             ^^^^^^^
   |
   = help: Did you mean to import?
     + import { comptime } from "typesugar";
```

This works for:

- **Macros** — `comptime`, `specialize`, `match`, `cfg`, etc.
- **Typeclasses** — `Eq`, `Show`, `Ord`, `Functor`, etc.
- **Extension methods** — `NumberExt`, `StringExt`, `ArrayExt`, etc.
- **Types** — `Option`, `Either`, `IO`, etc.

### How It Works

typesugar maintains a `ModuleExportIndex` — a map of every exported symbol across all `@typesugar/*` packages. When a symbol fails to resolve, it searches the index and ranks matches by:

1. **Exact name match** — highest confidence
2. **Module preference** — prefers `typesugar` (umbrella) over individual packages
3. **Symbol kind** — if you called it as a function, prefer function/macro matches over types

Library authors can extend the index:

```typescript
import { registerExport } from "@typesugar/core";

registerExport({
  name: "MyCustomThing",
  module: "my-typesugar-plugin",
  kind: "macro",
});
```

## Tool Compatibility

### The Problem

typesugar imports look unused to standard TypeScript tooling. You write:

```typescript
import { Eq, Show } from "@typesugar/std";
```

But in the transformed output, `Eq` and `Show` don't appear — they were consumed by the transformer to generate inline code. So TypeScript's `TS6133` ("declared but never read") and ESLint's `no-unused-imports` both want to remove them.

### The Solution

typesugar handles this at two levels — no configuration needed:

**TypeScript Language Service Plugin** — suppresses `TS6133` specifically for imports from `@typesugar/*` and `typesugar` packages. It does _not_ suppress all unused variable warnings — just the ones on typesugar imports.

**ESLint Processor** (`@typesugar/eslint-plugin`) — the `postprocess` hook filters out `no-unused-imports` errors for typesugar package imports. Your ESLint config stays exactly the same.

The result: "Organize Imports" works correctly, `no-unused-imports` catches real unused imports, and typesugar imports don't get flagged.

### Setup

```bash
npm install -D @typesugar/eslint-plugin
```

```javascript
// eslint.config.js
import typesugar from "@typesugar/eslint-plugin";

export default [
  {
    files: ["**/*.ts"],
    processor: typesugar.processors.typesugar,
  },
];
```

That's it. The language service plugin activates automatically when `@typesugar/transformer` is in your tsconfig plugins.

## Opt-Out Directives

Sometimes you need to disable typesugar — for debugging, benchmarking, or interop with other transformers. Inspired by React Compiler's `"use no memo"`:

### File Level

```typescript
"use no typesugar";

// Nothing in this file gets transformed
```

### Function Level

```typescript
function normalCode() {
  const x = comptime(() => 1 + 2); // Transformed → 3
}

function debugThis() {
  "use no typesugar";
  const x = comptime(() => 1 + 2); // Left as-is
}
```

### Line Level

```typescript
const fast = specialize(add); // Transformed: inlined
const slow = specialize(add); // @ts-no-typesugar — left as-is
```

### Feature-Specific

```typescript
"use no typesugar extensions";

// Extension methods disabled — macros still work
(42).clamp(0, 100); // Won't rewrite (runtime error)
const x = comptime(() => 1 + 1); // Still transformed → 2
```

| Feature       | What it disables                                                 |
| ------------- | ---------------------------------------------------------------- |
| `macros`      | Expression macros, tagged templates, type macros, labeled blocks |
| `derive`      | `@derive()` decorator expansion                                  |
| `extensions`  | Standalone extension method rewriting                            |
| `typeclasses` | `@typeclass`, `@instance`, `summon()`                            |
| `operators`   | Operator overloading                                             |

Full details: [Opt-Out Guide](./opt-out.md)

## Putting It Together

Here's what the full experience looks like when you're writing typesugar code:

1. **You write code** using typeclasses, macros, extensions — no boilerplate
2. **Something goes wrong** — the error points at the exact problem with a fix suggestion
3. **You forgot an import** — typesugar tells you what to import and from where
4. **Your IDE helps** — quick fixes apply suggestions, organize imports works correctly
5. **You need to debug** — opt out at any granularity, from one line to a whole file
6. **You look up an error code** — `npx typesugar --explain TS9001` gives the full explanation

The goal: you should never be confused about what went wrong or how to fix it.
