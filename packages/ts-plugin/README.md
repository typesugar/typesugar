# @typesugar/ts-plugin

> 📖 **Full documentation:** [Editor Setup](https://typesugar.org/getting-started/editor-setup). The microsite is the canonical reference; this README is a quickstart.

TypeScript Language Service Plugin for typesugar that enables full IDE support including:

- **Type-aware transformation** — Macros, and higher-kinded type references (`F<A>` where `F` is a type parameter, rewritten to `Kind<F, A>`), are transformed before TypeScript processes the code
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
        "verbose": false
      }
    ]
  }
}
```

### Options

| Option    | Type      | Default | Description                          |
| --------- | --------- | ------- | ------------------------------------ |
| `verbose` | `boolean` | `false` | Enable verbose logging for debugging |

`verbose` is the only option. Setting the environment variable `TYPESUGAR_VERBOSE=1` for
the TypeScript server has the same effect.

Operator syntax such as `a |> f` or `x :: xs` is not supported: TypeScript has no such
operators, and the plugin does not add them. Use `pipe(a, f)` from `typesugar` instead.

## VS Code Integration

The typesugar VS Code extension uses this plugin. It also provides commands for debugging:

- **typesugar: Show Transformed Source** — View the transformed code in a diff view
- **typesugar: Expand Macro at Cursor**

## Debugging

If you encounter issues:

1. Enable verbose logging to see plugin activity
2. Use "Show Transformed Source" to see what TypeScript is actually processing
3. Check the TypeScript server log for errors (VS Code: "TypeScript: Open TS Server Log")

## Architecture

This plugin uses a transform-first architecture:

1. **Preprocessing** — Higher-kinded `F<A>` references are rewritten to valid TypeScript
2. **Macro expansion** — Macros (`@derive`, `comptime`, etc.) are expanded
3. **Source mapping** — A source map tracks the transformation
4. **Position mapping** — IDE features map positions back to original source

The same transformation pipeline is used by:

- Build tools (via `unplugin-typesugar`)
- CLI (via `@typesugar/transformer`)
- This language service plugin

This ensures consistent behavior across all tools.
