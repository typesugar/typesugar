# @typesugar/eslint-plugin

> 📖 **Full documentation:** [Package reference](https://typesugar.org/reference/packages). The microsite is the canonical reference; this README is a quickstart.

ESLint plugin that runs the typesugar macro transformer before linting.

This allows ESLint to see the expanded code, eliminating false positives from macro syntax like undefined identifiers in `@derive(Eq, Clone)`.

## Installation

```bash
npm install @typesugar/eslint-plugin --save-dev
```

## Usage

### Flat Config (ESLint 9+)

In your `eslint.config.mjs`:

```javascript
import typesugarPlugin from "@typesugar/eslint-plugin";

export default [
  typesugarPlugin.configs.recommended,
  // ... your other configs
];
```

### Full Transformation Mode

For more accurate linting with full macro expansion (slower):

```javascript
import { fullConfig } from "@typesugar/eslint-plugin";

export default [
  fullConfig,
  // ... your other configs
];
```

## Configurations

### `recommended`

Lightweight pattern-based processing. Fast but may miss some macro expansions.

- Processes all `.ts` and `.tsx` files
- Disables rules that conflict with macro syntax (`no-unused-labels`, `no-labels`)

### `full`

Uses the actual typesugar transformer for complete accuracy.

- Slower due to full TypeScript compilation
- Most accurate - sees exactly what TypeScript sees after transformation

### `strict`

Extends `recommended` with additional checks.

## How It Works

The plugin provides ESLint processors that transform your code before linting:

1. **Lightweight mode**: Pattern-based substitutions for common macro syntax
2. **Full mode**: Runs the complete typesugar transformer pipeline

This prevents false positives like:

- "Eq is not defined" from `@derive(Eq, Clone)`
- "Label 'requires' is unused" from contract blocks
- Type errors from un-expanded macro calls

## API

### `clearTransformCache()`

Clears the transformation cache. Useful in watch mode when you need to force re-transformation.

```javascript
import { clearTransformCache } from "@typesugar/eslint-plugin";

clearTransformCache();
```

## License

MIT
