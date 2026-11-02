# End User Guide

You're using a library that relies on typesugar macros internally. This guide shows you the minimal setup needed to make those macros work in your project.

## What You Need to Know

**You don't need to understand how macros work.** The library you're using handles all the macro logic. You just need to configure your build tool so that macros expand at compile time.

## Quick Setup

Run the setup wizard:

```bash
npx typesugar init
```

Select "I'm using a library built with typesugar" when prompted. The wizard will:

1. Install the required dev dependencies
2. Configure your `tsconfig.json`
3. Set up ts-patch for the TypeScript compiler

Then approve the library's macros (see [Step 5](#step-5-approve-the-library-s-macros)):

```bash
npx typesugar approve-macros
```

## Manual Setup

If you prefer to set things up manually:

### Step 1: Install Dependencies

```bash
# npm
npm install --save-dev @typesugar/transformer ts-patch

# pnpm
pnpm add -D @typesugar/transformer ts-patch

# yarn
yarn add --dev @typesugar/transformer ts-patch

# bun
bun add -d @typesugar/transformer ts-patch
```

### Step 2: Configure tsconfig.json

Add the transformer plugin to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [{ "transform": "@typesugar/transformer", "type": "program" }]
  }
}
```

### Step 3: Install ts-patch

ts-patch enables TypeScript transformer plugins to run during compilation:

```bash
npx ts-patch install
```

Add it to your `prepare` script so it persists after `npm install`:

```json
{
  "scripts": {
    "prepare": "ts-patch install -s"
  }
}
```

### Step 4: Configure Your Bundler (if applicable)

If you use a bundler like Vite, Webpack, or esbuild, you'll also need the unplugin:

```bash
npm install --save-dev unplugin-typesugar
```

See the [environment-specific guides](./index.md#environment-specific-guides) for your bundler.

### Step 5: Approve the library's macros

A library ships macros by declaring a `typesugar.macros` entry in its
`package.json`. Packages under the `@typesugar/*` scope are trusted
automatically. Any other package's macros run arbitrary code inside your build,
so typesugar refuses to load them until you approve them; until then the build
fails with:

```
The following package(s) declare a "typesugar.macros" entry but are not
@typesugar/*-scoped and have not been approved:
  - some-typesugar-library

Run `typesugar approve-macros` to review and approve them.
```

Run the command from your project root (the directory with `tsconfig.json`):

```bash
npx typesugar approve-macros        # lists the packages and asks for confirmation
npx typesugar approve-macros --yes  # approve without prompting (CI, scripts)
```

It writes the approved names into `typesugar.config.ts` under
`security.allowedMacroPackages` (creating the file if needed, and editing only that
key if it exists). Commit that file. Re-run the command when you add another
typesugar-powered library.

```typescript
// typesugar.config.ts
import { defineConfig } from "@typesugar/core";

export default defineConfig({
  security: {
    allowedMacroPackages: ["some-typesugar-library"],
  },
});
```

## Verify Setup

Run the diagnostic command:

```bash
npx typesugar doctor
```

All checks should pass. If not, follow the suggested fixes.

## That's It

You're done! Once its macros are approved, the library you're using will work
correctly. You don't need to import anything from typesugar directly — the library
handles all of that.

## Common Questions

### Do I need to change my code?

No. The library you're using already uses typesugar macros. You just need the build
configuration and the one-time `approve-macros` step.

### Why is this needed?

TypeScript macros run at compile time. Without the transformer configured, macro calls would remain in your code as regular function calls, which would fail at runtime.

### What if the library works without this setup?

Some libraries may include fallback runtime implementations. However, you'll get better performance and proper type safety by enabling macro expansion.

## Troubleshooting

See [Troubleshooting](./troubleshooting.md) for common issues.

If `typesugar doctor` shows failures:

1. **ts-patch not active**: Run `npx ts-patch install`
2. **Transformer not configured**: Add the plugin to `tsconfig.json`
3. **Bundler not configured**: Install `unplugin-typesugar` and add it to your bundler config

If the build fails with "…have not been approved", run `npx typesugar approve-macros`
and commit the `typesugar.config.ts` it writes.
