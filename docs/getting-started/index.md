# Getting Started

Welcome to typesugar! This guide will help you get set up based on how you plan to use it.

## Quick Start

### New Project

Create a new project from a template:

```bash
# Create an app with Vite
npx typesugar create app my-app

# Create a library with typeclasses
npx typesugar create library my-lib

# Create a custom macros package
npx typesugar create macro-plugin my-macros
```

Then:

```bash
cd my-app
npm install
npx ts-patch install
npm run dev
```

### Existing Project

Add typesugar to an existing project with our setup wizard:

```bash
npx typesugar init
```

This will detect your project setup, install the required packages, and configure everything automatically.

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

typesugar supports two file extensions:

| Extension        | Use When                                                                      |
| ---------------- | ----------------------------------------------------------------------------- |
| `.ts` / `.tsx`   | JSDoc macros only (`/** @typeclass */`, `let:`, `comptime()`)                 |
| `.sts` / `.stsx` | Custom operators (`\|>`, `::`), HKT syntax (`F<_>`), decorators on interfaces |

Most typesugar features work in `.ts` files. Use `.sts` only when you need custom syntax that isn't valid TypeScript.

See the [migration guide](../migration/sts-migration.md) for details.

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

Once you're set up, explore the feature guides:

- [Compile-Time Evaluation](../guides/comptime.md) — Run code at build time
- [Derive Macros](../guides/derive.md) — Auto-generate implementations
- [Typeclasses](../guides/typeclasses.md) — Scala 3-style ad-hoc polymorphism
- [Operators](../guides/operators.md) — Operator overloading
- [Tagged Templates](../guides/tagged-templates.md) — Type-safe SQL, regex, and more

Or dive into the [Architecture](../architecture.md) to understand how typesugar works under the hood.
