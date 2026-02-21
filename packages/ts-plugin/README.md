# @typesugar/ts-plugin

TypeScript Language Service Plugin for typesugar that enables full IDE support including:

- **Type-aware transformation** — Custom syntax (`|>`, `::`, `F<_>`) and macros are transformed before TypeScript processes the code
- **Accurate diagnostics** — Error positions map back to your original source
- **Go-to-definition** — Navigate to original source locations, not transformed code
- **Completions** — IntelliSense works on both original and generated code
- **Hover info** — See type information for original symbols
- **Find references** — Find all references to symbols across transformed code

## Installation

```bash
npm install @typesugar/ts-plugin --save-dev
# or
pnpm add -D @typesugar/ts-plugin
```

## Configuration

Add the plugin to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@typesugar/ts-plugin",
        "verbose": false,
        "extensions": ["hkt", "pipeline", "cons"]
      }
    ]
  }
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `verbose` | `boolean` | `false` | Enable verbose logging for debugging |
| `extensions` | `string[]` | `["hkt", "pipeline", "cons"]` | Syntax extensions to enable |
| `legacyMode` | `boolean` | `false` | Use legacy error-suppression mode instead of full transformation |

### Extensions

- `hkt` — Higher-kinded type syntax (`F<_>` → `$<F, A>`)
- `pipeline` — Pipe operator (`a |> f` → `f(a)`)
- `cons` — Cons operator (`x :: xs` → `cons(x, xs)`)

## Legacy Mode

If you encounter issues with the transform-first approach, you can fall back to legacy mode which simply suppresses errors for typesugar syntax:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@typesugar/ts-plugin",
        "legacyMode": true
      }
    ]
  }
}
```

Legacy mode is less accurate but more stable. It's recommended as a fallback if you experience problems with the default mode.

## VS Code Integration

When using the typesugar VS Code extension, you can configure the plugin via VS Code settings:

```json
{
  "typesugar.useLegacyPlugin": false,
  "typesugar.enableVerboseLogging": false
}
```

The extension also provides commands for debugging:

- **typesugar: Show Transformed Source** — View the transformed code in a diff view

## Debugging

If you encounter issues:

1. Enable verbose logging to see plugin activity
2. Use "Show Transformed Source" to see what TypeScript is actually processing
3. Check the TypeScript server log for errors (VS Code: "TypeScript: Open TS Server Log")
4. Try legacy mode if the transform-first approach causes problems

## Architecture

This plugin uses a transform-first architecture:

1. **Preprocessing** — Custom syntax is converted to valid TypeScript
2. **Macro expansion** — Macros (`@derive`, `comptime`, etc.) are expanded
3. **Source mapping** — A source map tracks the transformation
4. **Position mapping** — IDE features map positions back to original source

The same transformation pipeline is used by:
- Build tools (via `unplugin-typesugar`)
- CLI (via `@typesugar/transformer`)
- This language service plugin

This ensures consistent behavior across all tools.
