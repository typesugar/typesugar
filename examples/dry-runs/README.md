# Dry-run scenarios

Each subdirectory is a self-contained mini-application that a new user might
build by following the docs. They exercise TypeSugar end-to-end through the CLI
(`typesugar run` / `typesugar check` / `typesugar build`) and double as smoke
tests for the headline features.

| Scenario                | Packages exercised                              |
| ----------------------- | ----------------------------------------------- |
| `rest-api`              | `@derive`, `sql`, `match`, `Option`/`Either`, `comptime`, `fieldNames`, `pipe` |
| `data-pipeline`         | `comptime`, `@derive`, `Either`, collections, fusion |
| `scientific-computing`  | `@typesugar/units` — dimensional analysis        |
| `parser-compiler`       | `@typesugar/parser` — PEG combinators            |
| `effect-service`        | `@typesugar/effect`, `@derive`, `pipe`, reflection |
| `fp-domain`             | `@typeclass`/`@impl`, newtypes, `Either`, contracts |

## Running a scenario

These are workspace packages, so a single `pnpm install` at the repo root links
the local `@typesugar/*` packages. Then, from any scenario directory:

```bash
pnpm start          # typesugar run src/main.ts  — compile + execute
pnpm check          # typesugar check            — typecheck only (CI gate)
pnpm build          # typesugar build            — emit to dist/
```

The package names are prefixed `typesugar-example-dry-run-*`, so they are
excluded from the repo's `pnpm build` / `typecheck` (which filter out
`typesugar-example-*`). They have no test files and are not run by `vitest`.

> Note: the scenarios assume the `@typesugar/*` packages are built (`pnpm build`
> at the repo root). `typesugar run`/`check` resolve macros from the built
> `dist/` of each linked package.
