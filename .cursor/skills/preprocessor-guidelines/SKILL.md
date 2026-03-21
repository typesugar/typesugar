---
name: preprocessor-guidelines
description: Guidelines for working on the typesugar preprocessor. Covers custom operator handling, scanner file type, text-level rewriting rules, source maps, language service plugin, and unplugin limitations. Use when modifying the preprocessor, working with custom syntax (HKT, pipeline, cons operators), source maps, or the scanner.
---

# Preprocessor Guidelines

Source: `packages/preprocessor/`

The preprocessor handles custom syntax (`F<_>` HKT, `|>` pipeline, `::` cons) that TypeScript cannot parse. It runs **before** the AST exists, doing text-level rewriting so tools like esbuild/vitest can parse the output.

## Custom Operators

The preprocessor handles **non-JS operators** via text rewriting to named macro calls: `|>` → `__pipe__()`, `::` → `__cons__()`, `<|` → `__apply__()`.

Standard JS operators (`+`, `-`, `*`, `/`, `===`, etc.) are handled by `/** @op */` JSDoc tags in the transformer, NOT the preprocessor.

**Validation rules:**
- Standard JS operators (`+`, `-`, `*`, etc.) use `@op` JSDoc tags on typeclass methods — not the preprocessor
- The `__pipe__`, `__cons__`, `__apply__` macros resolve custom operators via `typeclassRegistry.syntax` (from `@op` JSDoc)

## Scanner File Type

The scanner wraps `ts.createScanner`, which needs the correct `LanguageVariant`:

- `.tsx` / `.jsx` → `LanguageVariant.JSX`
- `.ts` / `.js` → `LanguageVariant.Standard`

The `preprocess()` function must accept a `fileName` parameter and thread it to `tokenize()`. Integrations (unplugin, ESLint processor) must pass the filename.

Without this, JSX elements like `<Component>` are tokenized as comparison operators, causing false `|>` merges and incorrect bracket matching.

## Text-Level Rewriting Rules

1. **Never change line count** — keep source maps simple (line N in output = line N in input, plus column offsets)
2. **Expression contexts only** — custom operators must not be rewritten in type annotations (e.g., `type P = A |> B` is invalid)
3. **Preserve structure** — the output must be valid TypeScript that parses to the intended AST

Before rewriting a custom operator, check context: scan left for `:`, `extends`, `type ... =`, `<` (generic args). If found, skip rewriting.

## Source Maps

Any text transformation must produce a usable source map. Use `magic-string` for replacements — it generates standard VLQ source maps automatically.

**Never return `map: null`** from a build plugin. Error locations, stack traces, and debugger breakpoints depend on accurate source maps.

## No Dead Code / No Duplicate Utilities

- Every symbol exported from `index.ts` must have at least one consumer
- Shared helpers (like `isBoundaryToken`) must live in one file and be imported
- Hoist hot-path allocations (like `new Set(...)`) to module scope

## Language Service Plugin

One canonical implementation at `packages/transformer/src/language-service.ts`. Do not duplicate this code.

## Unplugin Type-Checker Limitation

When unplugin preprocesses a file, it creates a fresh `ts.SourceFile` disconnected from the `ts.Program`. The type checker cannot resolve types for this file:

- `__pipe__`/`__cons__`/`__apply__` dispatch on custom types falls back to default semantics (e.g., `|>` becomes `f(a)`)
- Type-aware operator resolution requires **ts-patch**, not unplugin
