---
name: typesugar
description: >-
  Use when writing, debugging, or building code in a project that uses typesugar
  compile-time macros — comptime, @derive, match(), typeclasses, @impl/summon,
  operator overloading, Option/Either dot-syntax — or when a macro "didn't
  expand", a TS9xxx diagnostic appears, the editor and the build disagree about
  macro code, or a build/bundler config touching typesugar needs changing.
  Covers the macro syntax forms, the doctor/expand/check debugging loop, and the
  setup invariants that silently break macro expansion when violated.
---

# typesugar

typesugar is a **compile-time macro system** for TypeScript. Source files are
valid TypeScript, but they must be compiled through a typesugar-aware pipeline
(the `unplugin-typesugar` bundler plugin, or `ts-patch` for raw `tsc`) for
macros to expand. Everything expands at build time to plain TypeScript — no
runtime library, no runtime cost.

**Authoritative docs, machine-readable:**

- <https://typesugar.org/llms.txt> — index of every page
- <https://typesugar.org/llms-full.txt> — the entire corpus in one file
- <https://typesugar.org/errors/> — one page per diagnostic code, with fixes

Fetch these when you need detail beyond this skill. Do not guess at API shapes.

## Golden rule: verify the expansion before theorizing

When macro-using code misbehaves, the expansion is ground truth and it is one
command away. **Do this first**, before reading runtime code or hypothesizing:

```bash
npx typesugar doctor                    # is the pipeline wired up at all?
npx typesugar expand src/file.ts --diff # what did the macro ACTUALLY generate?
npx typesugar check                     # type-check, pre-transform noise filtered
```

Most "typesugar is broken" reports are one of:

| Symptom                                          | Cause                                                       | Check                                      |
| ------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------ |
| Macro call survives into the output; stub throws | The plugin is not in the bundler config, or ts-patch is off | `typesugar doctor`                         |
| Editor errors on valid macro code                | tsconfig `plugins` entry missing / wrong TS version         | `typesugar doctor`, then reload the editor |
| `tsc --noEmit` errors but the build is fine      | Raw `tsc` sees pre-expansion code (e.g. `TS1206`)           | Use `typesugar check` instead              |
| A `TS9xxx` error                                 | A real macro-level diagnostic                               | Read `typesugar.org/errors/TS9xxx`         |
| Instance "not found" for a type in another file  | Resolution is scope-based — it must be **imported**         | `typesugar expand --diff`                  |

## Setup invariants — violating these silently breaks expansion

1. **The build plugin must stay in the bundler config** (`plugins: [typesugar(), …]`)
   or ts-patch must stay installed for `tsc` builds. Removing it does not
   simplify the build; it turns every macro into dead code.
2. **The `plugins` entry in `tsconfig.json`** powers the editor. Keep it.
3. **Never delete a macro import that looks unused.** `derive`, `Eq`,
   `comptime` etc. are consumed by the transformer, not by the emitted JS.
4. **Never hand-write what a macro generates** (companion namespaces,
   `equals`/`clone`, schemas). Regenerate by building.
5. **Use `typesugar check`, not `tsc --noEmit`,** as the type-check gate.

## Syntax you will encounter

Attribute macros have two spellings; **JSDoc is the portable one** (a plain
`tsc` never complains about it), the decorator form is class-only and relies on
typesugar's diagnostic filtering:

```ts
/** @derive(Eq, Clone, Debug) */
interface Point {
  x: number;
  y: number;
}

@derive(Eq, Clone) // equivalent, classes only
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}
```

Derived instances are reached through the **companion**, not a global registry:

```ts
Point.Eq.equals(a, b); // generated companion
a === b; // sugar → rewritten to the line above
summon<Eq<Point>>().equals(a, b); // explicit summon
```

`match` is **expression-based** — `.then(value)`, not `.then(callback)`:

```ts
const area = match(shape)
  .case({ kind: "circle", radius: r })
  .then(Math.PI * r ** 2)
  .case({ kind: "square", side: s })
  .then(s ** 2);
// Missing a variant is a compile error.
```

Other forms: `comptime(expr)` (build-time evaluation, inlined as a literal),
`/** @impl Show<Point> */` on a `const` (hand-written instance),
`/** @typeclass */` (declare a typeclass).

## When adding typesugar to a project

Prefer the CLI over hand-editing configs — it detects the stack and patches
`tsconfig.json`, the bundler config, and the `prepare` script:

```bash
# Existing project. You are an agent: pass --yes, or init will ask questions
# you cannot answer. --persona picks the package set (app-developer is the
# safe default; end-user is right when the project merely CONSUMES a
# typesugar-powered library).
npx typesugar init --yes --persona app-developer

# New project from a template (pass both args — it prompts otherwise).
npx typesugar create app my-app
```

Then verify with `npx typesugar doctor` — do not declare success until it is
green.
