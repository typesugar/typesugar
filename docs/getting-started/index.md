# Getting Started

Welcome to typesugar! This guide will help you get set up based on how you plan to use it.

::: tip Try Without Installing
Want to explore typesugar before setting up? **[Try the Interactive Playground →](/playground)**

Write code, see transformed output, and run examples — all in your browser.
:::

## Quickstart (5 minutes)

From an existing TypeScript project, run the setup wizard:

```bash
npx typesugar init
```

`init` detects your stack (package manager, bundler, TypeScript), installs the
packages, configures `tsconfig.json` (the transformer **and** the editor plugin),
wires up `ts-patch`, patches your bundler config, and drops a runnable example at
`src/typesugar-example.ts`.

Run the example and see its output:

```bash
npx typesugar run src/typesugar-example.ts
```

Now see what the macros actually compiled to:

```bash
npx typesugar expand src/typesugar-example.ts --diff
```

That `--diff` is the "aha": `@derive(Eq, Clone, Debug, Json)` becomes plain
comparison/copy/serialize code, and `comptime(...)` becomes a constant — exactly
what you'd write by hand, with no runtime library or overhead.

> **Starting fresh?** `npx typesugar create app my-app` scaffolds a ready-to-run
> Vite project (also `create library` and `create macro-plugin`).
>
> **No install at all?** Try everything in the **[Playground](/playground)**.

## How typesugar works

typesugar is a set of **compile-time macros** — transformations that run during
the build, before your code executes. `comptime(expr)` evaluates `expr` at build
time and inlines the result; `@derive(Eq)` generates comparison code from your
type's shape. The output is ordinary TypeScript/JavaScript, so there's nothing to
ship at runtime.

Because the work happens at compile time, typesugar plugs into three layers —
and `typesugar init` wires all three for you:

| Layer      | What it gives you                                  | How                                                                         |
| ---------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| **Build**  | macros expand when you compile or bundle           | `@typesugar/transformer` (via ts-patch, or the Vite/esbuild/Webpack plugin) |
| **Editor** | your IDE sees the expanded types — no false errors | the `typesugar/language-service` TypeScript plugin                          |
| **CI**     | the build fails on real type errors                | `typesugar check`                                                           |

If your editor flags valid macro code as an error, the **Editor** layer isn't
active — see [Editor Setup](./editor-setup.md). For the full model and how to
configure each layer, see [Type Safety](../guides/type-safety.md).

## Choose Your Path

typesugar serves three types of users. Choose the path that best describes you:

### I'm using a library built with typesugar

**[End User Guide](./end-user.md)**

You're using a library (like an ORM, validation library, or framework) that uses typesugar internally. You need minimal setup — just configure your build tool so the macros expand.

**Time to setup:** ~2 minutes

### I want to use typesugar features in my app

**[App Developer Guide](./app-developer.md)**

You want to use typesugar features directly in your application or library — things like `comptime()`, `@derive()`, type-safe SQL, or typeclasses.

**Time to setup:** ~5 minutes

### I want to write custom macros or extensions

**[Extension Author Guide](./extension-author.md)**

You want to create custom macros, syntax extensions, or publish a typesugar-powered library for others to use.

**Time to setup:** ~10 minutes

## Environment-Specific Guides

Once you've followed your persona guide, you may need environment-specific configuration:

| Build Tool     | Guide                                      |
| -------------- | ------------------------------------------ |
| Vite           | [Vite Setup](./environments/vite.md)       |
| Webpack        | [Webpack Setup](./environments/webpack.md) |
| esbuild        | [esbuild Setup](./environments/esbuild.md) |
| tsc (ts-patch) | [tsc Setup](./environments/tsc.md)         |
| Bun            | [Bun Setup](./environments/bun.md)         |

| Testing | Guide                                    |
| ------- | ---------------------------------------- |
| Vitest  | [Vitest Setup](./environments/vitest.md) |
| Jest    | [Jest Setup](./environments/jest.md)     |

| Monorepo          | Guide                                        |
| ----------------- | -------------------------------------------- |
| pnpm/Turborepo/Nx | [Monorepo Setup](./environments/monorepo.md) |

## File Extensions

typesugar works with standard TypeScript files (`.ts` / `.tsx`). All features are driven by JSDoc macros (`/** @typeclass */`, `let:`, `comptime()`) and the HKT type rewrite (`F<A>` → `Kind<F, A>`) — no custom file extension or surface syntax is required.

## Additional Setup

- [Editor Setup](./editor-setup.md) — VSCode extension and ESLint configuration
- [Troubleshooting](./troubleshooting.md) — Common issues and how to fix them

## Verify Your Setup

After installation, run the diagnostic command to verify everything is configured correctly:

```bash
npx typesugar doctor
```

This checks:

- TypeScript and ts-patch installation
- tsconfig.json plugin configuration
- Package version consistency
- Bundler plugin setup

## What's Next?

- **[Zero-Cost, Seen](../guides/zero-cost.md)** — the actual compiled output; see the magic, proven
- **[Runnable examples](https://github.com/typesugar/typesugar/tree/main/examples)** — six full app scenarios (REST API, data pipeline, FP domain, scientific computing, parser, Effect service) you can `typesugar run`

Then explore the feature guides:

- [Compile-Time Evaluation](../guides/comptime.md) — Run code at build time
- [Derive Macros](../guides/derive.md) — Auto-generate implementations
- [Typeclasses](../guides/typeclasses.md) — Scala 3-style ad-hoc polymorphism
- [Operators](../guides/operators.md) — Operator overloading
- [Tagged Templates](../guides/tagged-templates.md) — Type-safe SQL, regex, and more

Or dive into the [Architecture](../architecture.md) to understand how typesugar works under the hood.
