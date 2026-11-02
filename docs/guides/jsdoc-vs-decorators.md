# JSDoc vs Decorator Syntax

The TypeSugar attribute macros — `@derive`, `@typeclass`, `@impl`, `@reflect`,
`@adt`, `@hkt`, `@extension`, `@tailrec`, and friends — can be written two ways:

```typescript
// Decorator form
@derive(Eq, Clone)
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}

// JSDoc form
/** @derive(Eq, Clone) */
interface Point {
  x: number;
  y: number;
}
```

Both forms are read by the transformer and produce identical output. The
difference is **what plain `tsc` thinks of your source before TypeSugar runs**.

## Quick answer

| Target                 | Decorator `@macro` | JSDoc `/** @macro */` | Recommended                    |
| ---------------------- | ------------------ | --------------------- | ------------------------------ |
| `class`                | ✅ tsc-clean       | ✅ tsc-clean          | Either — decorator reads nicer |
| `interface`            | ⚠️ TS1206\*        | ✅ tsc-clean          | **JSDoc**                      |
| `function` declaration | ⚠️ TS1206\*        | ✅ tsc-clean†         | **JSDoc**                      |
| `type` alias           | ⚠️ TS1206\*        | ✅ tsc-clean          | **JSDoc**                      |

\* The transformer still understands the decorator and strips it from the
output; the warning only appears in tooling that runs **without** TypeSugar's
diagnostic filter (see below).

† On a function declaration, JSDoc dispatches only the attribute macros that
target functions, such as `/** @tailrec */` and `/** @extension */`. Any other
macro tag on a function (`/** @typeclass */`, …) is ignored with the warning
"JSDoc macro tag @X is not supported on a function declaration and was
ignored." `@derive` on a function, a `const` or an `enum` is an error,
[TS9102](/errors/TS9102): it only goes on an interface, class or type alias.

### A JSDoc tag must start its own comment line

A tag only triggers a macro when it begins a line of the comment:
`/** @derive(Eq) */` or ` * @derive(Eq)` on its own line. A tag mentioned
mid-sentence (`/** Derives @derive(Eq) for you */`) or inside a fenced code
example in the comment is treated as prose and does nothing, so documentation
comments can talk about macros without triggering them. An `@example` without a
fence ends at the next line-start tag, as in any JSDoc: a ` * @derive(Eq)` line
after an example's code is a real tag, so fence example code that shows one. On a declaration `@derive` can't apply to (the `const` of a derive macro
you are writing), a `@derive(X)` line followed by more text,
`@derive(Read) — derives a Read instance`, is documentation too.

A `@derive` tag's list is the parenthesized names, or the comma-separated names that start the
tag (`@derive Eq, Clone`). Text after the list, on the same line or the lines below it, is
description: a typeclass named there is not derived.

```typescript
/**
 * A 2D point.
 * @derive(Eq)
 */
interface Point {
  x: number;
  y: number;
}

/** @tailrec */
function sum(n: number, acc = 0): number {
  if (n <= 0) return acc;
  return sum(n - 1, acc + n); // compiled to a loop: sum(100000) does not overflow
}
```

**Rule of thumb:** use the decorator form on classes, and the JSDoc form on
everything else (interfaces, functions, type aliases). When in doubt, JSDoc is
always portable.

## Why TS1206 happens

TypeScript only allows decorators on classes and their members. Writing
`@derive(...)` on an `interface` or `function` produces:

```
error TS1206: Decorators are not valid here.
```

This is a **semantic** check, not a parse error: the decorator still attaches to
the declaration and the transformer can read and act on it. TypeSugar suppresses
TS1206 for its known macros via a diagnostic suppression rule, so:

- `typesugar check` reports **0** errors.
- The TypeSugar language-service plugin keeps your editor clean.
- `typesugar build` emits correct output (the decorator is stripped).

But any consumer of your code that runs **plain `tsc`** — a CI step without the
plugin, a teammate's editor that hasn't installed it, or a downstream library
build — will still surface TS1206, because they don't run TypeSugar's filter.
(Note that `typesugar build` does not gate on TS1206 either; see
[Type Safety](./type-safety.md) and the `check`/`build` split in the
[CLI reference](../reference/cli.md#check).)

The JSDoc form sidesteps all of this: `/** @derive(...) */` is a comment, so
plain `tsc` never complains, on any declaration.

## Guidance

- **Writing an application?** Either form is fine — your own pipeline runs
  TypeSugar everywhere. Use decorators on classes for readability and JSDoc on
  interfaces/functions to keep `tsc` quiet.
- **Publishing a library?** Prefer **JSDoc** for all macros so consumers who
  type-check your sources (or inline them) never hit TS1206. See
  [Authoring Libraries](./authoring-libraries.md).
- **Running `tsc` in CI without the plugin?** Use **JSDoc**, or add the
  TypeSugar language-service/transformer to that step.

## Examples

```typescript
// ✅ Class — decorator is clean and idiomatic
@derive(Eq, Clone, Debug)
class User {
  constructor(
    public id: number,
    public name: string
  ) {}
}

// ✅ Interface — use JSDoc (decorator would be TS1206 under plain tsc)
/** @derive(Eq, Clone, Debug) */
interface Config {
  host: string;
  port: number;
}

// ✅ Typeclass on an interface — JSDoc
/** @typeclass */
interface Show<A> {
  show(a: A): string;
}

// ✅ Contract on a function — no tag needed: the requires:/ensures: blocks
//    are auto-detected in files that import "@typesugar/contracts/syntax"
//    (see the Design by Contract guide)
import "@typesugar/contracts/syntax";

function withdraw(account: { balance: number }, amount: number): number {
  requires: {
    amount <= account.balance;
  }
  account.balance -= amount;
  return account.balance;
}
```

## See also

- [Type Safety](./type-safety.md) — the build / IDE / CI three-layer model
- [Authoring Libraries](./authoring-libraries.md) — why libraries should prefer JSDoc
- [Derive Macros](./derive.md) · [Typeclasses](./typeclasses.md) · [Design by Contract](./contracts.md)
