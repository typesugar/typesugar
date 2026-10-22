# CLI Reference

The `typesugar` CLI compiles TypeScript with macro expansion.

## Installation

The CLI is included with `@typesugar/transformer`:

```bash
npm install --save-dev @typesugar/transformer
```

Run with:

```bash
npx typesugar <command> [options]
```

## Commands

### build

Compile TypeScript with macro expansion.

```bash
typesugar build [options]
```

**Options:**

- `-p, --project <path>` — Path to tsconfig.json (default: tsconfig.json)
- `-v, --verbose` — Enable verbose logging
- `--cache [dir]` — Enable disk cache for faster rebuilds (default: `.typesugar-cache/transforms`)
- `--no-cache` — Disable disk cache
- `--strict` — Also type-check all of the expanded output: the code the build emits, as a
  program of its own. An error is reported at the line you wrote when the expansion
  came from it, and otherwise (code a macro generated) at its position in the expanded
  code (`typesugar expand <file>` shows it); one the source already reports is not
  repeated. Experimental, off by default. Without it, `build` type-checks the expansion
  only of the constructs whose bound names the source can't check (see `check` below).
- `--strict=incremental` — Like `--strict`, but only re-checks changed files
- `--show-suppressed-diagnostics` — Also print the diagnostics typesugar's
  suppression rules filtered out (audit mode)
- `--emitDeclarationOnly` — Write only `.d.ts` files. Use it after a bundler (tsup,
  esbuild, Vite) has built the JavaScript.
- `--declarationDir <dir>` — Directory for the `.d.ts` files, overriding the tsconfig.
  `--emitDeclarationOnly` needs this, `declarationDir` or `outDir`.

`build` emits `.js`/`.d.ts` and exits non-zero if any diagnostics (including macro
errors) are found.

The `.d.ts` files are emitted from the **expanded** program, so they describe what the
macros produce: an exported `function area(s: Shape) { return match(s)… }` is declared
`area(s: Shape): number`, and the declarations import nothing from typesugar. (Plain `tsc`
and tsup's own `dts` step see the unexpanded source instead.) Declaration-emit errors are
reported against the expanded code. `noEmitOnError` is decided on the same diagnostics
`build` reports.

**Examples:**

```bash
# Build with default config
typesugar build

# Build with custom config
typesugar build --project tsconfig.build.json

# Build with verbose output
typesugar build --verbose

# Build with disk cache (faster incremental builds)
typesugar build --cache

# Build with strict mode (typecheck expanded output)
typesugar build --strict

# Only the .d.ts files, into types/
typesugar build --emitDeclarationOnly --declarationDir types
```

### watch

Watch mode — recompile on file changes.

```bash
typesugar watch [options]
```

**Options:**

- `-p, --project <path>` — Path to tsconfig.json
- `-v, --verbose` — Enable verbose logging
- `--show-suppressed-diagnostics` — Show suppressed diagnostics (audit mode)

**Examples:**

```bash
# Watch with default config
typesugar watch

# Watch with verbose output
typesugar watch --verbose
```

Each rebuild reports what `check` would, at the positions as written, and ends with
`Found N errors. Watching for file changes.`, where N counts the errors it printed: macro errors
included, diagnostics the suppression rules hid left out. That includes the type check of the
expansion of the constructs whose bound names the source can't check (see `check` below), so
`user.nme` in a comprehension is reported on every rebuild, as `check` reports it. `--strict` has
no effect in watch.

### check

Type-check with macro expansion, but don't emit files. **Exits non-zero on
diagnostics — use this as your CI gate.**

```bash
typesugar check [options]
```

**Options:**

- `-p, --project <path>` — Path to tsconfig.json
- `-v, --verbose` — Enable verbose logging
- `--strict` / `--strict=incremental` — Also type-check all of the expanded output (see
  `build`). Experimental and off by default; an addition to plain `check`, not a
  substitute for it.
- `--show-suppressed-diagnostics` — Show suppressed diagnostics (audit mode)

> **`check` vs `build`:** `check` type-checks and emits nothing; `build` emits to
> your `outDir`. Both report the same diagnostics (after typesugar's diagnostic
> suppression filtering removes the phantom errors valid pre-expansion source
> produces) and both exit non-zero when errors are found — so a green `build` means
> "compiled, no errors detected." Where the filter hides the names a construct binds (a
> do-notation comprehension's steps, a fluent `match()` or `match:` case's pattern, an
> `ensures:` block's `result`), their uses can't be checked as written: `check` and `build` type-check that
> construct's expansion and report what is wrong inside it at the line you wrote
> (`fetchAge(user.nme)` in a comprehension). Use `typesugar check`, not `tsc --noEmit`, as the
> CI type-check: `tsc --noEmit` never runs the transformer, so it type-checks the
> unexpanded source.
>
> `typesugar doctor` warns when `skipLibCheck` is off, because some typesugar
> package declarations (e.g. `@typesugar/fp`) may produce errors without it.

**Examples:**

```bash
# Type-check only
typesugar check

# Type-check with custom config
typesugar check -p tsconfig.check.json

# Also type-check the expanded output (experimental)
typesugar check --strict
```

### expand

Show macro-expanded output for a file. Similar to Rust's `cargo expand`.

```bash
typesugar expand <file> [options]
```

**Arguments:**

- `<file>` — Source file to expand (required)

**Options:**

- `-p, --project <path>` — Path to tsconfig.json
- `--diff` — Show unified diff between original and expanded
- `--ast` — Show expanded AST as JSON
- `--js` — Show the transpiled JavaScript instead of expanded TypeScript
- `-v, --verbose` — Enable verbose logging

**Examples:**

```bash
# Show expanded code
typesugar expand src/main.ts

# Show diff
typesugar expand src/main.ts --diff

# Show AST
typesugar expand src/main.ts --ast

# Show the JavaScript that would run
typesugar expand src/main.ts --js
```

### run

Compile and execute a file with macro expansion. Like `ts-node` but with macros.

```bash
typesugar run <file> [options]
```

**Arguments:**

- `<file>` — Source file to run (required)

**Options:**

- `-p, --project <path>` — Path to tsconfig.json
- `-v, --verbose` — Enable verbose logging
- `--cache [dir]` — Enable disk cache (useful when iterating on a script)

If any macro fails to expand, `run` prints the errors and exits 1 without
executing the file. Otherwise its exit code is the script's own exit code
(`128 + n` if the script is killed by signal `n`).

**Examples:**

```bash
# Run a script
typesugar run examples/showcase.ts

# Run with caching (faster repeated runs)
typesugar run examples/showcase.ts --cache

# Run with verbose output
typesugar run src/script.ts --verbose
```

To run TypeScript through Node itself (tsx, `node --test`, tape, benchmarks, several
entry points, other Node flags), use the module hooks instead:
`node --import typesugar/register src/main.ts`. See
[Node.js, tsx and node:test](/getting-started/environments/node).

### preprocess

Preprocess files for HKT syntax only (`F<A>` → `Kind<F, A>`), with no macro expansion. Useful for debugging.

```bash
typesugar preprocess <files|dirs> [options]
```

**Arguments:**

- `<files|dirs>` — Files or directories to preprocess

**Options:**

- `--outDir <dir>`, `-o <dir>` — Output directory (default: `.typesugar`)
- `--inPlace` — Preprocess files in place (overwrites originals; can't be combined with `--outDir`)
- `-v, --verbose` — Enable verbose logging

**Examples:**

```bash
# Preprocess to .typesugar directory
typesugar preprocess src/

# Preprocess a single file
typesugar preprocess src/main.ts

# Preprocess in place (careful!)
typesugar preprocess src/ --inPlace

# Custom output directory
typesugar preprocess src/ --outDir preprocessed/
```

### init

Interactive project scaffolder.

```bash
typesugar init [options]
```

**Options:**

- `-y, --yes` — Non-interactive: accept the default for every question (required in
  CI, or when an AI assistant runs `init`)
- `--persona <name>` — `end-user`, `app-developer` or `extension-author` (default
  with `--yes`: `app-developer`)
- `--ai` — Write AI-assistant context (`AGENTS.md`) without asking, and install the
  Claude Code skill
- `--no-ai` — Skip AI-assistant context entirely
- `-v, --verbose` — Enable verbose logging

**What it does:**

1. Detects your stack (Vite, Webpack, Next.js, etc.)
2. Installs required packages
3. Configures tsconfig.json
4. Patches build configs
5. Installs ts-patch and adds a `prepare` script for it (only needed if you build with a
   patched `tsc`; `typesugar build` and the bundler plugins don't use it)
6. Writes an example file (`src/typesugar-example.ts`)

**Examples:**

```bash
# Interactive setup
typesugar init

# Non-interactive (CI / AI agent)
typesugar init --yes
typesugar init --yes --persona end-user --ai
```

### create

Create a new project from a template.

```bash
typesugar create <template> [name] [options]
```

**Arguments:**

- `<template>` — Template to use (app, library, or macro-plugin)
- `[name]` — Project name (defaults to `my-<template>`)

**Available Templates:**

| Template       | Description                                     |
| -------------- | ----------------------------------------------- |
| `app`          | Vite application with comptime, derive, and sql |
| `library`      | Publishable library with typeclasses            |
| `macro-plugin` | Custom macros package                           |

**Examples:**

```bash
# Create an app project
typesugar create app my-app

# Create a library project
typesugar create library my-lib

# Create a macro plugin
typesugar create macro-plugin my-macros

# Interactive mode (prompts for template and name)
typesugar create
```

**What it does:**

1. Copies template files to new directory
2. Updates package.json with project name
3. Provides next steps instructions

### doctor

Diagnose configuration issues.

```bash
typesugar doctor [options]
```

**Options:**

- `-v, --verbose` — Enable verbose logging (includes macro expansion test)

**Checks performed:**

- package.json exists
- TypeScript installed and in the supported range `>=5.9.0 <7.0.0` (fails on TypeScript 7, warns below 5.9)
- tsconfig.json exists
- Language service plugin configured
- Transformer plugin configured, ts-patch installed, ts-patch active (TypeScript patched) and
  prepare script configured: only for a project that compiles through a patched `tsc`
  (ts-patch installed, or the tsconfig `transform` plugin with a `tsc`/`tspc` script). A
  project that builds with `typesugar build`, runs under `node --import typesugar/register`
  or uses a bundler plugin shows them as skipped.
- `@typesugar/transformer` installed
- `skipLibCheck` enabled (warning only)
- Macro registration
- unplugin installed (for bundlers)
- Package version consistency

`doctor` exits 1 if any check fails; warnings alone exit 0.

**Examples:**

```bash
# Run diagnostics
typesugar doctor

# Verbose diagnostics
typesugar doctor --verbose
```

**Output:**

```
✓ package.json exists
✓ TypeScript installed
✓ tsconfig.json exists
✓ Transformer plugin configured
✓ Language service plugin configured
✓ ts-patch installed
✓ ts-patch active
✓ prepare script configured
○ unplugin-typesugar (for bundlers) - skipped: No bundler detected
✓ Package version consistency

All checks passed!
typesugar is properly configured and ready to use.
```

### approve-macros

Review and approve third-party macro packages (PEP-055).

```bash
typesugar approve-macros [options]
```

Packages under `@typesugar/*` (and `typesugar`) are trusted automatically. Any other
package that declares a `typesugar.macros` entry in its `package.json` is refused,
and the build fails with "…have not been approved. Run `typesugar approve-macros`…",
until it is listed in `security.allowedMacroPackages` of your
[`typesugar.config.ts`](./config.md#typesugar-config-ts). This command scans the
project the same way the macro loader does, lists the unapproved packages, and after
confirmation writes them into that list. It creates `typesugar.config.ts` if there is
none, and otherwise edits only the `allowedMacroPackages` value, leaving the rest of
the file as you wrote it. Commit the file.

It uses exactly the build's discovery, so it lists everything the build would refuse:
dependencies (packages inside `node_modules`) that declare macros, reached by a bare import
or by a relative path into `node_modules`, each resolved from the importing file as Node
resolves it. Macro packages reached by a relative path outside `node_modules` (a vendored
directory, a workspace sibling imported by path) are project code: they load without
approval and are never listed (see
[What typesugar trusts](../SECURITY.md#what-typesugar-trusts)).

**Options:**

- `-p, --project <path>` — Path to tsconfig.json (default: tsconfig.json). The config
  file is read from, and written next to, that directory.
- `-y, --yes` — Skip the confirmation prompt (for CI use)
- `-v, --verbose` — Enable verbose logging

**Examples:**

```bash
typesugar approve-macros
typesugar approve-macros --yes
```

## Exit Codes

| Command          | Exit code                                                                     |
| ---------------- | ----------------------------------------------------------------------------- |
| `build`, `check` | 0 on success; 1 on any diagnostic or macro error                              |
| `run`            | 1 on macro errors (the file is not run); otherwise the script's own exit code |
| `doctor`         | 0 if every check passes or only warns; 1 if any check fails                   |
| any command      | 1 on an unknown command, unapproved macro packages, or a crash                |

## Environment Variables

**typesugar-specific:**

- `TYPESUGAR_PROFILE=1` — Enable detailed performance profiling (outputs timing reports)
- `TYPESUGAR_SHOW_SUPPRESSED_DIAGNOSTICS=1` — Same as `--show-suppressed-diagnostics`
- `TYPESUGAR_CFG_<NAME>` — Set a `cfg()` condition value (see [Configuration](./config.md#conditional-compilation-cfg))
- `TYPESUGAR_<KEY>` — Override a `typesugar.config.ts` value (see [Configuration](./config.md#environment-variables))

**TypeScript standard:**

- `TSC_NONPOLLING_WATCHER` — Use non-polling file watcher
- `TSC_WATCHFILE` — File watching strategy
- `TSC_WATCHDIRECTORY` — Directory watching strategy

## Integration with npm Scripts

```json
{
  "scripts": {
    "build": "typesugar build --cache",
    "build:prod": "typesugar build -p tsconfig.prod.json",
    "watch": "typesugar watch",
    "check": "typesugar check",
    "expand": "typesugar expand"
  }
}
```

## Comparison with tsc

| Feature                      | typesugar CLI    | tsc                 |
| ---------------------------- | ---------------- | ------------------- |
| Macro expansion              | Yes              | No (needs ts-patch) |
| Watch mode                   | Yes              | Yes                 |
| Project references (`-b`)    | No               | Yes                 |
| Incremental (`.tsbuildinfo`) | No               | Yes                 |
| Expand preview               | Yes (`expand`)   | No                  |
| Diagnostics                  | Yes (`doctor`)   | No                  |
| Disk caching                 | Yes (`--cache`)  | No                  |
| Strict mode (expanded code)  | Yes (`--strict`) | No                  |
| Run scripts directly         | Yes (`run`)      | No                  |

## Troubleshooting

### "Transform not found"

```bash
typesugar doctor
# Then follow the suggested fixes
```

### Slow builds

1. Enable disk cache:

```bash
typesugar build --cache
```

The CLI builds the whole program each time (no project references, `--build` mode
or `.tsbuildinfo`), so tsconfig's `incremental` setting has no effect on it.

2. For detailed profiling:

```bash
TYPESUGAR_PROFILE=1 typesugar build --cache
```

See [Performance Architecture](../PERFORMANCE.md) for more optimization tips.

### Watch not detecting changes

Try different watcher:

```bash
TSC_WATCHFILE=UseFsEvents typesugar watch
```
