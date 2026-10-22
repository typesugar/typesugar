# Configuration Reference

All configuration options for typesugar. There are four places settings live:

| Where                                                         | What it controls                                                            |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [`typesugar.config.ts`](#typesugar-config-ts)                 | Project-wide settings: contracts, debug, feature flags, macro-package trust |
| [`TYPESUGAR_*` environment variables](#environment-variables) | Overrides for the config file (CI, one-off builds)                          |
| [tsconfig.json plugin entries](#tsconfig-json)                | The ts-patch transformer and the editor (language-service) plugin           |
| [Bundler plugin options](#bundler-plugins-unplugin-typesugar) | Which files the Vite/esbuild/Webpack/Rollup plugin transforms               |

## `typesugar.config.ts`

The project config file. typesugar uses the nearest one, walking up from the directory
being compiled (the tsconfig directory for the CLI, `approve-macros`, the editor, the
bundler plugins and a ts-patched `tsc -p`) and stopping at the repository root (the
directory with `.git`). Code that reads the config with no host (`config.get()` in your
own script) searches up from the working directory. A config file is code: one in your
repository is trusted like the rest of it (see
[Security](../SECURITY.md#what-typesugar-trusts)). A config inside a `node_modules`
directory (a config file or a `package.json` `"typesugar"` block) is a dependency's and is
never read; the search walks past it. A host serving several projects (the editor, the
Node loader) applies each project's config to that project's files only.

```typescript
// typesugar.config.ts
import { defineConfig } from "@typesugar/core"; // also exported by "typesugar"

export default defineConfig({
  debug: false,
  contracts: {
    mode: "full",
    proveAtCompileTime: false,
    strip: { preconditions: false, postconditions: false, invariants: false },
  },
  features: {
    experimental: false,
  },
  security: {
    allowedMacroPackages: ["some-typesugar-library"],
  },
});
```

Within one directory these file names are tried in order; the first one found wins:
`typesugar.config.ts`, `typesugar.config.js`, `typesugar.config.cjs`, `.typesugarrc`,
`.typesugarrc.json`, `.typesugarrc.yaml`, `.typesugarrc.yml`, `.typesugarrc.js`,
`.typesugarrc.cjs`, `.typesugarrc.ts`, and finally a `"typesugar"` field in
`package.json`. (`.mjs` config files are not supported.)

A config file that exists but fails to load is reported as a warning, and only the
defaults and `TYPESUGAR_*` variables apply; `typesugar approve-macros` refuses to
write anything until the file loads.

### `TypesugarConfig` keys

| Key                              | Type                                   | Default  | Description                                                                                        |
| -------------------------------- | -------------------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `debug`                          | boolean                                | `false`  | Debug mode                                                                                         |
| `contracts.mode`                 | `"full"` \| `"assertions"` \| `"none"` | `"full"` | `full`: all checks; `assertions`: class invariants only; `none`: all contract checks stripped      |
| `contracts.proveAtCompileTime`   | boolean                                | `false`  | Try to prove conditions at compile time and drop the runtime checks that are proven (experimental) |
| `contracts.strip.preconditions`  | boolean                                | `false`  | Strip `requires` checks                                                                            |
| `contracts.strip.postconditions` | boolean                                | `false`  | Strip `ensures` checks                                                                             |
| `contracts.strip.invariants`     | boolean                                | `false`  | Strip `@invariant` checks                                                                          |
| `features`                       | `Record<string, boolean>`              | `{}`     | Feature flags, readable from config conditions (e.g. `"features.experimental"`)                    |
| `security.allowedMacroPackages`  | string[]                               | `[]`     | Non-`@typesugar/*` packages allowed to load macros (names, or `"@scope/*"`). See below             |
| any other key                    | unknown                                | —        | Custom values, readable with `config.get("your.key")` from `@typesugar/core`                       |

`TypesugarConfig` also declares a `resolution` block (`mode`, `fileOverrides`,
`prelude`, `trace`); the 1.0 macros don't read it, since instance resolution is
always import-scoped (PEP-052).

### `security.allowedMacroPackages`

A package that declares a `typesugar.macros` entry in its `package.json` provides
macros. Packages under `@typesugar/*` (and `typesugar` itself) are trusted
automatically. Every other macro package runs code inside your build, so it is
refused, and the build fails with "…have not been approved. Run
`typesugar approve-macros`…", until its name is in this list.

The list is about dependencies: the package a bare import (or a relative path
into `node_modules`) resolves to, as Node resolves it from the importing file. A
macro package reached by a relative path outside `node_modules`, such as a
vendored directory, is your project's own code and loads without approval (see
[Security](../SECURITY.md#what-typesugar-trusts)).

Don't edit the list by hand unless you have to: run
[`npx typesugar approve-macros`](./cli.md#approve-macros), which finds the
unapproved packages, asks for confirmation (or not, with `--yes`), and writes them
here. It creates `typesugar.config.ts` if there is none, and otherwise rewrites only
the `allowedMacroPackages` value. Review each entry as you would a new production
dependency, and commit the file.

### Reading config from code

```typescript
import { config } from "@typesugar/core";

config.get("debug"); // boolean
config.get("contracts.mode"); // "full" | "assertions" | "none"
config.set({ contracts: { mode: "none" } }); // programmatic override (until reload)
```

`config.get()` reads the current config, one per process. A host that serves several
projects keeps each one's: `config.load({ searchFrom: projectDir })`, then
`config.capture()`, and `config.runWith(snapshot, () => …)` around that project's work. A
`TransformationPipeline` does this when given `config: snapshot` (`createPipeline` passes
it).

`@typesugar/contracts` also has `setContractConfig({ mode, proveAtCompileTime, strip })`
and `getContractConfig()`, which read and write the same `contracts` block.

## Environment Variables

`TYPESUGAR_*` variables override the config file (environment beats file beats
defaults). The name maps to a config path like this:

- the first single `_` separates the top-level key: `TYPESUGAR_CONTRACTS_MODE` →
  `contracts.mode`
- `__` separates any further nesting: `TYPESUGAR_CONTRACTS__STRIP__PRECONDITIONS` →
  `contracts.strip.preconditions`
- every other `_` joins words in camelCase: `TYPESUGAR_CONTRACTS_PROVE_AT_COMPILE_TIME`
  → `contracts.proveAtCompileTime`

Values `1`/`true` become `true`, `0`/`false`/empty become `false`, digits become a
number, and anything else stays a string.

```bash
TYPESUGAR_CONTRACTS_MODE=none typesugar build
TYPESUGAR_DEBUG=1 typesugar build
```

Other variables typesugar reads:

| Variable                                  | Effect                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| `TYPESUGAR_CFG_<NAME>`                    | Sets a `cfg()` condition (see [below](#conditional-compilation-cfg))                       |
| `TYPESUGAR_PROFILE=1`                     | Print timing reports                                                                       |
| `TYPESUGAR_SHOW_SUPPRESSED_DIAGNOSTICS=1` | Show diagnostics hidden by the suppression rules (same as `--show-suppressed-diagnostics`) |
| `TYPESUGAR_VERBOSE=1`                     | Verbose logging from the TypeScript language-service plugin                                |
| `TYPESUGAR_COMPTIME_IN_EDITOR=1`          | Evaluate `comptime(...)` inside the editor (off by default)                                |

## tsconfig.json

### Transformer Plugin

Used by a ts-patched `tsc`. The typesugar CLI (`typesugar build`, `check`, `run`) and the
bundler plugins don't read this entry's options: pass options to the bundler plugin, and
for the CLI set `cfg()` conditions with `TYPESUGAR_CFG_*` variables (see
[Conditional Compilation](#conditional-compilation-cfg)).

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "transform": "@typesugar/transformer",
        "type": "program",
        "verbose": false,
        "cfgConfig": { "debug": true }
      }
    ]
  }
}
```

**Options:**

| Option      | Type                      | Default              | Description                                            |
| ----------- | ------------------------- | -------------------- | ------------------------------------------------------ |
| `transform` | string                    | —                    | Must be `"@typesugar/transformer"`                     |
| `type`      | string                    | `"program"`          | Plugin type (use `"program"`)                          |
| `verbose`   | boolean                   | `false`              | Enable verbose logging                                 |
| `cfgConfig` | `Record<string, unknown>` | `{}`                 | Conditions for `cfg()` / `@cfgAttr`                    |
| `cacheDir`  | string \| `false`         | `".typesugar-cache"` | Directory for the expansion cache; `false` disables it |

Macro packages are not listed here: they are found through the `typesugar.macros`
field in each package's `package.json`.

### Language Service Plugin

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@typesugar/transformer/language-service"
      }
    ]
  }
}
```

Makes the editor's TypeScript server see expanded code, so valid macro code doesn't
show false errors. It is typesugar's editor engine for every tsserver-based editor (see
[Editor Setup](../getting-started/editor-setup.md)); install `@typesugar/transformer` as a direct
devDependency so the server can find it. Its only option is `"verbose": true` (or
`TYPESUGAR_VERBOSE=1`).

## Bundler Plugins (unplugin-typesugar)

The same options apply to every bundler entry point (`unplugin-typesugar/vite`,
`/esbuild`, `/webpack`, `/rollup`):

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import typesugar from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [
    typesugar({
      tsconfig: "./tsconfig.json",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["**/*.d.ts"],
      verbose: false,
      diskCache: false,
      strict: false,
      cfgConfig: { debug: process.env.NODE_ENV !== "production" },
    }),
  ],
});
```

**Options:**

| Option      | Type                                          | Default        | Description                                                                                                                           |
| ----------- | --------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `tsconfig`  | string                                        | auto-detected  | Path to tsconfig.json (searched upward from the working directory)                                                                    |
| `include`   | `RegExp \| string \| Array<RegExp \| string>` | `/\.[jt]sx?$/` | Files to transform (see matching rules below)                                                                                         |
| `exclude`   | same as `include`                             | none           | Files to skip                                                                                                                         |
| `verbose`   | boolean                                       | `false`        | Enable verbose logging                                                                                                                |
| `diskCache` | boolean \| string                             | `false`        | Disk-backed transform cache; a string sets its directory                                                                              |
| `strict`    | boolean \| `"incremental"`                    | `false`        | Type-check the expanded output at build end and fail the build on errors (experimental). `"incremental"` re-checks only changed files |
| `cfgConfig` | `Record<string, unknown>`                     | `{}`           | Conditions for `cfg()` / `@cfgAttr`                                                                                                   |

**How `include` / `exclude` match:**

- Strings are globs (picomatch syntax) matched against the absolute module path. A
  relative glob such as `"src/**/*.ts"` is resolved against the project root (Vite's
  `root`, otherwise the working directory). A glob starting with `**` matches anywhere.
- RegExps are tested against the module path.
- Files under `node_modules` are always skipped, even when you pass your own
  `exclude`, unless an `include` pattern names `node_modules`.
- `include: []` transforms nothing.

**Webpack** (CommonJS config) needs `.default`:

```javascript
// webpack.config.js
const typesugar = require("unplugin-typesugar/webpack").default;

module.exports = {
  plugins: [typesugar({ include: ["src/**/*.ts"] })],
};
```

**esbuild:**

```typescript
import { build } from "esbuild";
import typesugar from "unplugin-typesugar/esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outdir: "dist",
  plugins: [typesugar()],
});
```

**Rollup:**

```javascript
// rollup.config.js
import typesugar from "unplugin-typesugar/rollup";

export default {
  plugins: [typesugar()],
};
```

**Type-checking:** bundlers don't type-check. Run `typesugar check` in CI (not
`tsc --noEmit`, which never runs the macros), or set `strict: true`.

## Conditional Compilation (`cfg`)

`cfg()` and `@cfgAttr` read their conditions from one of two sources:

- the `cfgConfig` option — of the bundler plugin, or of the tsconfig transformer
  entry under a ts-patched `tsc` (the typesugar CLI doesn't read it). When it is
  set, it **replaces** the environment variables below; they are not merged.
- otherwise, `TYPESUGAR_CFG_<NAME>` environment variables — `TYPESUGAR_CFG_DEBUG=1`
  sets `debug: true`; `__` nests (`TYPESUGAR_CFG_TARGET__PLATFORM=web` sets
  `target.platform`)

```typescript
typesugar({
  cfgConfig: {
    debug: process.env.NODE_ENV === "development",
    platform: "web",
    feature: { experimental: false, analytics: true },
  },
});
```

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "transform": "@typesugar/transformer",
        "type": "program",
        "cfgConfig": { "debug": true, "production": false }
      }
    ]
  }
}
```

## ESLint Plugin

Flat config only (ESLint 9 or later):

```javascript
// eslint.config.js
import typesugar from "@typesugar/eslint-plugin";

export default [
  // Recommended: lightweight processor
  typesugar.configs.recommended,

  // Or: full transformer (slower, more accurate)
  // typesugar.configs.full,

  // Or: strict mode
  // typesugar.configs.strict,
];
```

Each `configs.*` entry is a single config object, so it goes in the array as is (not
spread with `...`).

## VSCode Extension

The extension's language features come from the language service plugin above (it bundles and
registers it), so it has one setting, in `.vscode/settings.json` or user settings:

```json
{
  "typesugar.comptimeInEditor": false
}
```

| Setting            | Type    | Default | Description                                                                                                                         |
| ------------------ | ------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `comptimeInEditor` | boolean | `false` | Evaluate `comptime(...)` in the editor (trusted workspaces only). Sent to the plugin by the extension; `tsconfig.json` can't set it |

## ts-patch

Only needed if you want a plain `tsc` to expand macros, as an alternative to
`typesugar build` (see [tsc Setup](../getting-started/environments/tsc.md#alternative-a-ts-patched-tsc)).

### Installation

```bash
npx ts-patch install
```

### Persistence

Add to package.json:

```json
{
  "scripts": {
    "prepare": "ts-patch install -s"
  }
}
```

### Verification

```bash
npx ts-patch check
```

## Jest

There is no working ts-jest integration: ts-jest's `astTransformers` need a module
that exports `name`, `version` and `factory`, and `@typesugar/transformer` doesn't
provide one. Use [Vitest](../getting-started/environments/vitest.md) with
`unplugin-typesugar/vite` for tests. See the [Jest page](../getting-started/environments/jest.md).

## Comptime

`comptime()` evaluation has a fixed 5-second timeout; it isn't configurable.
File-system and environment access are off unless the block asks for them, e.g.
`comptime({ fs: "read" }, () => …)`. See the [comptime guide](../guides/comptime.md).

## Environment Detection

`typesugar init` and `typesugar doctor` auto-detect:

- **Package manager**: npm, pnpm, yarn, bun (from lock files)
- **Bundler**: Vite, Webpack, esbuild, Rollup, Next.js (from dependencies)
- **TypeScript**: From node_modules

Use `typesugar doctor` to verify detection.
