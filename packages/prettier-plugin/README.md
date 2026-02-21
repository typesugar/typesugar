# @typesugar/prettier-plugin

Prettier plugin for typesugar custom syntax (`|>`, `::`, `F<_>`).

## Installation

```bash
npm install --save-dev @typesugar/prettier-plugin
```

## Quick Start

Add the plugin to your Prettier configuration:

```json
{
  "plugins": ["@typesugar/prettier-plugin"]
}
```

That's it — Prettier will now handle typesugar files without crashing on custom syntax.

## Two Layers of Formatting

### Layer 1: Plugin (Don't Crash)

The Prettier plugin preprocesses custom syntax before Prettier parses it. This prevents parse errors on `|>`, `::`, and `F<_>` syntax. The formatted output is valid TypeScript but contains preprocessor artifacts (`__binop__`, `$<F, A>`).

Use this when you just need Prettier to work — e.g., in CI format checks or editor integration.

```json
{
  "plugins": ["@typesugar/prettier-plugin"]
}
```

### Layer 2: Full Round-Trip Format (Preserve Custom Syntax)

The `format()` function does a complete round-trip: custom syntax is preprocessed, Prettier formats the valid TypeScript, then custom syntax is restored.

```typescript
import { format } from "@typesugar/prettier-plugin";

const source = `const x = data |> filter(pred) |> map(fn);`;
const formatted = await format(source, { filepath: "example.ts" });
// formatted: `const x = data |> filter(pred) |> map(fn);` (properly formatted)
```

The pipeline:

1. **preFormat** — Converts `|>` to `__binop__()`, `F<_>` to `$<F, A>`, etc.
2. **prettier.format** — Formats the valid TypeScript
3. **postFormat** — Restores `__binop__()` back to `|>`, `$<F, A>` back to `F<A>`, etc.

## CLI

A standalone formatter CLI is included:

```bash
# Format files in place
typesugar-fmt src/**/*.ts

# Check formatting (CI mode — exits 1 if any file needs formatting)
typesugar-fmt --check src/**/*.ts
```

### CLI Options

| Option    | Description                               |
| --------- | ----------------------------------------- |
| `--write` | Write formatted output to files (default) |
| `--check` | Check if files are formatted              |
| `--help`  | Show help message                         |

Supported extensions: `.ts`, `.tsx`, `.mts`, `.cts`

## Plugin Options

The plugin adds one custom option to Prettier:

| Option          | Type    | Default | Description                  |
| --------------- | ------- | ------- | ---------------------------- |
| `typesugarSkip` | boolean | `false` | Skip typesugar preprocessing |

```json
{
  "plugins": ["@typesugar/prettier-plugin"],
  "typesugarSkip": false
}
```

## Programmatic API

### `format(source, options?)`

Full round-trip formatting with custom syntax preservation.

```typescript
import { format } from "@typesugar/prettier-plugin";

const formatted = await format(source, {
  filepath: "example.ts",
  prettierOptions: { printWidth: 100 },
});
```

### `check(source, options?)`

Check if a file would change when formatted. Returns `true` if formatting is needed.

```typescript
import { check } from "@typesugar/prettier-plugin";

const needsFormat = await check(source, { filepath: "example.ts" });
```

### `preFormat(source, options?)`

Convert custom syntax to valid TypeScript (step 1 only). Returns the processed code and metadata needed by `postFormat`.

```typescript
import { preFormat } from "@typesugar/prettier-plugin";

const { code, changed, metadata } = preFormat(source, { fileName: "example.ts" });
```

### `postFormat(formatted, metadata)`

Restore custom syntax from preprocessed TypeScript (step 3 only). Requires the metadata from `preFormat`.

```typescript
import { postFormat } from "@typesugar/prettier-plugin";

const restored = postFormat(formattedCode, metadata);
```

### `getFormatMetadata(source, options?)`

Get format metadata without actually formatting. Useful for debugging.

```typescript
import { getFormatMetadata } from "@typesugar/prettier-plugin";

const metadata = getFormatMetadata(source, { filepath: "example.ts" });
```

## Integration with Other Packages

- **@typesugar/preprocessor** — The plugin uses the preprocessor internally for syntax transformations
- **@typesugar/eslint-plugin** — The ESLint plugin handles linting; this plugin handles formatting
- **@typesugar/vscode** — The VS Code extension integrates both formatting and linting

## How It Works

typesugar introduces syntax that isn't valid TypeScript (`|>`, `::`, `F<_>`). Prettier's TypeScript parser chokes on these. This plugin intercepts parsing via a custom parser that preprocesses the source first.

The custom parser (`typesugar-ts`) extends Prettier's built-in TypeScript parser with a `preprocess` step that runs the typesugar preprocessor. Prettier sees valid TypeScript and formats it normally.

For the full round-trip `format()` function, a third step reverses the preprocessing using AST analysis to find `__binop__()` calls and `$<F, A>` type references, then replaces them with the original custom syntax.

## API Quick Reference

| Export              | Type     | Description                                |
| ------------------- | -------- | ------------------------------------------ |
| `plugin`            | Plugin   | Prettier plugin (default export)           |
| `format`            | Function | Full round-trip format                     |
| `check`             | Function | Check if formatting needed                 |
| `preFormat`         | Function | Custom syntax → valid TS                   |
| `postFormat`        | Function | Valid TS → custom syntax                   |
| `getFormatMetadata` | Function | Inspect transformations without formatting |
| `FormatOptions`     | Type     | Options for format/check                   |
| `PreFormatOptions`  | Type     | Options for preFormat                      |
| `FormatMetadata`    | Type     | Metadata from preFormat                    |
| `HKTParamInfo`      | Type     | HKT parameter scope info                   |

## License

MIT
