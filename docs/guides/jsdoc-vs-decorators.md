# JSDoc vs Decorator Syntax

Every TypeSugar attribute macro — `@derive`, `@typeclass`, `@impl`, `@reflect`,
`@contract`, `@adt`, `@hkt`, and friends — can be written two ways:

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
| `function` declaration | ⚠️ TS1206\*        | ✅ tsc-clean          | **JSDoc**                      |
| `type` alias           | ⚠️ TS1206\*        | ✅ tsc-clean          | **JSDoc**                      |

\* The transformer still understands the decorator and strips it from the
output; the warning only appears in tooling that runs **without** TypeSugar's
diagnostic filter (see below).

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
TS1206 for its known macros via a SFINAE rule, so:

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

// ✅ Contract on a function — JSDoc (or just the requires:/ensures: blocks,
//    which are auto-detected; see the Design by Contract guide)
/** @contract */
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
