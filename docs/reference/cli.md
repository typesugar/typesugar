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
- `--strict` — Typecheck expanded output (catches macro bugs)

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
```

### watch

Watch mode — recompile on file changes.

```bash
typesugar watch [options]
```

**Options:**

- `-p, --project <path>` — Path to tsconfig.json
- `-v, --verbose` — Enable verbose logging

**Examples:**

```bash
# Watch with default config
typesugar watch

# Watch with verbose output
typesugar watch --verbose
```

### check

Type-check with macro expansion, but don't emit files.

```bash
typesugar check [options]
```

**Options:**

- `-p, --project <path>` — Path to tsconfig.json
- `-v, --verbose` — Enable verbose logging
- `--strict` — Typecheck expanded output (catches macro bugs)

**Examples:**

```bash
# Type-check only
typesugar check

# Type-check with custom config
typesugar check -p tsconfig.check.json

# Type-check expanded output (catches macro-generated bugs)
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
- `-v, --verbose` — Enable verbose logging

**Examples:**

```bash
# Show expanded code
typesugar expand src/main.ts

# Show diff
typesugar expand src/main.ts --diff

# Show AST
typesugar expand src/main.ts --ast
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

**Examples:**

```bash
# Run a script
typesugar run examples/showcase.ts

# Run with caching (faster repeated runs)
typesugar run examples/showcase.ts --cache

# Run with verbose output
typesugar run src/script.ts --verbose
```

### preprocess

Preprocess files with custom syntax only (no macro expansion). Useful for debugging or generating valid TypeScript from typesugar syntax.

```bash
typesugar preprocess <files|dirs> [options]
```

**Arguments:**

- `<files|dirs>` — Files or directories to preprocess

**Options:**

- `--outDir <dir>` — Output directory (default: `.typesugar`)
- `--inPlace` — Preprocess files in place (overwrites originals)
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

- `-v, --verbose` — Enable verbose logging

**What it does:**

1. Detects your stack (Vite, Webpack, Next.js, etc.)
2. Installs required packages
3. Configures tsconfig.json
4. Patches build configs
5. Sets up ts-patch

**Examples:**

```bash
# Interactive setup
typesugar init

# Verbose output
typesugar init --verbose
```

### create

Create a new project from a template.

```bash
typesugar create <template> [name] [options]
```

**Arguments:**

- `<template>` — Template to use (app, library, or macro-plugin)
- `[name]` — Project name (defaults to `my-<template>`)

**Options:**

- `-v, --verbose` — Enable verbose logging

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
- TypeScript installed (version >= 5.0)
- tsconfig.json exists
- Transformer plugin configured
- Language service plugin configured
- ts-patch installed
- ts-patch active (TypeScript patched)
- prepare script configured
- unplugin installed (for bundlers)
- Package version consistency

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

## Exit Codes

| Code | Meaning                                           |
| ---- | ------------------------------------------------- |
| 0    | Success                                           |
| 1    | Error (build failed, check failed, doctor issues) |

## Environment Variables

**typesugar-specific:**

- `TYPESUGAR_PROFILE=1` — Enable detailed performance profiling (outputs timing reports)

**TypeScript standard:**

- `TSC_NONPOLLING_WATCHER` — Use non-polling file watcher
- `TSC_WATCHFILE` — File watching strategy
- `TSC_WATCHDIRECTORY` — Directory watching strategy

## Integration with npm Scripts

```json
{
  "scripts": {
    "build": "typesugar build --cache",
    "build:prod": "typesugar build -p tsconfig.prod.json --strict",
    "watch": "typesugar watch",
    "check": "typesugar check --strict",
    "expand": "typesugar expand",
    "prepare": "ts-patch install -s"
  }
}
```

## Comparison with tsc

| Feature                     | typesugar CLI    | tsc                 |
| --------------------------- | ---------------- | ------------------- |
| Macro expansion             | Yes              | No (needs ts-patch) |
| Watch mode                  | Yes              | Yes                 |
| Project references          | Via tsconfig     | Yes                 |
| Incremental                 | Via tsconfig     | Yes                 |
| Expand preview              | Yes (`expand`)   | No                  |
| Diagnostics                 | Yes (`doctor`)   | No                  |
| Disk caching                | Yes (`--cache`)  | No                  |
| Strict mode (expanded code) | Yes (`--strict`) | No                  |
| Run scripts directly        | Yes (`run`)      | No                  |

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

2. Enable incremental builds in tsconfig.json:

```json
{
  "compilerOptions": {
    "incremental": true
  }
}
```

3. For detailed profiling:

```bash
TYPESUGAR_PROFILE=1 typesugar build --cache
```

See [Performance Architecture](../PERFORMANCE.md) for more optimization tips.

### Watch not detecting changes

Try different watcher:

```bash
TSC_WATCHFILE=UseFsEvents typesugar watch
```
