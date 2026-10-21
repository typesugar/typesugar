# Developer Experience

typesugar is designed so that when something goes wrong, you spend your time fixing the problem — not figuring out what the problem is.

## The Three Pillars

1. **Error messages that help** — every diagnostic has a code, and many carry notes (such as a resolution trace) and a suggested fix
2. **Import hints** — errors such as a missing typeclass instance or an unactivated syntax name the import to add
3. **Tool compatibility** — ESLint, TypeScript, and "organize imports" all understand typesugar imports

## Error Messages

typesugar errors follow the Rust/Elm model: show the code, point at the problem, explain why, suggest a fix.

Here `@derive(Eq)` can't build an `Eq` for `Palette`, because its fields' type has none:

```typescript
import { derive, Eq } from "typesugar";

interface Color {
  r: number;
  g: number;
  b: number;
}

@derive(Eq)
interface Palette {
  primary: Color;
  accent: Color;
}
```

```
src/palette.ts(9,9): error TS9106: [typesugar] [TS9106] Cannot derive Eq for 'Palette'
  = note: resolution trace for Eq<Palette>:
  1. derivation-strategy: Eq — ok
  2. generic-meta: GenericMeta for Palette: { primary: Color, accent: Color } — FAILED — one or more fields lack required instance
    field-check: field `primary`: Color — FAILED — Color lacks Eq
    field-check: field `accent`: Color — FAILED — Color lacks Eq
```

The fix is `@derive(Eq)` on `Color` too. The CLI prints diagnostics in the `tsc` layout, and
your editor shows the same text at the same place. Every error includes:

| Part             | What it does                                               |
| ---------------- | ---------------------------------------------------------- |
| `error TS9106`   | Error code — look it up in the [error reference](/errors/) |
| Location         | Points at exactly what went wrong                          |
| `= note:`        | Explains _why_ this is an error                            |
| `= help:` (many) | Tells you _what to do_ about it                            |

For the full catalog of error codes and examples, see the [Error Messages Guide](./error-messages.md).

## Import Suggestions

Scala 3 taught us that missing implicits/imports are the #1 pain point in typeclass-heavy code. typesugar tackles this with hints on the errors that are usually caused by a missing import. For example, a comprehension with no instance in scope (TS9225), a label whose syntax isn't activated (TS9224), or an operator whose typeclass's operator syntax isn't activated (TS9804) names the import to add.

::: info Planned — not in 1.0
A general "Did you mean to import?" error for an unimported macro (TS9061) is catalogued but not emitted. Today, calling `comptime(...)` without importing it gives no typesugar diagnostic: the call is left as-is, and TypeScript reports the unknown name.
:::

### How It Works

typesugar maintains a `ModuleExportIndex` — a map of exported symbols across the `@typesugar/*` packages — that import hints draw on. It ranks matches by:

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

The language service plugin is a separate entry in your tsconfig plugins, next to the transformer (`npx typesugar init` adds both):

```json
{
  "compilerOptions": {
    "plugins": [
      { "name": "@typesugar/transformer/language-service" },
      { "transform": "@typesugar/transformer", "type": "program" }
    ]
  }
}
```

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
const fast = add(numericPoint, p1, p2); // Auto-specialized: inlined
const slow = add(numericPoint, p1, p2); // @ts-no-typesugar — left as-is
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
| `typeclasses` | `@typeclass`, `@impl`, `summon()`                                |
| `operators`   | Operator overloading                                             |

Full details: [Opt-Out Guide](./opt-out.md)

## Putting It Together

Here's what the full experience looks like when you're writing typesugar code:

1. **You write code** using typeclasses, macros, extensions — no boilerplate
2. **Something goes wrong** — the error points at the exact problem with a fix suggestion
3. **You forgot an import** — for missing instances and unactivated syntax, the error names the import to add
4. **Your IDE helps** — quick fixes apply suggestions, organize imports works correctly
5. **You need to debug** — opt out at any granularity, from one line to a whole file
6. **You look up an error code** — the [error reference](/errors/) has a page for each code

The goal: you should never be confused about what went wrong or how to fix it.
