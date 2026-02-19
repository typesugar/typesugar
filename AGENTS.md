# Agent Guidelines for ttfx

## Core Principles

### 1. Zero-Cost Abstractions

**This is the most important principle of ttfx.**

Every abstraction should compile away to what you'd write by hand:

- No runtime dictionary lookups — inline method bodies directly
- No wrapper types — HKT encoding exists only in types, not at runtime
- No closure allocation — flatten nested callbacks
- No indirection — generic code compiles to direct calls

Before implementing any feature, ask: "Can this be done at compile time instead of runtime?"

Use the existing `inlineMethod()` from `specialize.ts` when you need to inline function bodies.

### 2. Reuse Core Infrastructure

Before creating new utilities, check what already exists (detailed reference below).

The `specialize` macro is the gold standard for zero-cost — study it before implementing new transformations.

### 3. Compile-Time Over Runtime

| Prefer                | Over                           |
| --------------------- | ------------------------------ |
| `inlineMethod()`      | Runtime function calls         |
| Direct AST generation | String concatenation + parsing |
| Type checker queries  | Runtime type checks            |
| Compile-time errors   | Runtime throws                 |

---

## Architecture

```
src/
├── core/               # Macro infrastructure
│   ├── types.ts        # MacroContext, MacroDefinition, ComptimeValue, DeriveTypeInfo
│   ├── registry.ts     # globalRegistry, defineExpressionMacro, defineAttributeMacro, etc.
│   ├── context.ts      # MacroContextImpl — node creation, type queries, evaluate()
│   ├── hygiene.ts      # Lexical hygiene — globalHygiene.withScope(), createIdentifier()
│   ├── capabilities.ts # MacroCapabilities, createRestrictedContext()
│   ├── cache.ts        # MacroExpansionCache for incremental builds
│   ├── pipeline.ts     # Composable macro pipelines — pipeline().pipe().build()
│   ├── config.ts       # Unified config system — config.get(), defineConfig()
│   └── source-map.ts   # Expansion tracking — globalExpansionTracker
├── macros/             # Built-in macros
│   ├── typeclass.ts    # @typeclass, @instance, @deriving, summon(), extend()
│   ├── specialize.ts   # specialize() — zero-cost inlining, inlineMethod()
│   ├── implicits.ts    # @implicits — automatic instance resolution
│   ├── hkt.ts          # @hkt — higher-kinded type support
│   ├── comptime.ts     # comptime() — compile-time evaluation
│   ├── quote.ts        # quote(), quoteStatements() — quasiquoting for AST construction
│   ├── derive.ts       # Built-in derives: Eq, Ord, Clone, Debug, Hash, Default, Json, Builder, TypeGuard
│   ├── custom-derive.ts# defineCustomDerive(), defineFieldDerive() — simplified derive API
│   ├── reflect.ts      # @reflect, typeInfo<T>(), fieldNames<T>(), validator<T>()
│   ├── tailrec.ts      # @tailrec — tail-call optimization
│   ├── operators.ts    # @operators, ops(), pipe(), compose()
│   ├── cfg.ts          # cfg(), @cfgAttr — conditional compilation
│   ├── generic.ts      # Generic<T,R> — structural type representations
│   ├── syntax-macro.ts # defineSyntaxMacro() — pattern-based macros (macro_rules! equivalent)
│   ├── primitives.ts   # Typeclass instances for number, string, boolean, bigint, array
│   ├── coverage.ts     # registerPrimitive(), validateCoverageOrError()
│   ├── implicit.ts     # summonHKT(), derive(), implicit() — HKT resolution
│   ├── include.ts      # includeStr(), includeJson() — compile-time file I/O
│   ├── static-assert.ts# static_assert(), compileError(), compileWarning()
│   └── module-graph.ts # collectTypes(), moduleIndex() — project introspection
├── transforms/
│   └── macro-transformer.ts  # Main TS transformer — orchestrates all macro expansion
└── index.ts            # Main exports and runtime placeholder functions

packages/
├── core/               # @ttfx/core — macro registration, types, context
├── transformer/        # @ttfx/transformer — ts-patch transformer plugin
├── typeclass/          # @ttfx/typeclass — Scala 3-style typeclasses
├── specialize/         # @ttfx/specialize — zero-cost specialization
├── operators/          # @ttfx/operators — operator overloading
├── derive/             # @ttfx/derive — custom derive API
├── reflect/            # @ttfx/reflect — compile-time reflection
├── comptime/           # @ttfx/comptime — compile-time evaluation
├── fp/                 # @ttfx/fp — functional programming (Option, Result, IO)
├── std/                # @ttfx/std — standard library extensions
├── react/              # @ttfx/react — reactive signals, JSX macros
├── sql/                # @ttfx/sql — typed SQL fragments
├── contracts/          # @ttfx/contracts — requires/ensures/invariant
├── contracts-z3/       # @ttfx/contracts-z3 — Z3 SMT solver integration
├── contracts-refined/  # @ttfx/contracts-refined — refinement types
├── testing/            # @ttfx/testing — powerAssert, comptimeAssert, ArbitraryDerive
├── type-system/        # @ttfx/type-system — refined types, newtype, vec
├── units/              # @ttfx/units — units of measure
├── strings/            # @ttfx/strings — string manipulation macros
├── effect/             # @ttfx/effect — Effect TS integration
├── kysely/             # @ttfx/kysely — Kysely integration
├── unplugin-ttfx/      # unplugin-ttfx — build tool integrations
├── eslint-plugin/      # @ttfx/eslint-plugin
└── vscode/             # @ttfx/vscode
```

---

## Macro System Reference

### Macro Kinds

There are 6 kinds of macros, each with a different trigger and signature:

| Kind                | Trigger                         | Signature                                                         | Registration                  |
| ------------------- | ------------------------------- | ----------------------------------------------------------------- | ----------------------------- |
| **Expression**      | Function call `macroName(...)`  | `expand(ctx, callExpr, args) → Expression`                        | `defineExpressionMacro()`     |
| **Attribute**       | Decorator `@macroName(...)`     | `expand(ctx, decorator, target, args) → Node \| Node[]`           | `defineAttributeMacro()`      |
| **Derive**          | `@derive(MacroName)`            | `expand(ctx, target, typeInfo) → Statement[]`                     | `defineDeriveMacro()`         |
| **Tagged Template** | `` tag`...` ``                  | `expand(ctx, node) → Expression`                                  | `defineTaggedTemplateMacro()` |
| **Type**            | Type reference `MacroType<...>` | `expand(ctx, typeRef, args) → TypeNode`                           | `defineTypeMacro()`           |
| **Labeled Block**   | `label: { ... }`                | `expand(ctx, mainBlock, continuation) → Statement \| Statement[]` | `defineLabeledBlockMacro()`   |

### MacroContext — What Every Macro Gets

Every macro's `expand` function receives a `MacroContext` (`ctx`) with:

**Compiler access:**

- `ctx.program` — the `ts.Program`
- `ctx.typeChecker` — full TypeScript type checker
- `ctx.sourceFile` — current file being processed
- `ctx.factory` — `ts.NodeFactory` for creating AST nodes
- `ctx.transformContext` — the `ts.TransformationContext`

**Node creation helpers:**

- `ctx.createIdentifier(name)` → `ts.Identifier`
- `ctx.createNumericLiteral(value)` → `ts.NumericLiteral`
- `ctx.createStringLiteral(value)` → `ts.StringLiteral`
- `ctx.createBooleanLiteral(value)` → `ts.Expression`
- `ctx.createArrayLiteral(elements)` → `ts.ArrayLiteralExpression`
- `ctx.createObjectLiteral(properties)` → `ts.ObjectLiteralExpression`
- `ctx.parseExpression(code)` — parse a code string into an expression
- `ctx.parseStatements(code)` — parse a code string into statements

**Type utilities:**

- `ctx.getTypeOf(node)` → `ts.Type`
- `ctx.getTypeString(node)` → string representation
- `ctx.isAssignableTo(source, target)` → boolean
- `ctx.getPropertiesOfType(type)` → `ts.Symbol[]`
- `ctx.getSymbol(node)` → `ts.Symbol | undefined`

**Diagnostics:**

- `ctx.reportError(node, message)` — compile-time error
- `ctx.reportWarning(node, message)` — compile-time warning

**Compile-time evaluation:**

- `ctx.evaluate(node)` → `ComptimeValue` (AST evaluator with `vm` fallback)
- `ctx.isComptime(node)` → boolean (can this be evaluated at compile time?)

**Hygiene:**

- `ctx.generateUniqueName(prefix)` → `ts.Identifier` (avoids name collisions)

### Quasiquoting (`src/macros/quote.ts`)

The preferred way to construct AST in macro implementations. Uses tagged templates with splicing:

```typescript
import {
  quote,
  quoteStatements,
  quoteType,
  quoteBlock,
} from "../macros/quote.js";
import { spread, ident, raw } from "../macros/quote.js";

// Single expression
const expr = quote(ctx)`${left} + ${right}`;

// Multiple statements
const stmts = quoteStatements(ctx)`
  const ${ident("x")} = ${initializer};
  console.log(${ident("x")});
`;

// Type node
const typeNode = quoteType(ctx)`Array<${elementType}>`;

// Splice helpers:
// spread(stmts)  — splice an array of statements
// ident(name)    — force identifier treatment
// raw(name)      — unhygienic identifier (intentional capture)
```

Convenience helpers: `quoteCall`, `quotePropAccess`, `quoteMethodCall`, `quoteConst`, `quoteLet`, `quoteReturn`, `quoteIf`, `quoteArrow`, `quoteFunction`.

### Macro Pipeline (`src/core/pipeline.ts`)

Chain transformations into a registered macro:

```typescript
import { pipeline, assertType, debugStep } from "../core/pipeline.js";

pipeline("myMacro", "my-module")
  .pipe((ctx, expr) => /* transform step 1 */)
  .pipeIf(condition, (ctx, expr) => /* conditional step */)
  .mapElements((ctx, elem) => /* per-element step */)
  .build(); // registers as ExpressionMacro
```

### Lexical Hygiene (`src/core/hygiene.ts`)

Prevents name collisions in macro-generated code:

```typescript
import { globalHygiene } from "../core/hygiene.js";

globalHygiene.withScope(() => {
  const id = globalHygiene.createIdentifier("temp"); // mangled to avoid collisions
  // ... use id in generated code ...
});
```

### Expansion Tracking (`src/core/source-map.ts`)

Records macro expansions for source maps and debugging:

```typescript
import { globalExpansionTracker } from "../core/source-map.js";

globalExpansionTracker.recordExpansion(
  macroName,
  originalNode,
  sourceFile,
  expandedText,
  fromCache,
);
globalExpansionTracker.generateReport(); // human-readable summary
```

### Caching (`src/core/cache.ts`)

Incremental caching for macro expansion results:

```typescript
import { MacroExpansionCache, InMemoryExpansionCache } from "../core/cache.js";

const cache = new MacroExpansionCache(cacheDir);
const key = MacroExpansionCache.computeKey(macroName, sourceText, argTexts);
const cached = cache.get(key);
if (!cached) {
  cache.set(key, expandedText);
}
```

### Capabilities (`src/core/capabilities.ts`)

Declarative permissions for macros:

```typescript
import {
  createRestrictedContext,
  MacroCapabilities,
} from "../core/capabilities.js";

const caps: MacroCapabilities = {
  needsTypeChecker: true,
  needsFileSystem: false, // blocks fs access
  needsProjectIndex: false, // blocks program-wide queries
  canEmitDiagnostics: true,
  maxTimeout: 5000,
};
const restricted = createRestrictedContext(ctx, caps, "myMacro");
```

### Configuration (`src/core/config.ts`)

Unified config system with compile-time conditionals:

```typescript
import { config, defineConfig } from "../core/config.js";

config.get("contracts.enabled"); // dot-notation access
config.evaluate("contracts.enabled && !production"); // condition evaluation
config.when("debug", debugCode, releaseCode); // compile-time conditional
```

---

## Built-in Macros Quick Reference

### Typeclass System (`typeclass.ts`, `specialize.ts`, `implicits.ts`, `hkt.ts`)

The typeclass system is the flagship feature. It provides Scala 3-style typeclasses with zero-cost specialization.

| Macro                           | Kind       | Purpose                                                                          |
| ------------------------------- | ---------- | -------------------------------------------------------------------------------- |
| `@typeclass`                    | Attribute  | Declares a typeclass interface, registers methods, generates companion namespace |
| `@instance`                     | Attribute  | Registers a typeclass instance, registers methods for specialization             |
| `@deriving`                     | Attribute  | Auto-derives typeclass instances for a type (supports transitive derivation)     |
| `summon<TC<T>>()`               | Expression | Resolves a typeclass instance at compile time                                    |
| `extend(value).method(args)`    | Expression | Extension method syntax via typeclass instances                                  |
| `specialize(fn)`                | Expression | Inlines typeclass dictionary methods — **the zero-cost core**                    |
| `@implicits`                    | Attribute  | Auto-fills typeclass instance parameters at call sites                           |
| `summonAll<TC1<T1>, TC2<T2>>()` | Expression | Resolves multiple instances at once                                              |
| `@hkt`                          | Attribute  | Higher-kinded type parameter support (`F<_>` → `$<F, A>`)                        |
| `summonHKT<TC<F>>()`            | Expression | Resolves HKT typeclass instances                                                 |

**Key registries:**

- `typeclassRegistry` — typeclass metadata (methods, type params)
- `instanceRegistry` — registered instances (typeclass × type → instance)
- `extensionMethodRegistry` — extension methods for types
- `instanceMethodRegistry` — method implementations for specialization (in `specialize.ts`)

**Key functions for reuse:**

- `inlineMethod(ctx, method, callArgs)` — inlines a method body, substituting parameters
- `registerInstanceMethods(typeName, methods)` — registers methods for later inlining
- `findInstance(typeclassName, typeName)` — looks up a registered instance
- `getTypeclass(name)` — retrieves typeclass metadata

### Derive Macros (`derive.ts`, `custom-derive.ts`)

Built-in derives generate implementations from type structure:

| Derive      | Generates                                          |
| ----------- | -------------------------------------------------- |
| `Eq`        | `equals(a, b)` — structural equality               |
| `Ord`       | `compare(a, b)` — ordering (-1, 0, 1)              |
| `Clone`     | `clone(value)` — deep copy                         |
| `Debug`     | `debug(value)` — string representation             |
| `Hash`      | `hash(value)` — hash code                          |
| `Default`   | `defaultValue()` — default instance                |
| `Json`      | `toJson(value)` / `fromJson(json)` — serialization |
| `Builder`   | Builder pattern with `.withField()` methods        |
| `TypeGuard` | `isTypeName(value)` — runtime type guard           |

All derives handle both product types (records) and sum types (discriminated unions).

**Simplified derive API:**

```typescript
import {
  defineCustomDerive,
  defineFieldDerive,
} from "../macros/custom-derive.js";

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

### Compile-Time Evaluation (`comptime.ts`)

```typescript
const result = comptime(() => {
  // Runs at compile time, result inlined as literal
  return fibonacci(10);
});
```

Supports AST evaluation for simple expressions, falls back to sandboxed `vm` for complex code.

### Reflection (`reflect.ts`)

```typescript
@reflect
interface User { name: string; age: number; }
// Generates: export const __User_meta__ = { name: "User", fields: [...], ... }

const info = typeInfo<User>();     // inline type metadata object
const names = fieldNames<User>();  // ["name", "age"]
const guard = validator<User>();   // runtime type guard function
```

### Operators (`operators.ts`)

```typescript
@operators({ "+": "add", "*": "mul", "==": "equals" })
class Vec2 { ... }

const result = ops(a + b * c);  // → a.add(b.mul(c))
const piped = pipe(x, f, g, h); // → h(g(f(x)))
const composed = compose(f, g); // → (x) => f(g(x))
```

### Tail-Call Optimization (`tailrec.ts`)

```typescript
@tailrec
function factorial(n: number, acc: number = 1): number {
  if (n <= 1) return acc;
  return factorial(n - 1, n * acc);
}
// Compiles to: while(true) loop with mutable variables
```

### Conditional Compilation (`cfg.ts`)

```typescript
const value = cfg("debug", debugImpl, releaseImpl);

@cfgAttr("feature.experimental")
function experimentalFeature() { ... } // removed if condition is false
```

### File I/O (`include.ts`)

```typescript
const text = includeStr("./template.txt"); // string literal at compile time
const data = includeJson("./config.json"); // parsed JSON object at compile time
const bytes = includeBytes("./binary.dat"); // Uint8Array at compile time
```

### Static Assertions (`static-assert.ts`)

```typescript
static_assert(condition, "message"); // compile error if false, removed if true
compileError("this code path is unreachable");
compileWarning("deprecated usage");
```

### Pattern-Based Macros (`syntax-macro.ts`)

```typescript
import { defineSyntaxMacro, defineRewrite } from "../macros/syntax-macro.js";

// Multi-arm pattern matching
defineSyntaxMacro("unless", {
  arms: [
    {
      pattern: "$cond:expr, $body:expr",
      expand: "($cond) ? undefined : ($body)",
    },
  ],
});

// Single rewrite shorthand
defineRewrite("double", "$x:expr", "($x) + ($x)");
```

### Module Introspection (`module-graph.ts`)

```typescript
const types = collectTypes("src/**/*.ts"); // all exported types matching pattern
const index = moduleIndex(); // all exports in the project
```

### Primitives (`primitives.ts`, `coverage.ts`)

Pre-registered typeclass instances for: `number`, `string`, `boolean`, `bigint`, `null`, `undefined`, `Array<T>`.

Typeclasses covered: `Show`, `Eq`, `Ord`, `Hash`, `Semigroup`, `Monoid`.

Coverage checking validates that all fields of a derived type have the required primitive instances.

### Generic Programming (`generic.ts`)

Structural type representations for datatype-generic programming:

```typescript
@genericDerive
interface Point { x: number; y: number; }
// Registers Generic<Point, Point> with field metadata
// Enables deriveShowViaGeneric, deriveEqViaGeneric, etc.
```

### FlatMap & Do-Notation (`@ttfx/std`)

The `FlatMap` typeclass and `let:/yield:` macros provide zero-cost do-notation for monadic types.

**FlatMap typeclass:**

```typescript
import { FlatMap, registerFlatMap } from "@ttfx/std";

// FlatMap is pre-registered for common types: Promise, Array, Option, Result
// Register custom FlatMap instances:
registerFlatMap<MyMonad<unknown>>("MyMonad", {
  flatMap: (ma, f) => ma.bind(f),
});
```

**Do-notation with labeled blocks:**

```typescript
import { Option, Some, None } from "@ttfx/fp";

// let: binds the result, yield: returns the final value
let: {
  x << Some(1)
  y << Some(2)
}
yield: { x + y }
// Compiles to: Some(1).flatMap(x => Some(2).map(y => x + y))
```

| Macro/Function       | Kind            | Purpose                                                        |
| -------------------- | --------------- | -------------------------------------------------------------- |
| `let: { ... }`       | Labeled Block   | Binds monadic values using `<<` operator                       |
| `yield: { ... }`     | Labeled Block   | Returns the final expression (uses `map` for last binding)     |
| `registerFlatMap()`  | Function        | Registers a custom `FlatMap` instance for a type               |
| `FlatMap<F>`         | Typeclass       | Provides `map` and `flatMap` for monadic sequencing            |

**Key functions:**

- `registerFlatMap<F>(name, impl)` — registers a FlatMap instance for type `F`
- Built-in instances: `Promise`, `Array`, `Option`, `Result`, `Either`, `IO`

---

## The Transformer (`src/transforms/macro-transformer.ts`)

The transformer is the runtime engine that orchestrates all macro expansion during TypeScript compilation. Key behaviors:

1. **Single-pass, top-to-bottom** — visits each node once, but recursively re-visits macro expansion results
2. **Decorator ordering** — respects `expandAfter` dependencies for multiple decorators on one node
3. **Import cleanup** — removes imports of macro-only symbols after expansion
4. **Extension method rewriting** — detects `value.method()` calls and rewrites to `TC.summon<Type>("Type").method(value, ...args)`
5. **Implicit propagation** — `@implicits` functions propagate their scope to nested calls
6. **Auto-specialization** — detects calls with typeclass instance arguments and attempts inlining
7. **Transitive derivation** — `@deriving` builds a plan of dependent types and derives them in order

---

## Quick Lookup: "I Need To..."

| Need                            | Use                                                                 | Location                  |
| ------------------------------- | ------------------------------------------------------------------- | ------------------------- |
| Inline a method body            | `inlineMethod(ctx, method, callArgs)`                               | `specialize.ts`           |
| Register a new expression macro | `defineExpressionMacro(name, macro)`                                | `core/registry.ts`        |
| Register a new attribute macro  | `defineAttributeMacro(name, macro)`                                 | `core/registry.ts`        |
| Register a new derive macro     | `defineDeriveMacro(name, macro)`                                    | `core/registry.ts`        |
| Create AST from code string     | `ctx.parseExpression(code)`, `ctx.parseStatements(code)`            | `core/context.ts`         |
| Create AST with splicing        | `quote(ctx)\`...\``, `quoteStatements(ctx)\`...\``                  | `macros/quote.ts`         |
| Get type information            | `ctx.typeChecker`, `ctx.getTypeOf(node)`, `ctx.getTypeString(node)` | `core/context.ts`         |
| Get type properties             | `ctx.getPropertiesOfType(type)`                                     | `core/context.ts`         |
| Evaluate at compile time        | `ctx.evaluate(node)`, `ctx.isComptime(node)`                        | `core/context.ts`         |
| Report compile error            | `ctx.reportError(node, message)`                                    | `core/context.ts`         |
| Generate unique names           | `ctx.generateUniqueName(prefix)`                                    | `core/context.ts`         |
| Avoid name collisions           | `globalHygiene.withScope(() => { ... })`                            | `core/hygiene.ts`         |
| Track typeclass instances       | `instanceRegistry`, `findInstance()`                                | `macros/typeclass.ts`     |
| Register instance methods       | `registerInstanceMethods(name, methods)`                            | `macros/specialize.ts`    |
| Check primitive coverage        | `registerPrimitive()`, `validateCoverageOrError()`                  | `macros/coverage.ts`      |
| Extract type metadata           | `extractTypeInfo(ctx, node)`                                        | `macros/reflect.ts`       |
| Detect discriminated unions     | `tryExtractSumType(ctx, target)`                                    | `macros/typeclass.ts`     |
| Define pattern-based macro      | `defineSyntaxMacro(name, options)`                                  | `macros/syntax-macro.ts`  |
| Define custom derive (simple)   | `defineCustomDerive(name, callback)`                                | `macros/custom-derive.ts` |
| Chain macro transformations     | `pipeline(name).pipe(...).build()`                                  | `core/pipeline.ts`        |
| Restrict macro capabilities     | `createRestrictedContext(ctx, caps, name)`                          | `core/capabilities.ts`    |
| Read config values              | `config.get(path)`, `config.evaluate(condition)`                    | `core/config.ts`          |
| Include file at compile time    | `includeStr()`, `includeJson()`                                     | `macros/include.ts`       |
| Assert at compile time          | `static_assert(cond, msg)`                                          | `macros/static-assert.ts` |
| Register FlatMap instance       | `registerFlatMap<F>(name, impl)`                                    | `@ttfx/std`               |
| Use do-notation for monads      | `let: { x << ... } yield: { ... }`                                  | `@ttfx/std`               |

---

## When Adding Features

1. **Check PHILOSOPHY.md** for design principles
2. **Check existing macros** in `src/macros/` for patterns to follow
3. **Reuse `specialize.ts`** infrastructure for inlining
4. **Use `quote()`** for AST construction instead of raw `factory` calls
5. **Add tests** in `tests/` directory
6. **Update docs** if user-facing

## GitHub Account

Use `dpovey` (personal account) for this repo.
