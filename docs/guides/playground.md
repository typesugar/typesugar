# Interactive Playground

typesugar includes an interactive playground that lets you try code directly in your browser without installing anything.

**[Open the Playground →](/playground)**

## What Works in the Playground

The playground runs the full typesugar transformer in your browser. You can:

- **Write and transform** — see your code compiled in real time
- **Run the output** — execute transformed code with console output
- **Use runtime libraries** — `import` from `@typesugar/*` packages and run real code
- **Toggle file types** — switch between `.ts` (JSDoc macros) and `.sts` (custom syntax)
- **Share** — copy a URL that encodes your code

### Runtime Library Support

The playground bundles runtime implementations of `@typesugar/*` packages, so imports actually work at runtime — not just at the type level. When you press Run, your code executes with real `@typesugar/fp`, `@typesugar/collections`, `@typesugar/graph`, and more.

Available packages:

| Package                         | What You Can Use                              |
| ------------------------------- | --------------------------------------------- |
| `typesugar` / `@typesugar/core` | `staticAssert`, `comptime`, macro APIs        |
| `@typesugar/fp`                 | `Some`, `None`, `Left`, `Right`, `pipe`, `IO` |
| `@typesugar/std`                | Extension methods, pattern matching, ranges   |
| `@typesugar/collections`        | `HashSet`, `HashMap`                          |
| `@typesugar/graph`              | `DiGraph`, `StateMachine`                     |
| `@typesugar/contracts`          | `requires`, `ensures`, `invariant`            |
| `@typesugar/units`              | Dimensional analysis                          |
| `@typesugar/codec`              | Schema codecs                                 |
| `@typesugar/parser`             | Parser combinators                            |
| `@typesugar/symbolic`           | Symbolic expressions, calculus                |
| `@typesugar/type-system`        | Newtype, refined types                        |
| `@typesugar/typeclass`          | `@typeclass`, `@instance`, `summon`           |
| `@typesugar/validate`           | Schema validation                             |
| `@typesugar/mapper`             | Object mapping                                |

Packages with heavy Node.js dependencies (`@typesugar/math`, `@typesugar/testing`, `@typesugar/effect`) are excluded from the runtime bundle.

## Examples

The playground ships with 20+ examples organized by module. Pick one from the **Examples** dropdown to see a feature in action.

| Category                   | Examples                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| **Getting Started**        | Welcome                                                                                    |
| **Core Macros**            | @typeclass, @derive, extension, comptime, pipe & compose, static-assert, reflect, @tailrec |
| **@typesugar/fp**          | Option & Either, Validated, Linked List                                                    |
| **@typesugar/std**         | Pattern Matching, Ranges                                                                   |
| **@typesugar/collections** | HashSet & HashMap                                                                          |
| **@typesugar/graph**       | Directed Graph, State Machine                                                              |
| **@typesugar/contracts**   | Design by Contract                                                                         |
| **@typesugar/units**       | Dimensional Analysis                                                                       |
| **@typesugar/codec**       | Schema Codec                                                                               |
| **@typesugar/parser**      | Arithmetic Parser                                                                          |
| **@typesugar/symbolic**    | Calculus                                                                                   |
| **Preprocessor (.sts)**    | _(coming soon)_                                                                            |

All examples are runnable — they use real runtime libraries, not stubs.

## Adding Examples

Examples live in `docs/examples/` and are auto-discovered at build time. To add one:

### 1. Create a file

```
docs/examples/<module>/<example-name>.ts
```

The directory name becomes the group in the dropdown. Use an existing directory, or create a new one.

### 2. Add metadata

Every example starts with `//!` metadata lines:

```typescript
//! Example Title
//! Short description of what this demonstrates

import { Some, None } from "@typesugar/fp";

// Your code here...
console.log(Some(42));
```

The first `//!` line is the **name** shown in the dropdown. The second is the **description** shown on hover. Everything after the metadata block is the code loaded into the editor.

### 3. Register the group (optional)

If you created a new directory, add it to the `GROUP_META` object in `docs/.vitepress/components/playground-examples.ts`:

```typescript
const GROUP_META: Record<string, { label: string; order: number }> = {
  // ...existing groups...
  "my-module": { label: "@typesugar/my-module", order: 55 },
};
```

Groups without an entry still appear — they just use the directory name as-is and sort to the middle.

### Tips for good examples

- **Make it runnable.** Use `console.log()` so pressing Run shows output.
- **Keep it focused.** One concept per example. 20–40 lines is ideal.
- **Use real imports.** `import { ... } from "@typesugar/fp"` works in the sandbox.
- **Show the value.** Don't just define types — demonstrate behavior.

## Embedded Playgrounds

You can embed smaller playgrounds directly in documentation pages:

```vue
<PlaygroundEmbed
  code="const x = 42;
console.log(x);"
  mode=".ts"
  height="150px"
/>
```

### Props

| Prop         | Type                | Default   | Description              |
| ------------ | ------------------- | --------- | ------------------------ |
| `code`       | `string`            | Required  | Initial code content     |
| `mode`       | `".ts"` \| `".sts"` | `".ts"`   | File type / syntax mode  |
| `readonly`   | `boolean`           | `false`   | Prevent editing          |
| `height`     | `string`            | `"300px"` | Editor panel height      |
| `hideOutput` | `boolean`           | `false`   | Hide the output panel    |
| `title`      | `string`            | `""`      | Optional title in header |

Every embedded playground has an **Open in Playground** button that opens the code in the full playground with all settings preserved.

::: tip
For code containing angle brackets (like generics), use the [full playground](/playground) or the "Open in Playground" button to expand embedded examples.
:::

## Keyboard Shortcuts

| Shortcut           | Action                      |
| ------------------ | --------------------------- |
| `Cmd/Ctrl + Enter` | Run code                    |
| `Cmd/Ctrl + S`     | Transform (without running) |
