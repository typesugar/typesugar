# Examples

Two kinds live here, and the difference matters.

## `standalone/` — copy these

Real, self-contained projects that install typesugar **from npm**. Copy the
directory anywhere and `npm install` works.

| Example                              | What it shows                                              |
| ------------------------------------ | ---------------------------------------------------------- |
| [`hello-world`](./standalone/hello-world) | `comptime`, `@derive`, operator sugar, `match` — in ~60 lines |

Start here if you want something to run.

## Everything else — monorepo fixtures

`basic/`, `implicits/` and `dry-runs/*` depend on the workspace
(`"typesugar": "workspace:*"`), so they are exercised by this repo's CI and
they will **not** install outside it. They're dogfood and regression fixtures,
not templates.

To start a real project, use the scaffolder rather than copying one of these:

```bash
npx typesugar create app my-app     # or: library, macro-plugin
npx typesugar init                  # add typesugar to an existing project
```
