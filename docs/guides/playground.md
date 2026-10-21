# Interactive Playground

typesugar includes an interactive playground that lets you try code in your browser without installing anything.

**[Open the Playground →](/playground)**

## What Works in the Playground

You edit in the browser; the transform runs on the typesugar server (each edit
is sent to `/api/compile`), with the full transformer and the `@typesugar/*`
macro packages loaded. You can:

- **Write and transform** — see your code compiled as you type, with macro diagnostics in the editor
- **Share** — copy a URL that encodes your code

Two things are switched off on the public playground, because it compiles
untrusted code:

- **Run.** Pressing Run shows "Run is not available on the public playground".
  Copy the compiled output and run it locally, or run your source directly with
  `npx typesugar run <file>.ts`.
- **`comptime`.** Compile-time evaluation is disabled on the server, so
  `comptime(...)` calls are left unexpanded with a warning at each call site.

### Macro Packages

The server preloads the macros of these packages, so their macros expand in the
playground: `typesugar` / `@typesugar/macros`, `@typesugar/std`, `@typesugar/fp`,
`@typesugar/effect`, `@typesugar/contracts`, `@typesugar/type-system`,
`@typesugar/units`, `@typesugar/sql`, `@typesugar/parser`, `@typesugar/graph`,
`@typesugar/codec`, `@typesugar/mapper`, `@typesugar/strings`,
`@typesugar/testing`, `@typesugar/validate`, `@typesugar/erased` and
`@typesugar/fusion`. The `typeInfo<T>()` macro of `@typesugar/reflect` is
registered by `@typesugar/macros`, so it expands too.

`@typesugar/validate` and `@typesugar/testing` both have an `assert` macro.
Both are loaded, and the one you import is the one that expands (see
[Using validate and testing together](./validate.md#using-validate-and-testing-together)).

## Examples

The playground ships with 30+ examples organized by module. Pick one from the **Examples** dropdown to see a feature in action.

| Category                   | Examples                                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Getting Started**        | Welcome, Full Stack                                                                                                    |
| **Core Macros**            | @typeclass, @derive, extension, comptime, pipe & compose, static-assert, reflect, @tailrec, cfg, operators, specialize |
| **@typesugar/fp**          | Option & Either, Either, Validated, Linked List                                                                        |
| **@typesugar/std**         | Pattern Matching, Ranges, Do-Notation                                                                                  |
| **@typesugar/effect**      | Do-Comprehensions, Service Layer                                                                                       |
| **@typesugar/collections** | HashSet & HashMap                                                                                                      |
| **@typesugar/graph**       | Directed Graph, State Machine                                                                                          |
| **@typesugar/contracts**   | Design by Contract                                                                                                     |
| **@typesugar/units**       | Dimensional Analysis                                                                                                   |
| **@typesugar/math**        | Numeric Typeclass                                                                                                      |
| **@typesugar/codec**       | Schema Codec                                                                                                           |
| **@typesugar/parser**      | Arithmetic Parser                                                                                                      |
| **@typesugar/validate**    | Schema Validation                                                                                                      |
| **@typesugar/testing**     | Power Assert                                                                                                           |

The `comptime` example shows the unexpanded call on the public playground (see above).

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

- **Make it runnable.** Use `console.log()` so the output means something when the example is run locally (`npx typesugar run`).
- **Keep it focused.** One concept per example. 20–40 lines is ideal.
- **Use real imports.** `import { ... } from "@typesugar/fp"` works in the playground.
- **Show the value.** Don't just define types — demonstrate behavior.

## Embedded Playgrounds

You can embed smaller playgrounds directly in documentation pages:

```vue
<PlaygroundEmbed
  code="const x = 42;
console.log(x);"
  height="150px"
/>
```

### Props

| Prop         | Type      | Default   | Description              |
| ------------ | --------- | --------- | ------------------------ |
| `code`       | `string`  | Required  | Initial code content     |
| `readonly`   | `boolean` | `false`   | Prevent editing          |
| `height`     | `string`  | `"300px"` | Editor panel height      |
| `hideOutput` | `boolean` | `false`   | Hide the output panel    |
| `title`      | `string`  | `""`      | Optional title in header |

Every embedded playground has an **Open in Playground** button that opens the code in the full playground with all settings preserved.

::: tip
For code containing angle brackets (like generics), use the [full playground](/playground) or the "Open in Playground" button to expand embedded examples.
:::

## Keyboard Shortcuts

| Shortcut           | Action                                     |
| ------------------ | ------------------------------------------ |
| `Cmd/Ctrl + Enter` | Run (unavailable on the public playground) |
| `Cmd/Ctrl + S`     | Copy the share URL                         |

The transform runs automatically as you type; there is no shortcut for it.
