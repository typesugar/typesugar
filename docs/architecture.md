# Architecture

This document explains how the ttfx transformer works internally.

## Overview

```
Source Code → Parser → AST → Transformer → Modified AST → Emitter → Output
                              ↑
                         Macro Registry
```

ttfx is a TypeScript transformer that:

1. Parses TypeScript source into an AST
2. Walks the AST looking for macro invocations
3. Calls registered macros to transform nodes
4. Emits the modified AST as JavaScript

## Core Components

### MacroRegistry

The central registry for all macros:

```typescript
class MacroRegistry {
  // Register a macro
  register(macro: Macro): void;

  // Find macros by name/type
  findExpressionMacro(name: string): ExpressionMacro | undefined;
  findAttributeMacro(name: string): AttributeMacro | undefined;
  findTaggedTemplateMacro(name: string): TaggedTemplateMacro | undefined;
  findLabeledBlockMacro(label: string): LabeledBlockMacro | undefined;
}
```

Macros self-register when their modules are imported:

```typescript
// In @ttfx/comptime
import { globalRegistry, defineExpressionMacro } from "@ttfx/core";

const comptimeMacro = defineExpressionMacro({ ... });
globalRegistry.register(comptimeMacro);
```

### MacroTransformer

The main transformer that processes source files:

```typescript
class MacroTransformer {
  constructor(program: ts.Program, config: MacroTransformerConfig);

  // Transform a source file
  transform(sourceFile: ts.SourceFile): ts.SourceFile;
}
```

### Import-Scoped Resolution

Macros are resolved based on imports, not global names:

```typescript
// This only works because we imported `comptime` from @ttfx/comptime
import { comptime } from "@ttfx/comptime";

const x = comptime(1 + 1); // ✓ Expands

// This does NOT expand (no import)
const y = comptime(2 + 2); // ✗ Just a function call
```

The transformer tracks imports and only expands macro calls that match.

## Transformation Pipeline

### 1. Import Analysis

```typescript
// Track what macros are imported from where
const importMap = analyzeImports(sourceFile);
// { "comptime": "@ttfx/comptime", "sql": "@ttfx/sql", ... }
```

### 2. AST Walking

```typescript
function visit(node: ts.Node): ts.Node {
  // Check each node type
  if (ts.isCallExpression(node)) {
    return maybeExpandExpressionMacro(node);
  }
  if (ts.isDecorator(node)) {
    return maybeExpandAttributeMacro(node);
  }
  if (ts.isTaggedTemplateExpression(node)) {
    return maybeExpandTaggedTemplateMacro(node);
  }
  if (ts.isLabeledStatement(node)) {
    return maybeExpandLabeledBlockMacro(node);
  }

  // Recurse into children
  return ts.visitEachChild(node, visit, context);
}
```

### 3. Macro Expansion

```typescript
function maybeExpandExpressionMacro(call: ts.CallExpression): ts.Node {
  // Get the function name
  const name = getCalleeName(call);

  // Check if it's an imported macro
  const importSource = importMap.get(name);
  if (!importSource) return call;

  // Find the registered macro
  const macro = registry.findExpressionMacro(name);
  if (!macro) return call;

  // Create context and expand
  const ctx = createMacroContext(call);
  return macro.expand(ctx, call);
}
```

### 4. Output

The modified AST is passed to TypeScript's emitter to generate JavaScript.

## Macro Types

### Expression Macro

```
comptime(1 + 1)
↓
(value computed at compile time: 2)
```

### Attribute Macro

```
@derive(Eq, Clone)
class Point { x: number; y: number; }
↓
class Point {
  x: number;
  y: number;
  equals(other: Point): boolean { ... }
  clone(): Point { ... }
}
```

### Tagged Template Macro

```
sql`SELECT * FROM users WHERE id = ${userId}`
↓
{ text: "SELECT * FROM users WHERE id = $1", params: [userId] }
```

### Labeled Block Macro

```
let: {
  x << fetchX()
  y << fetchY(x)
}
yield: { x + y }
↓
fetchX().flatMap(x => fetchY(x).map(y => x + y))
```

## Configuration

```typescript
interface MacroTransformerConfig {
  // Log macro expansions
  verbose: boolean;

  // Timeout for comptime() evaluation
  timeout: number;

  // Additional macro directories
  macroDirectories: string[];

  // File patterns
  include: string[];
  exclude: string[];
}
```

## Error Handling

Macros report errors through the context:

```typescript
expand(ctx, node) {
  if (/* invalid input */) {
    ctx.reportError(node, "Expected a string literal");
    return node; // Return unchanged
  }
  // ...
}
```

Errors include source location and are displayed like TypeScript errors:

```
src/index.ts:42:5 - error: Expected a string literal
42:   comptime(someVariable);
      ~~~~~~~~~~~~~~~~~~~~~~
```

## Performance

### Caching

- Macro registrations are cached
- Import analysis is cached per file
- Type information is cached

### Incremental Compilation

The transformer supports TypeScript's incremental compilation:

- Only modified files are re-transformed
- Macro dependencies are tracked

## Bundler Integration

### unplugin Architecture

ttfx uses [unplugin](https://github.com/unjs/unplugin) for bundler support:

```
@ttfx/integrations
├── vite.ts      → unplugin/vite
├── webpack.ts   → unplugin/webpack
├── esbuild.ts   → unplugin/esbuild
└── rollup.ts    → unplugin/rollup
```

All bundler plugins share the same core transformation logic.

### Integration Flow

```
1. Bundler loads source file
2. Plugin intercepts TypeScript files
3. MacroTransformer processes the file
4. Modified source is returned to bundler
5. Bundler continues with normal compilation
```

## Debugging

### Verbose Mode

```typescript
ttfx({ verbose: true });
```

Logs every macro expansion:

```
[ttfx] Expanding comptime(1 + 1) → 2
[ttfx] Expanding sql`...` → { text: "...", params: [...] }
[ttfx] Expanding @derive(Eq) on class Point
```

### Source Maps

Source maps are preserved through transformation, so debuggers show original source locations.

## Limitations

1. **No cross-file analysis** — Each file is transformed independently
2. **Import-scoped only** — Macros must be imported to be expanded
3. **TypeScript only** — JavaScript files are not transformed
4. **Compile-time only** — No runtime macro expansion
