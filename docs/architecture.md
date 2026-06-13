# typesugar Macro Architecture

This document describes the internal architecture of the typesugar macro system. It is intended for contributors and maintainers who need to understand how the compilation pipeline works.

## Overview

typesugar transforms TypeScript source code in two phases:

1. **HKT Rewriting** — Rewrites higher-kinded type applications (`F<A>` where `F` is a type parameter) to `Kind<F, A>`
2. **AST Transformation** — Macro expansion, specialization, and extension method rewriting

All source is standard TypeScript (`.ts` / `.tsx`). There is no custom file extension or surface syntax — every feature is driven by JSDoc macros (`/** @typeclass */`, `let:`, etc.) and the type-parameter HKT rewrite. This keeps plain `.ts` files compatible with any TypeScript tool.

```
                    ┌─────────────────┐
                    │  Source File    │
                    │   .ts / .tsx    │
                    └────────┬────────┘
                             │
                             ▼
┌─────────────────────────────────┐
│  1. HKT REWRITER                │
│  - F<A> → Kind<F, A> where F   │
│    is a type parameter          │
│  - Inject Kind import           │
│  - Generate source map          │
└─────────────────────────────────┘
                             │
                             ▼
                    Valid TypeScript
                             │
                             ▼
┌─────────────────────────────────┐
│  2. MACRO TRANSFORMER (AST)     │
│  - Parse to AST via ts.Program  │
│  - Visit each node top-down     │
│  - Expand macros by kind        │
│  - Auto-specialize instances    │
│  - Rewrite extension methods    │
│  - Clean up macro imports       │
└─────────────────────────────────┘
                             │
                             ▼
    Transformed TypeScript (JS/DTS)
```

### Module Resolution

Module resolution follows standard TypeScript rules (`bar.ts`, `bar.tsx`, `bar/index.ts`, ...).

---

## 1. HKT Rewriter (`@typesugar/transformer`)

The HKT rewriter rewrites higher-kinded type syntax (`F<A>` applications of a type parameter) into valid TypeScript (`Kind<F, A>`). It runs inside `VirtualCompilerHost` before `ts.Program` creation, so the type checker never sees the invalid `F<A>` (which would otherwise raise TS2315).

### Location

```
packages/transformer/src/hkt-rewriter.ts   # AST-based HKT rewriter
```

### Pipeline Flow

The rewriter is AST-based (`ts.createSourceFile` only — no Program, no TypeChecker):

- Collects `TypeReference` nodes whose identifier matches a type parameter of an enclosing scope
- Rewrites `F<A>` usages to `Kind<F, A>`, innermost-first for nested applications
- Injects `import type { Kind }` where needed

### Key Functions

```typescript
rewriteHKTTypeReferences(source: string, fileName: string):
  { code: string; map: RawSourceMap | null; changed: boolean }

hasHKTPatterns(source: string): boolean // fast regex pre-check
```

### Source Maps

The rewriter uses `magic-string` to track source positions through transformations. The returned `RawSourceMap` (re-exported from `@typesugar/core`) follows the standard v3 source map format and can be passed through build tools.

---

## 2. AST Transformer (`@typesugar/transformer`)

The transformer is a TypeScript compiler plugin (ts-patch) that expands macros during compilation.

### Location

```
src/transforms/macro-transformer.ts    # Main transformer (legacy location)
packages/transformer/src/index.ts      # Package entry point
```

### Main Class: `MacroTransformer`

The transformer performs a single-pass, top-to-bottom traversal of the AST. When a macro is detected, it expands it and recursively re-visits the expansion result.

### Visitor Dispatch Flow

The `visit(node)` method is called for every AST node. It delegates to `tryTransform(node)`, which uses a `SyntaxKind`-based switch to route nodes to the appropriate handler:

```
visit(node)
  └─ tryTransform(node)
       ├─ CallExpression → (checked in this order)
       │    ├─ tryExpandExpressionMacro()     — macro name match
       │    ├─ tryTransformImplicitCall()       — = implicit() resolution
       │    ├─ tryRewriteExtensionMethod()     — value.method() rewriting
       │    └─ tryAutoSpecialize()             — dictionary inlining
       ├─ ClassDeclaration / FunctionDeclaration / etc.
       │    └─ tryExpandAttributeMacros()      — @decorator expansion
       ├─ TaggedTemplateExpression
       │    └─ tryExpandTaggedTemplate()       — tag`...` expansion
       ├─ TypeReference
       │    └─ tryExpandTypeMacro()            — TypeMacro<T> expansion
       └─ (statement containers)
            └─ visitStatementContainer()       — labeled block macros
```

For `CallExpression` nodes, the order of checks matters: expression macros are checked first, then `= implicit()` parameter resolution, then extension methods, then auto-specialization.

### Key Methods

| Method                        | Purpose                                            |
| ----------------------------- | -------------------------------------------------- |
| `visit(node)`                 | Main visitor, dispatches by SyntaxKind             |
| `tryTransform(node)`          | SyntaxKind switch routing to specific handlers     |
| `tryExpandExpressionMacro()`  | Handles `macroName(args)` calls                    |
| `tryExpandAttributeMacros()`  | Handles `@decorator` macros                        |
| `tryExpandTaggedTemplate()`   | Handles `` tag`...` `` macros                      |
| `tryExpandTypeMacro()`        | Handles `TypeMacro<T>` references                  |
| `visitStatementContainer()`   | Handles labeled block macros (`let: { }`)          |
| `tryRewriteExtensionMethod()` | Rewrites `value.method()` to typeclass calls       |
| `tryAutoSpecialize()`         | Inlines dictionary methods when instances detected |
| `resolveMacroFromSymbol()`    | Import-scoped macro resolution through aliases     |
| `cleanupMacroImports()`       | Removes import specifiers for expanded macros      |

### Macro Resolution

The transformer supports two resolution modes:

1. **Name-based** (legacy) — Macros matched by function/decorator name alone
2. **Import-scoped** — Macros only activate when imported from a specific module

Import-scoped resolution tracks the `module` and `exportName` fields on `MacroDefinition`.

### Import Cleanup

After expansion, the transformer removes import specifiers that resolved to macros (they have no runtime representation). This prevents "module not found" errors for macro-only imports.

### Implicit Parameter Resolution

Parameters marked with `= implicit()` are resolved at compile time. The transformer detects `implicit()` default parameter markers and replaces them with the resolved typeclass instances. Resolved instances propagate to nested calls via an `implicitScopeStack`.

---

## 3. Core Infrastructure (`@typesugar/core`)

The core package provides shared infrastructure for macro definitions and expansion.

### Location and Package Split

There are two `core` directories, serving different roles:

**`packages/core/src/` — Public API package (`@typesugar/core`)**

This is the published npm package. It contains the types and registries that external packages (like `@typesugar/transformer`) import:

```
packages/core/src/
├── index.ts      # Public exports
├── types.ts      # MacroContext, MacroDefinition, DeriveTypeInfo, StandaloneExtensionInfo
├── registry.ts   # globalRegistry, standaloneExtensionRegistry, definition helpers
├── context.ts    # MacroContextImpl
├── safety.ts     # invariant(), unreachable(), debugOnly()
└── config.ts     # config.get(), defineConfig()
```

**`src/core/` — Internal implementation (used by the legacy transformer)**

This is consumed only by `src/transforms/macro-transformer.ts` and built-in macros in `src/macros/`. It has additional infrastructure not yet promoted to the public package:

```
src/core/
├── types.ts        # Extended types (OPERATOR_SYMBOLS for @op validation)
├── registry.ts     # Mirror of packages/core registry + standalone extensions
├── context.ts      # MacroContextImpl (parallel implementation)
├── hygiene.ts      # Lexical hygiene for generated identifiers
├── cache.ts        # MacroExpansionCache for incremental builds
├── pipeline.ts     # Composable macro pipelines
├── capabilities.ts # MacroCapabilities, restricted contexts
└── source-map.ts   # Expansion tracking for debugging
```

The two locations are a legacy artifact. The long-term goal is to consolidate everything into `packages/core/`.

### MacroContext

Every macro's `expand()` function receives a `MacroContext` providing:

**Compiler Access:**

- `program` — The `ts.Program`
- `typeChecker` — Full TypeScript type checker
- `sourceFile` — Current file being processed
- `factory` — `ts.NodeFactory` for creating AST nodes
- `transformContext` — The `ts.TransformationContext`

**Node Creation:**

- `createIdentifier(name)`, `createNumericLiteral(value)`, `createStringLiteral(value)`
- `createArrayLiteral(elements)`, `createObjectLiteral(properties)`
- `parseExpression(code)`, `parseStatements(code)` — Parse source strings to AST

**Type Utilities:**

- `getTypeOf(node)`, `getTypeString(node)`
- `isAssignableTo(source, target)`
- `getPropertiesOfType(type)`, `getSymbol(node)`

**Diagnostics:**

- `reportError(node, message)`, `reportWarning(node, message)`

**Compile-Time Evaluation:**

- `evaluate(node)` → `ComptimeValue` — Evaluate AST at compile time
- `isComptime(node)` — Check if node can be evaluated

**Hygiene:**

- `generateUniqueName(prefix)` — Avoid name collisions in generated code

### Macro Kinds

typesugar supports six kinds of macros:

| Kind            | Trigger              | Signature                                            |
| --------------- | -------------------- | ---------------------------------------------------- |
| Expression      | `macroName(...)`     | `expand(ctx, callExpr, args) → Expression`           |
| Attribute       | `@macroName(...)`    | `expand(ctx, decorator, target, args) → Node[]`      |
| Derive          | `@derive(MacroName)` | `expand(ctx, target, typeInfo) → Statement[]`        |
| Tagged Template | `` tag`...` ``       | `expand(ctx, node) → Expression`                     |
| Type            | `MacroType<...>`     | `expand(ctx, typeRef, args) → TypeNode`              |
| Labeled Block   | `label: { ... }`     | `expand(ctx, mainBlock, continuation) → Statement[]` |

### Lexical Hygiene

The hygiene system has two parts:

**1. Introduced-name hygiene** — Prevents capture of user variables by macro-generated code:

```typescript
import { globalHygiene } from "../core/hygiene.js";

globalHygiene.withScope(() => {
  const id = globalHygiene.createIdentifier("temp");
  // id.text === "__typesugar_temp_s0_0__" (mangled)
});
```

**2. Reference hygiene** — Ensures macro-emitted references to external symbols resolve correctly even when users shadow those names:

```typescript
// In a macro's expand() function:
const eqRef = ctx.safeRef("Eq", "@typesugar/std");
// If user has `const Eq = 42;`, returns "__Eq_ts0__" (alias)
// Otherwise, returns "Eq" (bare identifier)
```

The `safeRef` system uses three-tier resolution for O(1) conflict detection:

- **Tier 0**: Known JS globals (Error, Array, etc.) — always safe
- **Tier 1**: File import map — safe if same module, conflict otherwise
- **Tier 2**: Local declarations — conflict if name is declared at file level

When a conflict is detected, `safeRef` generates an aliased import that the transformer injects into the file.

Unhygienic escapes (`raw()`) are available for intentional capture (e.g., when a macro needs to reference user-defined variables).

### Expansion Cache

The `MacroExpansionCache` provides disk-backed caching for incremental builds:

```typescript
const cache = new MacroExpansionCache(cacheDir);
const key = MacroExpansionCache.computeKey(macroName, sourceText, argTexts);
const cached = cache.get(key);
if (!cached) {
  cache.set(key, expandedText);
}
```

---

## 4. Quasiquoting (`src/macros/quote.ts`)

The quasiquoting system provides AST construction via tagged templates, replacing verbose `ts.factory` calls.

### Core Functions

```typescript
import { quote, quoteStatements, quoteType, quoteBlock } from "../macros/quote.js";

// Single expression
const expr = quote(ctx)`${left} + ${right}`;

// Multiple statements
const stmts = quoteStatements(ctx)`
  const ${ident("x")} = ${initializer};
  console.log(${ident("x")});
`;

// Type annotation
const typeNode = quoteType(ctx)`Array<${elementType}>`;
```

### Splice Helpers

| Helper          | Purpose                                  |
| --------------- | ---------------------------------------- |
| `spread(stmts)` | Splice an array of statements            |
| `ident(name)`   | Force string to be treated as identifier |
| `raw(name)`     | Unhygienic identifier (escapes hygiene)  |

### Convenience Builders

| Function                                  | Returns              |
| ----------------------------------------- | -------------------- |
| `quoteCall(ctx, callee, args)`            | Call expression      |
| `quotePropAccess(ctx, obj, prop)`         | Property access      |
| `quoteMethodCall(ctx, obj, method, args)` | Method call          |
| `quoteConst(ctx, name, init)`             | Const declaration    |
| `quoteLet(ctx, name, init)`               | Let declaration      |
| `quoteReturn(ctx, expr)`                  | Return statement     |
| `quoteIf(ctx, cond, then, else)`          | If statement         |
| `quoteArrow(ctx, params, body)`           | Arrow function       |
| `quoteFunction(ctx, name, params, body)`  | Function declaration |

---

## 5. Typeclass System (`src/macros/typeclass.ts`)

The typeclass system implements Scala 3-style typeclasses with zero-cost specialization.

### Key Macros

| Macro                | Kind       | Purpose                              |
| -------------------- | ---------- | ------------------------------------ |
| `@typeclass`         | Attribute  | Declares a typeclass interface       |
| `@instance`          | Attribute  | Registers a typeclass instance       |
| `@derive`            | Attribute  | Auto-derives typeclass instances     |
| `summon<TC<T>>()`    | Expression | Resolves a typeclass instance        |
| `value.method(args)` | Expression | Extension method syntax (implicit)   |
| `specialize(fn)`     | Expression | Inlines typeclass dictionary methods |

### Extension Method Resolution Order

When the transformer encounters `value.method(args)`, it resolves the method through:

1. **Native property check** — If `method` is a real property on the type, skip rewriting (unless an import-scoped extension forces it)
2. **Typeclass extensions** via `findExtensionMethod()`:
   - Exact type name match (e.g., `Point`)
   - Base type name without generics (e.g., `Array` from `Array<number>`)
   - Search all registered typeclasses for the method name
3. **Standalone extensions**:
   - Pre-registered entries in `standaloneExtensionRegistry` (`findStandaloneExtension()`)
   - Import-scoped resolution via `resolveExtensionFromImports()`

### Operator Resolution Order (for `__binop__`)

When the transformer encounters `__binop__(left, op, right)` (from preprocessor-rewritten custom operators like `|>` and `::`):

1. `typeclassRegistry.syntax` — Typeclass `@op` JSDoc annotations on methods
2. Hardcoded semantic defaults (e.g., `|>` defaults to `right(left)`, `::` to `[left, ...right]`)

Standard JavaScript operators (`+`, `-`, `*`, `/`, `===`, etc.) are handled by the typeclass system via `@op` JSDoc tags on typeclass method signatures — no wrapper function needed. When a typeclass instance exists, `a + b` rewrites directly to the corresponding method call.

### HKT Conventions

typesugar provides four tiers for higher-kinded type encoding, from most ergonomic to most explicit:

**Tier 0 — `F<A>` in typeclass bodies (recommended).** The transformer rewrites `F<A>` (where `F` is a type parameter) to `Kind<F, A>` before type-checking. Pure AST operation, works in all environments:

```typescript
/** @typeclass */
interface Functor<F> {
  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}

function lift<F, A, B>(F: Functor<F>, f: (a: A) => B): (fa: F<A>) => F<B> {
  return (fa) => F.map(fa, f);
}
```

**Tier 1 — Implicit resolution in `@impl`.** The macro resolves the type constructor via the TypeChecker:

```typescript
/** @impl Functor<Option> */
const optionFunctor = {
  map: (fa, f) => (fa === null ? null : f(fa)),
};
```

No `OptionF`, `ArrayF`, or `@hkt` needed. Partial application works: `@impl Functor<Either<string>>`.

**Tier 2/3 — `@hkt` annotations.** For explicit control or types you don't own:

```typescript
/** @hkt */
type Option<A> = A | null; // Tier 2: generates OptionF companion

import type { _ } from "@typesugar/type-system";
/** @hkt */
type ArrayF = Array<_>; // Tier 3: _ marks the hole
```

**Manual `TypeFunction` — escape hatch** for full control:

```typescript
interface ArrayF extends TypeFunction {
  _: Array<this["__kind__"]>; // MUST use this["__kind__"]
}
```

The underlying encoding uses phantom kind markers: `type Kind<F, A> = F & { readonly __kind__: A }`. The preprocessor resolves known type functions (`Kind<OptionF, number>` → `Option<number>`) while leaving generic usages unchanged.

---

## 6. Zero-Cost Specialization (`src/macros/specialize.ts`)

The specialization system eliminates typeclass dictionary overhead at compile time.

### Core Concept

```typescript
// Before specialization
function map<F>(F: Functor<F>): <A, B>(fa: Kind<F, A>, f: (a: A) => B) => Kind<F, B> {
  return (fa, f) => F.map(fa, f);
}

// After specialization for Array
function mapArray<A, B>(fa: Array<A>, f: (a: A) => B): Array<B> {
  return fa.map(f); // Dictionary call inlined
}
```

### Key Functions

| Function                              | Purpose                             |
| ------------------------------------- | ----------------------------------- |
| `inlineMethod(ctx, method, callArgs)` | Core inlining logic                 |
| `getInstanceMethods(name)`            | Retrieve registered methods         |
| `specializeMacro`                     | `specialize(fn, dict1, dict2, ...)` |
| `specializeInlineMacro`               | `specialize$(dict, expr)`           |

### Source-Based Specialization

Instead of pre-registering instance methods, use `@specialize` on your instance definition:

```typescript
/** @impl Functor<Array> @specialize */
const arrayFunctor: Functor<ArrayF> = {
  map: (fa, f) => fa.map(f),
};
```

The `@specialize` annotation causes the transformer to extract method bodies from the AST at compile time.

---

## 7. Built-in Macro Subsystems

Beyond the core typeclass and specialization macros, typesugar provides several additional macro subsystems.

### Derive System (`src/macros/derive.ts`, `src/macros/custom-derive.ts`)

The derive system generates implementations from type structure, similar to Rust's `#[derive()]`.

**Built-in Derives:** `Eq`, `Ord`, `Clone`, `Debug`, `Hash`, `Default`, `Json`, `Builder`, `TypeGuard`

All derives handle both product types (records/interfaces) and sum types (discriminated unions). For sum types, the `DeriveTypeInfo.discriminant` field specifies the tag property name.

**Custom Derive API:**

```typescript
// String-based (returns code as string)
defineCustomDerive("MyDerive", (typeInfo) => {
  return `export function process${typeInfo.name}(x: ${typeInfo.name}) { ... }`;
});

// AST-based (returns ts.Statement[])
defineCustomDeriveAst("MyDerive", (ctx, typeInfo) => {
  return [
    /* ts.Statement nodes */
  ];
});

// Per-field derive
defineFieldDerive("Validate", (field) => {
  return `if (!isValid(value.${field.name})) throw new Error("invalid");`;
});
```

### Conditional Compilation (`src/macros/cfg.ts`)

Provides compile-time conditional code inclusion, similar to Rust's `#[cfg()]`:

```typescript
const value = cfg("debug", debugImpl, releaseImpl);

@cfgAttr("feature.experimental")
function experimentalFeature() { ... } // removed if condition is false
```

The condition evaluator supports `&&`, `||`, `!`, `==`, `!=`, parentheses, and dotted config paths. Config values come from transformer options, environment variables (`TYPESUGAR_CFG_*`), and config files.

### Pattern-Based Macros (`src/macros/syntax-macro.ts`)

Implements Rust `macro_rules!`-style pattern matching:

```typescript
defineSyntaxMacro("unless", {
  arms: [
    {
      pattern: "$cond:expr, $body:expr",
      expand: "($cond) ? undefined : ($body)",
    },
  ],
});

// Shorthand for single-arm macros
defineRewrite("double", "$x:expr", "($x) + ($x)");
```

**Capture kinds:** `expr`, `ident`, `literal`, `type`, `stmts`

### Reflection (`src/macros/reflect.ts`)

Compile-time type introspection:

```typescript
@reflect
interface User { name: string; age: number; }
// Generates: export const __User_meta__ = { name: "User", fields: [...] }

const info = typeInfo<User>();     // inline type metadata object
const names = fieldNames<User>();  // ["name", "age"]
const guard = validator<User>();   // runtime type guard function
```

### Tail-Call Optimization (`src/macros/tailrec.ts`)

Transforms tail-recursive functions into `while(true)` loops:

```typescript
@tailrec
function factorial(n: number, acc: number = 1): number {
  if (n <= 1) return acc;
  return factorial(n - 1, n * acc);
}
// Compiles to: while(true) loop with mutable variables
```

The macro validates that all recursive calls are in tail position (following Scala's rules) and reports compile-time errors for non-tail calls.

### Compile-Time Evaluation (`src/macros/comptime.ts`)

```typescript
const result = comptime(() => fibonacci(10)); // inlined as 55
```

The evaluator uses a two-tier approach:

1. **AST evaluator** — Direct SyntaxKind-based dispatch for simple expressions (literals, binary ops, arrays, objects, conditionals)
2. **VM fallback** — For complex expressions, transpiles TypeScript to JavaScript and runs in a sandboxed Node `vm` module with safe built-ins (Math, JSON, Array, etc.) and a 5-second timeout

### Macro Pipelines (`src/core/pipeline.ts`)

Chain transformations into a registered macro:

```typescript
pipeline("myMacro", "my-module")
  .pipe((ctx, expr) => /* step 1 */)
  .pipeIf(condition, (ctx, expr) => /* conditional step */)
  .mapElements((ctx, elem) => /* per-element */)
  .build(); // registers as ExpressionMacro
```

### Capability Restrictions (`src/core/capabilities.ts`)

Declarative permissions for macros to limit what they can access:

```typescript
const caps: MacroCapabilities = {
  needsTypeChecker: true,
  needsFileSystem: false, // blocks fs access
  needsProjectIndex: false, // blocks program-wide queries
  canEmitDiagnostics: true,
  maxTimeout: 5000,
};
const restricted = createRestrictedContext(ctx, caps, "myMacro");
```

`createRestrictedContext()` wraps `MacroContext` in a Proxy that throws on unauthorized access.

### Expansion Tracking (`src/core/source-map.ts`)

Records macro expansions for source maps and debugging:

```typescript
globalExpansionTracker.recordExpansion(
  macroName,
  originalNode,
  sourceFile,
  expandedText,
  fromCache
);
globalExpansionTracker.generateReport(); // human-readable summary
globalExpansionTracker.toJSON(); // machine-readable format
```

---

## 8. Extension Methods

typesugar supports two extension mechanisms:

### Typeclass Extensions (Implicit)

When a typeclass instance is registered, its methods become available as extension methods:

```typescript
@instance
const ShowPoint: Show<Point> = {
  show: (p) => `Point(${p.x}, ${p.y})`
};

// Enables:
point.show()  // Rewritten to ShowPoint.show(point)
```

The transformer detects these calls via `tryRewriteExtensionMethod()` and rewrites them to static calls.

### Extension Methods (UFCS)

Any function whose first parameter matches the receiver type can be called as a method:

```typescript
import { clamp, abs } from "@typesugar/std";

(-5).abs(); // → abs(-5) → Math.abs(-5)
(42).clamp(0, 100); // → clamp(42, 0, 100)
```

For library authors, mark a file with `"use extension"` to make all exports callable as methods:

```typescript
"use extension";
export function double(n: number): number {
  return n * 2;
}
// Users can write: (5).double()
```

Extensions are resolved via import-scoped scanning and take priority over typeclasses.

---

## 9. Build Tool Integration (`unplugin-typesugar`)

The unplugin provides universal integration with build tools (Vite, esbuild, Webpack, Rollup).

### Location

```
packages/unplugin-typesugar/src/unplugin.ts
```

### Hooks

| Hook         | Purpose                                                       |
| ------------ | ------------------------------------------------------------- |
| `buildStart` | Creates the `ts.Program` for type checking                    |
| `load`       | Runs the preprocessor, returns preprocessed code + source map |
| `transform`  | Runs the macro transformer on preprocessed code               |

### Known Limitation

Currently, the `ts.Program` is created with original source files, but preprocessing happens later in the `load` hook. This means the type checker sees original content (`F<A>`), not preprocessed content (`Kind<F, A>`).

See `docs/PLAN-implicit-operators.md` for the planned fix using a custom `CompilerHost`.

---

## 10. Build and Test Configuration

### Monorepo Structure

The project uses pnpm workspaces. Each package under `packages/` has its own `package.json`, `tsconfig.json`, `tsup.config.ts`, and `vitest.config.ts`.

### Build

Packages are built with `tsup`, configured per-package via `tsup.config.ts`. The root `pnpm build` command builds all packages in dependency order (excluding examples).

### Testing

Tests run via vitest with a workspace configuration. The root `vitest.config.ts` defines workspace projects, and each package can override settings in its own `vitest.config.ts`:

```
pnpm test                           # all tests via vitest workspace
pnpm --filter @typesugar/transformer test  # single package
```

Package-level vitest configs typically set a project name matching the package, used for test filtering.

### TypeScript Configuration

Each package extends `tsconfig.base.json` from the monorepo root. The base config targets ES2022 with ESM module resolution.

---

## 11. Typechecking Model

typesugar follows the standard TypeScript ecosystem pattern: **fast builds, background IDE checking, CI correctness gate.**

### Three Layers

```
Build tool (Vite, esbuild, …)    →  Macros expand, types stripped, NO typecheck
IDE (tsserver + language service) →  Background incremental typecheck
CI (tsc --noEmit)                 →  Full correctness gate
```

The only exception is `tsc` with ts-patch, where transformation and typechecking happen in the same pass.

### Why Pre-Macro Code Is Type-Incomplete

Macros create type structure. `@derive(Eq)` generates `.equals()`, `summon<Eq<Point>>()` resolves to a concrete instance, extension methods rewrite `point.show()` to `showPoint.show(point)`. Before macros run, this code is intentionally type-incomplete — methods don't exist yet, instances aren't resolved, extension methods haven't been rewritten.

The language service plugin (`typesugar/language-service`) runs macros before the IDE typechecks, so the IDE sees expanded code and reports accurate errors.

### Strict Mode

The `strict` option runs `tsc` on macro-expanded output at build end:

| Option                    | Behavior                          |
| ------------------------- | --------------------------------- |
| `strict: false` (default) | Build only — no typecheck         |
| `strict: true`            | Build + typecheck expanded output |

`strict: true` catches type errors that macros might introduce (e.g., wrong return types in generated code). It's recommended for CI but adds overhead in development.

### Macro Diagnostics

Macros report errors via two mechanisms:

1. **`ctx.reportError(node, message)`** — Simple string diagnostics
2. **`DiagnosticBuilder`** — Rich diagnostics with labeled spans, fix suggestions, and see-also references

Both use typesugar's error code range (TS9001–TS9999) to distinguish macro errors from native TypeScript errors.

For the full user-facing guide, see [Type Safety](./guides/type-safety.md).

---

## Summary

The typesugar macro system is built on these principles:

1. **Two-phase compilation** — Lexical preprocessing followed by AST transformation
2. **Zero-cost abstractions** — Specialize generic code to eliminate runtime overhead
3. **Compile-time evaluation** — Compute what can be computed at build time
4. **Import-scoped activation** — Macros only activate when explicitly imported
5. **Source map preservation** — Track positions through transformations for debugging

For implementation details, see the source files and `AGENTS.md` guidelines.

---

## Future Improvements

This section documents known limitations and planned enhancements.

### AST Source Maps

**Current State:** Only the lexical preprocessor generates source maps. The AST transformer rewrites nodes but does not track original positions, making it difficult to debug expanded macro code.

**Impact:** Error messages and stack traces point to generated code positions rather than the original macro call site.

**Proposed Solution:**

1. Extend `MacroContext` with source map tracking capabilities
2. Record original node positions when creating replacement nodes
3. Generate a second source map layer for AST transformations
4. Compose preprocessor and transformer source maps for end-to-end tracing

**Complexity:** High — requires changes throughout the transformer and careful handling of recursive expansions.

### unplugin Type-Aware Transformation

**Current State:** The `unplugin-typesugar` creates the `ts.Program` at `buildStart` with original source files. Preprocessing happens later in the `load` hook. This means the type checker sees original content (`F<A>`) rather than preprocessed content (`Kind<F, A>`).

**Impact:** Macros that rely on accurate type information may produce incorrect results when HKT rewriting is involved.

**Proposed Solution:**

1. Preprocess files **before** creating the Program using a custom `CompilerHost`
2. Implement disk-based caching for preprocessed content:
   - Cache directory: `.typesugar-cache/` or `node_modules/.cache/typesugar/`
   - Key: hash of (file content + preprocessor version)
   - Store preprocessed code + source map
   - LRU eviction for cache size limits
3. `CompilerHost.readFile()` checks cache, preprocesses on miss
4. Watch mode: invalidate cache entry when source file's mtime changes

**Complexity:** Medium — can reuse `MacroExpansionCache` infrastructure from `src/core/cache.ts`.

See `docs/PLAN-implicit-operators.md` for the detailed implementation plan.

### Specialization Control Flow Limitations

**Current State:** The `inlineMethod()` function in `specialize.ts` performs direct parameter substitution. This works well for simple method bodies but has limitations with complex control flow.

**Known Issues:**

1. **Early returns** — Methods with `return` statements inside conditionals cannot be inlined into expression contexts without wrapping in an IIFE
2. **Try/catch** — Exception handling in method bodies requires IIFE wrapping in expression contexts
3. **Loops** — While/for loops in method bodies cannot be inlined into expressions
4. **Mutable variables** — Let declarations in method bodies may capture incorrectly when inlined

**Current Workaround:** The specializer falls back to non-inlined calls when it detects complex control flow.

**Proposed Solutions:**

1. Implement control flow analysis to detect inlinable vs. non-inlinable methods
2. Use statement-level specialization when the call site is a statement (not expression)
3. Generate optimized IIFE wrappers only when necessary
4. Consider a "flatten" pass that converts control flow to expression form where possible

**Complexity:** High — requires sophisticated AST analysis and transformation.

### Incremental Caching Improvements

**Current State:** `MacroExpansionCache` provides basic disk-backed caching for macro expansions. The cache key is computed from source text and arguments.

**Limitations:**

1. **Memory pressure** — Large projects may load many cached entries into memory
2. **Invalidation granularity** — File-level invalidation; changing one function invalidates the entire file's cache
3. **Cross-file dependencies** — No tracking of macro dependencies on other files

**Proposed Improvements:**

1. Implement lazy loading with LRU eviction for cache entries
2. Add AST-level cache keys for finer-grained invalidation
3. Track macro dependencies using the module graph
4. Explore incremental compilation integration with TypeScript's watch mode

**Complexity:** Medium to High — depends on scope of improvements.

### Macro Debugging Experience

**Current State:** When a macro fails, error messages reference internal transformer code rather than the macro definition.

**Proposed Improvements:**

1. Add macro stack traces showing the expansion chain
2. Provide a "macro expansion view" that shows intermediate results
3. Integrate with IDE language service for macro-aware debugging
4. Generate `.typesugar-expanded/` directory with fully expanded source for inspection

**Complexity:** Medium — mostly additive features.

### Type-Level Macro System

**Current State:** Type macros (`TypeMacro<T>`) are supported but less mature than expression/attribute macros.

**Proposed Improvements:**

1. Support generic type macro parameters (`TypeMacro<T extends SomeConstraint>`)
2. Add compile-time type manipulation utilities (similar to TypeScript's conditional types but more powerful)
3. Enable type macros to emit diagnostics with proper source locations

**Complexity:** Medium — requires careful interaction with TypeScript's type system.

---

## Contributing

When working on these improvements:

1. Consult `AGENTS.md` for coding guidelines and architectural constraints
2. Add tests for new functionality in the appropriate test directory
3. Update this document when completing improvements
4. Consider backwards compatibility with existing macro definitions
