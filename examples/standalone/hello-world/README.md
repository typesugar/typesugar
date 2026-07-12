# typesugar hello world

The smallest real typesugar app. **Copy this directory anywhere** — it installs
typesugar from npm, not from this repo, so it works standalone.

```bash
npm install
npm run dev      # http://localhost:5173
```

Three commands worth knowing:

```bash
npm run expand   # see what the macros ACTUALLY compile to — start here
npm run check    # type-check (use this, not `tsc --noEmit`)
npm run doctor   # verify the pipeline is wired up
```

## What it shows

| Feature       | In `src/main.ts`                | Compiles to                                        |
| ------------- | ------------------------------- | -------------------------------------------------- |
| `comptime`    | `comptime(() => sum(1..100))`   | the literal `5050` — the loop is gone               |
| `@derive`     | `/** @derive(Eq, Debug) */`     | a `Point.Eq` / `Point.Debug` companion namespace    |
| operator sugar | `a === b`                       | `Point.Eq.equals(a, b)` — a structural compare      |
| `match`       | `match(shape, { circle, square })` | a ternary chain; a missing variant is a compile error |

Run `npm run expand` and read the diff. That is the whole pitch: **none of this
exists at runtime.**

## One thing that trips people up

Operator sugar is **import-scoped**. `===` only rewrites to the derived `Eq`
instance in files that opt in:

```ts
import "@typesugar/std/syntax/eq/ops";
```

Without that line `a === b` stays plain reference equality (and would be
`false` here). This is deliberate — typesugar never changes the meaning of
`===` in a file that didn't ask for it.

## Using an AI assistant?

`AGENTS.md` in this directory tells Claude Code / Cursor / Copilot how
typesugar works — that macro imports aren't dead code, that the build plugin
must stay, and how to debug an expansion. `typesugar init` writes it into your
own projects too.
