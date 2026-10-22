# Examples

Two kinds live here, and the difference matters.

## `standalone/` — copy these

Real, self-contained projects that install typesugar **from npm**. Copy the
directory anywhere and `npm install` works.

| Example                              | What it shows                                              |
| ------------------------------------ | ---------------------------------------------------------- |
| [`hello-world`](./standalone/hello-world) | `comptime`, `@derive`, operator sugar, `match` — in ~60 lines |

Start here if you want something to run. CI also builds each of them (and a
library from `typesugar create library`) against the repo's own packages
(`scripts/build-standalone-examples.mjs`), so a change that breaks them fails
before a release.

## Everything else — monorepo fixtures

`basic/`, `implicits/` and `dry-runs/*` depend on the workspace
(`"typesugar": "workspace:*"`), so they are exercised by this repo's CI (the
Examples job runs each one's `check`, `build` and `start` scripts) and they will
**not** install outside it. They're dogfood and regression fixtures,
not templates.

To start a real project, use the scaffolder rather than copying one of these:

```bash
npx typesugar create app my-app     # or: library, macro-plugin
npx typesugar init                  # add typesugar to an existing project
```
