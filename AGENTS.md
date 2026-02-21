# Agent Guidelines for typesugar

## Core Principles

### 1. Zero-Cost Abstractions

**This is the most important principle of typesugar.**

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

For a detailed explanation of the macro compilation pipeline, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

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
│   ├── extension.ts    # registerExtensions(), registerExtension() — standalone extensions
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
│
│   ## Build Infrastructure
├── core/               # @typesugar/core — macro registration, types, context
├── transformer/        # @typesugar/transformer — ts-patch transformer plugin
├── preprocessor/       # @typesugar/preprocessor — lexical preprocessor for custom syntax
├── unplugin-typesugar/ # unplugin-typesugar — build tool integrations (Vite, esbuild, Rollup, Webpack)
│
│   ## Developer Experience
├── vscode/             # @typesugar/vscode — VS Code/Cursor extension
├── eslint-plugin/      # @typesugar/eslint-plugin — ESLint processor and rules
├── prettier-plugin/    # @typesugar/prettier-plugin — Prettier formatting
├── testing/            # @typesugar/testing — powerAssert, comptimeAssert, ArbitraryDerive
│
│   ## Standard Library
├── std/                # @typesugar/std — standard library extensions, match(), FlatMap
│
│   ## Typeclasses & Derivation
├── typeclass/          # @typesugar/typeclass — Scala 3-style typeclasses
├── derive/             # @typesugar/derive — custom derive API
├── specialize/         # @typesugar/specialize — zero-cost specialization
├── reflect/            # @typesugar/reflect — compile-time reflection
│
│   ## Syntax Sugar
├── operators/          # @typesugar/operators — operator overloading
├── strings/            # @typesugar/strings — string manipulation macros
├── comptime/           # @typesugar/comptime — compile-time evaluation
├── named-args/         # @typesugar/named-args — named function arguments (Boost.Parameter)
│
│   ## Type Safety & Contracts
├── type-system/        # @typesugar/type-system — refined types, newtype, vec
├── contracts/          # @typesugar/contracts — requires/ensures/invariant
├── contracts-refined/  # @typesugar/contracts-refined — refinement types
├── contracts-z3/       # @typesugar/contracts-z3 — Z3 SMT solver integration
├── validate/           # @typesugar/validate — schema validation macros
├── units/              # @typesugar/units — units of measure
│
│   ## Data Structures & Algorithms
├── fp/                 # @typesugar/fp — functional programming (Option, Result, IO)
├── hlist/              # @typesugar/hlist — heterogeneous lists (Boost.Fusion)
├── fusion/             # @typesugar/fusion — iterator fusion, expression templates (Blitz++)
├── parser/             # @typesugar/parser — PEG parser generation (Boost.Spirit)
├── graph/              # @typesugar/graph — graph algorithms, state machines (Boost.Graph)
├── erased/             # @typesugar/erased — typeclass-based type erasure (dyn Trait)
├── codec/              # @typesugar/codec — versioned codecs, schema evolution (serde)
├── geometry/           # @typesugar/geometry — coordinate system safety (Boost.Geometry)
├── math/               # @typesugar/math — math types and typeclasses
├── mapper/             # @typesugar/mapper — zero-cost object mapping
│
│   ## Ecosystem Integrations
├── effect/             # @typesugar/effect — Effect TS integration (@service, @layer, resolveLayer, derives)
├── react/              # @typesugar/react — reactive signals, JSX macros
├── sql/                # @typesugar/sql — typed SQL fragments
├── kysely/             # @typesugar/kysely-adapter — Kysely integration
└── drizzle/            # @typesugar/drizzle-adapter — Drizzle integration
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
import { quote, quoteStatements, quoteType, quoteBlock } from "../macros/quote.js";
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
  fromCache
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
import { createRestrictedContext, MacroCapabilities } from "../core/capabilities.js";

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

The typeclass system is the flagship feature. It provides **implicit resolution** with **zero-cost specialization**.

**Primary behavior — implicit resolution:**

Operators and methods automatically resolve to typeclasses:

```typescript
interface Point {
  x: number;
  y: number;
}

// Operators resolve to typeclasses automatically
p1 === p2; // Eq typeclass → compiles to: p1.x === p2.x && p1.y === p2.y
p1 < p2; // Ord typeclass → compiles to: lexicographic comparison

// Methods resolve to typeclasses automatically
p1.show(); // Show typeclass → compiles to: `Point(x = ${p1.x}, y = ${p1.y})`
p1.clone(); // Clone typeclass → compiles to: { x: p1.x, y: p1.y }
```

**Resolution flow:**

1. Compiler sees `===` or `.show()` on a type
2. Identifies the relevant typeclass (Eq, Show, etc.)
3. Checks for explicit `@instance` — use it if found
4. Checks for explicit `@derive()` — use generated instance if found
5. **Auto-derives via Mirror** — extracts type structure from TypeChecker, synthesizes instance
6. **Auto-specializes** — inlines method body at call site (zero-cost)

**Specialization (from implicit to explicit):**

1. `@implicits` + auto-specialize — Fully automatic, user writes `sortWith(items)`, compiler fills in instances AND inlines them
2. `fn.specialize(dict)` — Extension method syntax for creating named specialized functions
3. `specialize(fn, [dict])` — Legacy function wrapper (still supported)

**Explicit patterns (progressive disclosure):**

| Pattern                             | Use Case                                        |
| ----------------------------------- | ----------------------------------------------- |
| `p1 === p2`, `p1.show()`            | Default — implicit resolution + auto-derivation |
| `summon<TC<T>>()`                   | Generic code where type isn't concrete          |
| `@derive(Show, Eq)`                 | Documentation — make capabilities explicit      |
| `@instance const eq: Eq<T> = {...}` | Custom behavior — override auto-derivation      |

**Macros reference:**

| Macro                | Kind       | Purpose                                                         |
| -------------------- | ---------- | --------------------------------------------------------------- |
| `@typeclass`         | Attribute  | Declares a typeclass interface (for library authors)            |
| `@instance`          | Attribute  | Provides custom typeclass instance, overrides auto-derivation   |
| `@derive(...)`       | Attribute  | Documents capabilities (optional, same operations work without) |
| `summon<TC<T>>()`    | Expression | Explicit resolution for generic code                            |
| `fn.specialize(dict)`| Extension  | Create specialized function (preferred explicit syntax)         |
| `specialize(fn,dict)`| Expression | Legacy explicit specialization (array syntax)                   |
| `@implicits`         | Attribute  | Auto-fills instance params + auto-specializes at call sites     |
| `@hkt`               | Attribute  | Higher-kinded type parameter support (`F<_>` → `$<F, A>`)       |
| `summonHKT<TC<F>>()` | Expression | Resolves HKT typeclass instances                                |

**Key registries:**

- `typeclassRegistry` — typeclass metadata (methods, type params)
- `instanceRegistry` — registered instances (typeclass × type → instance)
- `extensionMethodRegistry` — typeclass extension methods for types
- `standaloneExtensionRegistry` — standalone extension methods for concrete types (Scala 3-style)
- `instanceMethodRegistry` — method implementations for specialization (in `specialize.ts`)

**Key functions for reuse:**

- `inlineMethod(ctx, method, callArgs)` — inlines a method body, substituting parameters
- `registerInstanceMethods(typeName, methods)` — registers methods for later inlining
- `findInstance(typeclassName, typeName)` — looks up a registered instance
- `getTypeclass(name)` — retrieves typeclass metadata
- `extractGenericMeta(ctx, type)` — extracts Mirror-style metadata for auto-derivation

### Standalone Extension Methods (`extension.ts`, `macro-transformer.ts`)

Beyond typeclass methods, standalone extensions provide additional methods on concrete types.
These compile to direct function calls — inherently zero-cost.

**Usage — implicit, like typeclasses:**

```typescript
// Methods on primitives just work
(42).clamp(0, 100); // → NumberExt.clamp(42, 0, 100)
"hello".capitalize(); // → StringExt.capitalize("hello")
[1, 2, 3].sum(); // → ArrayExt.sum([1, 2, 3])
```

**How it works (resolution order for method calls):**

1. **Typeclass methods** — auto-derived or explicit instances (`.show()`, `.clone()`, etc.)
2. **Extension registry** — explicit `registerExtensions()` calls
3. **Import-scoped scan** — enumerate imports, match method name and receiver type

All paths produce zero-cost output — direct function calls, no indirection.

**Explicit registration (optional):**

| Macro                                 | Kind       | Purpose                                        |
| ------------------------------------- | ---------- | ---------------------------------------------- |
| `registerExtensions(type, namespace)` | Expression | Pre-register namespace methods as extensions   |
| `registerExtension(type, fn)`         | Expression | Pre-register a single function as an extension |

**When to use `extend()` wrapper:**

The `extend()` wrapper is rarely needed. Use it for:

- **Disambiguation** — multiple typeclasses define same method name
- **Generic contexts** — type parameter not concrete at call site
- **Explicit intent** — documentation or teaching

```typescript
// Rare: disambiguate when multiple typeclasses have .map()
extend(value, Functor).map(f);

// Common: just call methods directly
value.show();
value.clone();
```

### HKT Conventions

**IMPORTANT: TypeScript HKT uses `F<_>`, NOT Scala's `F[_]`.** Never use square bracket syntax in code or types.

The HKT encoding in typesugar is based on indexed-access types (`packages/type-system/src/hkt.ts`):

```typescript
type $<F, A> = (F & { readonly _: A })["_"];
```

**Defining type-level functions:**

```typescript
// Good: parameterized via this["_"]
interface ArrayF {
  _: Array<this["_"]>;
}
interface MapF<K> {
  _: Map<K, this["_"]>;
}

// BAD: not parameterized — $<StringF, B> always resolves to string
interface StringF {
  _: string;
} // ← phantom type, unsound for Functor/map
```

**Rules for type-level functions:**

1. The `_` property MUST reference `this["_"]` to be sound. If `$<F, B>` always equals the same type regardless of `B`, the HKT encoding is phantom/unsound
2. Types that cannot be parameterized (e.g., `string`, `Int8Array`) should NOT implement typeclasses that change the element type (`map`, `flatMap`). Limit them to read-only typeclasses (`IterableOnce`, `Foldable`)
3. Never use `as unknown as` to paper over HKT type mismatches — it means the type-level function is wrong

**Writing HKT typeclasses:**

The project convention is to write `$<F, A>` explicitly in typeclass definitions. The `F<_>` sugar exists (auto-detected by the transformer) but is NOT used in `@typesugar/fp` or `@typesugar/collections`:

```typescript
// Current convention: explicit $<F, A>
interface Functor<F> {
  readonly map: <A, B>(fa: $<F, A>, f: (a: A) => B) => $<F, B>;
}

// Also valid but not used yet: F<_> sugar (transformer rewrites F<A> to $<F, A>)
interface Functor<F<_>> {
  readonly map: <A, B>(fa: F<A>, f: (a: A) => B) => F<B>;
}
```

**Dictionary-passing style:**

All derived operations take the typeclass instance as the first argument for zero-cost specialization:

```typescript
// Good: dictionary-passing, works with specialize()
function map<F>(F: Functor<F>): <A, B>(fa: $<F, A>, f: (a: A) => B) => $<F, B> {
  return (fa, f) => F.map(fa, f);
}

// Bad: no dictionary parameter, can't be specialized
function map<F, A, B>(fa: $<F, A>, f: (a: A) => B): $<F, B> { ... }
```

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
import { defineCustomDerive, defineFieldDerive } from "../macros/custom-derive.js";

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

**Sandbox Permissions:**

By default, comptime runs in a restricted sandbox. File system and environment access require explicit permissions:

```typescript
// Read files at compile time
const schema = comptime({ fs: "read" }, () => {
  return fs.readFileSync("./schema.json", "utf8");
});

// Read environment variables
const apiKey = comptime({ env: "read" }, () => {
  return process.env.API_KEY;
});

// Combined permissions
const config = comptime({ fs: "read", env: "read" }, () => {
  const base = JSON.parse(fs.readFileSync("./config.json", "utf8"));
  return { ...base, apiKey: process.env.API_KEY };
});
```

Permission types:

- `fs: 'read' | 'write' | true` — File system access
- `env: 'read' | true` — Environment variable access
- `net: boolean | string[]` — Network access (not yet implemented)
- `time: boolean` — Real time access (not yet implemented)

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

**Two operator systems exist — use the right one for your case:**

| System                 | Operators                                     | When to Use                                       | Registration                              |
| ---------------------- | --------------------------------------------- | ------------------------------------------------- | ----------------------------------------- |
| **Op\<\> Typeclass**   | `+`, `-`, `*`, `/`, `===`, etc. (standard JS) | Types with typeclass instances (Numeric, Eq, Ord) | `Op<"+">` on typeclass method return type |
| **@operators / ops()** | Any operator                                  | Class-specific method mapping (legacy pattern)    | `@operators` decorator on class           |

#### Primary: Op\<\> on Typeclass Returns (Zero-Cost)

Standard JS operators work **automatically** on types with typeclass instances. The transformer rewrites them via `tryRewriteTypeclassOperator()`. No wrapper needed.

```typescript
// Numeric typeclass has Op<"+"> on add(), Op<"*"> on mul(), etc.
// Any type with a Numeric instance gets operator support automatically:

const a: Rational = rational(1, 2);
const b: Rational = rational(1, 3);
const c = a + b; // Compiles to: rationalNumeric.add(a, b)
const d = a * b; // Compiles to: rationalNumeric.mul(a, b)

// Same for Eq (===), Ord (<, >, <=, >=), etc.
a === b; // Compiles to: rationalEq.equals(a, b)
a < b; // Compiles to: rationalOrd.compare(a, b) < 0
```

#### Secondary: @operators + ops() (Class-Specific)

For classes that need custom method names (not using typeclasses):

```typescript
@operators({ "+": "add", "*": "mul", "==": "equals" })
class Vec2 {
  add(other: Vec2): Vec2 { ... }
  mul(other: Vec2): Vec2 { ... }
  equals(other: Vec2): boolean { ... }
}

const result = ops(a + b * c);  // → a.add(b.mul(c))
```

**Prefer the `Op<>` typeclass approach** — it's zero-cost and integrates with the rest of the typeclass system.

#### Utilities

```typescript
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

### FlatMap & Do-Notation (`@typesugar/std`)

The `FlatMap` typeclass and `let:/yield:` macros provide zero-cost do-notation for monadic types.

**FlatMap typeclass:**

```typescript
import { FlatMap, registerFlatMap } from "@typesugar/std";

// FlatMap is pre-registered for common types: Promise, Array, Option, Result
// Register custom FlatMap instances:
registerFlatMap<MyMonad<unknown>>("MyMonad", {
  flatMap: (ma, f) => ma.bind(f),
});
```

**Do-notation with labeled blocks:**

```typescript
import { Option, Some, None } from "@typesugar/fp";

// let: binds the result, yield: returns the final value
let: {
  x << Some(1);
  y << Some(2);
}
yield: {
  x + y;
}
// Compiles to: Some(1).flatMap(x => Some(2).map(y => x + y))
```

| Macro/Function      | Kind          | Purpose                                                    |
| ------------------- | ------------- | ---------------------------------------------------------- |
| `let: { ... }`      | Labeled Block | Binds monadic values using `<<` operator                   |
| `yield: { ... }`    | Labeled Block | Returns the final expression (uses `map` for last binding) |
| `registerFlatMap()` | Function      | Registers a custom `FlatMap` instance for a type           |
| `FlatMap<F>`        | Typeclass     | Provides `map` and `flatMap` for monadic sequencing        |

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
8. **Opt-out detection** — checks for `"use no typesugar"` and `// @ts-no-typesugar` before expanding

### Opt-Out System (`packages/core/src/resolution-scope.ts`)

The transformer respects opt-out directives at multiple granularities:

| Scope    | Syntax                                  | Checked by              |
| -------- | --------------------------------------- | ----------------------- |
| File     | `"use no typesugar"` at top of file     | `scanImportsForScope()` |
| Function | `"use no typesugar"` as first statement | `isInOptedOutScope()`   |
| Line     | `// @ts-no-typesugar` comment           | `hasInlineOptOut()`     |
| Feature  | `"use no typesugar extensions"`         | `isFeatureOptedOut()`   |

All macro expansion points in the transformer check `isInOptedOutScope()` before transforming.

### Import Suggestion System (`packages/core/src/import-suggestions.ts`)

When a symbol isn't in scope, the diagnostics can include "Did you mean to import?" hints:

```typescript
getSuggestionsForSymbol("Eq"); // → suggests "@typesugar/std"
getSuggestionsForMethod("clamp", "number"); // → suggests "NumberExt from @typesugar/std"
getSuggestionsForMacro("comptime"); // → suggests "typesugar"
```

The export index is pre-populated with known typesugar exports and can be extended via `registerExport()`.

---

## Quick Lookup: "I Need To..."

| Need                            | Use                                                                  | Location                     |
| ------------------------------- | -------------------------------------------------------------------- | ---------------------------- |
| Inline a method body            | `inlineMethod(ctx, method, callArgs)`                                | `specialize.ts`              |
| Create specialized function     | `createSpecializedFunction(ctx, options)`                            | `specialize.ts`              |
| Register a new expression macro | `defineExpressionMacro(name, macro)`                                 | `core/registry.ts`           |
| Register a new attribute macro  | `defineAttributeMacro(name, macro)`                                  | `core/registry.ts`           |
| Register a new derive macro     | `defineDeriveMacro(name, macro)`                                     | `core/registry.ts`           |
| Create AST from code string     | `ctx.parseExpression(code)`, `ctx.parseStatements(code)`             | `core/context.ts`            |
| Create AST with splicing        | `quote(ctx)\`...\``, `quoteStatements(ctx)\`...\``                   | `macros/quote.ts`            |
| Get type information            | `ctx.typeChecker`, `ctx.getTypeOf(node)`, `ctx.getTypeString(node)`  | `core/context.ts`            |
| Get type properties             | `ctx.getPropertiesOfType(type)`                                      | `core/context.ts`            |
| Evaluate at compile time        | `ctx.evaluate(node)`, `ctx.isComptime(node)`                         | `core/context.ts`            |
| Report compile error            | `ctx.reportError(node, message)`                                     | `core/context.ts`            |
| Generate unique names           | `ctx.generateUniqueName(prefix)`                                     | `core/context.ts`            |
| Avoid name collisions           | `globalHygiene.withScope(() => { ... })`                             | `core/hygiene.ts`            |
| Track typeclass instances       | `instanceRegistry`, `findInstance()`                                 | `macros/typeclass.ts`        |
| Register standalone extensions  | `registerStandaloneExtensionEntry(info)`                             | `macros/extension.ts`        |
| Find standalone extension       | `findStandaloneExtension(method, type)`                              | `macros/extension.ts`        |
| Register instance methods       | `registerInstanceMethods(name, methods)`                             | `macros/specialize.ts`       |
| Check primitive coverage        | `registerPrimitive()`, `validateCoverageOrError()`                   | `macros/coverage.ts`         |
| Extract type metadata           | `extractTypeInfo(ctx, node)`                                         | `macros/reflect.ts`          |
| Detect discriminated unions     | `tryExtractSumType(ctx, target)`                                     | `macros/typeclass.ts`        |
| Define pattern-based macro      | `defineSyntaxMacro(name, options)`                                   | `macros/syntax-macro.ts`     |
| Define custom derive (simple)   | `defineCustomDerive(name, callback)`                                 | `macros/custom-derive.ts`    |
| Chain macro transformations     | `pipeline(name).pipe(...).build()`                                   | `core/pipeline.ts`           |
| Restrict macro capabilities     | `createRestrictedContext(ctx, caps, name)`                           | `core/capabilities.ts`       |
| Read config values              | `config.get(path)`, `config.evaluate(condition)`                     | `core/config.ts`             |
| Include file at compile time    | `includeStr()`, `includeJson()`                                      | `macros/include.ts`          |
| Assert at compile time          | `static_assert(cond, msg)`                                           | `macros/static-assert.ts`    |
| Register FlatMap instance       | `registerFlatMap<F>(name, impl)`                                     | `@typesugar/std`             |
| Use do-notation for monads      | `let: { x << ... } yield: { ... }`                                   | `@typesugar/std`             |
| Check if node is opted out      | `isInOptedOutScope(sourceFile, node, tracker, feature?)`             | `core/resolution-scope.ts`   |
| Check for inline opt-out        | `hasInlineOptOut(sourceFile, node, feature?)`                        | `core/resolution-scope.ts`   |
| Get import suggestions          | `getSuggestionsForSymbol(name)`, `getSuggestionsForMethod(name)`     | `core/import-suggestions.ts` |
| Register export for suggestions | `registerExport(symbol)`                                             | `core/import-suggestions.ts` |
| Emit rich diagnostic            | `DiagnosticBuilder(descriptor, sourceFile, emitter).at(node).emit()` | `core/diagnostics.ts`        |

---

## When Adding Features

1. **Check PHILOSOPHY.md** for design principles
2. **Check [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the compilation pipeline overview
3. **Check existing macros** in `src/macros/` for patterns to follow
4. **Reuse `specialize.ts`** infrastructure for inlining
5. **Use `quote()`** for AST construction instead of raw `factory` calls
6. **Add tests** in `tests/` directory
7. **Update docs** if user-facing

## When Adding Packages

1. **Always declare `devDependencies`** — don't rely on hoisting (`vitest`, `typescript`, etc.)
2. **Create `vitest.config.ts`** with a project name matching the package name
3. **Add JSDoc comments** on every exported type, interface, and function — follow `@typesugar/fp` as the standard
4. **All imports must be at the top of the file** — no mid-file imports
5. **Re-export everything from `index.ts`** — including derived operations, not just core types
6. **Don't export dead code** — if a type-level function or type has no instances, don't export it

## Package Boundaries

Understanding what goes where prevents architecture confusion:

| Package                  | Contents                                                                                                               | Does NOT contain              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `@typesugar/typeclass`   | Machinery: `@typeclass`, `@instance`, `@deriving`, `summon`, `extend`, `specialize`, `defineExpressionMacro`           | Typeclass definitions         |
| `@typesugar/std`         | Standard typeclasses (Eq, Ord, Show, Semigroup, FlatMap), built-in type extensions, `let:/yield:` do-notation, `match` | FP data types                 |
| `@typesugar/fp`          | FP data types (Option, Either, IO, List, etc.) and their typeclass instances                                           | General-purpose utilities     |
| `@typesugar/collections` | Collection typeclass hierarchy (IterableOnce, Iterable, Seq, MapLike, SetLike)                                         | Data type implementations     |
| `@typesugar/hlist`       | Heterogeneous lists with compile-time type tracking, labeled HList, map/fold operations                                | Typeclass instances           |
| `@typesugar/parser`      | PEG grammar DSL, parser combinators, tagged template macro                                                             | Compile-time code gen         |
| `@typesugar/fusion`      | Single-pass lazy iterator pipelines, element-wise vec operations                                                       | Matrix operations             |
| `@typesugar/graph`       | Graph construction/algorithms (topo sort, SCC, Dijkstra), state machine definition/verification                        | Visual rendering              |
| `@typesugar/erased`      | Typeclass-based type erasure, vtable dispatch, capability widen/narrow                                                 | Typeclass definitions         |
| `@typesugar/codec`       | Versioned schema builder, JSON/binary codecs, migration chain generation                                               | Transport/network layer       |
| `@typesugar/named-args`  | Named argument wrappers, builder pattern for complex functions                                                         | Call-site rewriting (Phase 2) |
| `@typesugar/geometry`    | Points, vectors, transforms with coordinate system and dimension safety                                                | Physics simulation            |

**Key clarifications:**

- `match` is a general-purpose control flow primitive — it belongs in `std`, not `fp`
- `@typesugar/typeclass` provides the machinery to define typeclasses, but the typeclasses themselves live in `std`
- Extensions on built-in types (`number`, `string`, `Array`) go in `std`
- `@typesugar/hlist` does NOT depend on Generic/macros — it's a peer, not a dependency
- `@typesugar/fusion`'s `lazy()` is always single-pass — it MUST NOT create intermediate arrays
- `@typesugar/geometry` types (Point, Vector) are branded arrays — brands are type-only, zero runtime cost

### `@derive` vs `@deriving` vs Auto-derivation

| Mechanism                    | What it does                                                             | When to use                                  |
| ---------------------------- | ------------------------------------------------------------------------ | -------------------------------------------- |
| `@derive(TC)`                | Generates standalone functions                                           | Rarely — doesn't integrate with `summon`     |
| `@deriving(TC)`              | Integrates with typeclass system, supports `summon()` and `specialize()` | When explicit derivation is needed           |
| Auto-derivation via `summon` | Automatically synthesizes instances for product/sum types                | **Preferred** when all fields have instances |

**Favor auto-derivation**: when a type's fields all have the required instances, prefer letting `summon` auto-derive rather than requiring explicit annotations. Users should not need to annotate types that can be derived automatically.

---

## Code Quality Checklist

Before considering any code complete, verify:

### `undefined` handling in collections/maps

- **Never use `!== undefined` to check if a key exists** — the value might legitimately be `undefined`
- Use `has()` / `contains()` for existence checks, then `get()` for retrieval
- This applies to: `getOrElse`, `mapValues`, `filterKeys`, `filterValues`, `foldEntries`, and any operation that iterates over entries

### HKT soundness

- Every `interface FooF { _: ... }` type-level function MUST use `this["_"]` in its `_` property
- If `$<FooF, string>` and `$<FooF, number>` resolve to the same type, the encoding is phantom/unsound
- Unsound HKT types must NOT implement typeclasses that change the element type (Functor, Monad, etc.)

### Performance

- `partition` must be single-pass — never filter twice
- Lazy views should track operation counts in tests to verify laziness
- Builder types must have correct generic types — no `as unknown as` casts to fix type mismatches

### Consistency

- Name operations consistently across typeclasses — if both `Seq` and `MapLike` have `updated`, disambiguate in standalone ops (e.g., `mapUpdated`)
- Bridge modules should cover ALL relevant typeclasses from the target package, not just a subset
- Every derived operation should be re-exported from the package's `index.ts`

---

## Error Investigation

When encountering errors during build/test, **investigate properly before declaring them "pre-existing"**.

### Before claiming an error is pre-existing

1. **Check file overlap**: Did your changes touch the same file? Same module? Same type signatures?
2. **Check import chains**: Did you modify something the erroring file imports?
3. **Check recent git history**: Was this file working in the last commit?

### Accumulated errors are your responsibility

If errors have accumulated across multiple sessions (especially HKT type errors in `@typesugar/fp` or `@typesugar/collections`), they ARE the responsibility of the current session. Don't defer indefinitely.

### Type errors that break packages

Type errors that make a package **unusable** (can't import, can't typecheck) must be:

1. **Fixed** in the current session, OR
2. **Explicitly escalated** to the user with a clear description

Never silently skip type errors with comments like "pre-existing, will fix later."

---

## Testing Guidelines

### No hardcoded timing thresholds

Never use hardcoded timing thresholds in benchmark tests:

```typescript
// WRONG — machine-dependent, CI-flaky
expect(stats.medianMs).toBeLessThan(500);

// BETTER — relative comparison
expect(optimizedTime).toBeLessThan(baselineTime * 1.5);

// BEST — skip timing tests in CI entirely
if (!process.env.CI) {
  expect(stats.medianMs).toBeLessThan(500);
}
```

### TypeScript version compatibility

`node.getText()` on synthetic nodes throws on TS < 5.8: "Node must have a real position for this operation."

Use alternatives:

- `ts.getTextOfNode(node)` — works on synthetic nodes
- Print the node with a printer: `ts.createPrinter().printNode(...)`

### Verify API names before testing

When tests reference API names, verify the actual export names first — don't guess:

- `nel` vs `nelOf`
- `semigroupString` vs `stringSemigroup`
- `eitherMonad` vs `monadEither`

Check the package's `index.ts` to see what's actually exported.

---

## Preprocessor Guidelines (`@typesugar/preprocessor`)

The preprocessor handles custom syntax (`F<_>` HKT, `|>` pipeline, `::` cons) that TypeScript cannot parse. It runs **before** the AST exists, doing text-level rewriting so tools like esbuild/vitest can parse the output.

### No Dead Code in Exports

Every symbol exported from `index.ts` must have at least one consumer in the codebase. If designing for future extensibility, mark internal types with `@internal` JSDoc and do not export from `index.ts`. Dead exports accumulate maintenance burden and confuse users.

### No Duplicate Utility Functions

Shared helpers (like `isBoundaryToken`) must live in **one file** and be imported. Duplicating logic across files means divergence bugs — one copy gets fixed, others don't. Hoist hot-path allocations (like `new Set(...)`) to module scope.

### Preprocessor Custom Operators

The preprocessor handles **non-JS operators** (`|>`, `::`, `<|`) via text rewriting to `__binop__()` calls.

For standard JS operators (`+`, `-`, `*`, `/`, `===`, etc.), see the **Operators** section above — those use the `Op<>` typeclass system at AST level.

**Validation rules (to prevent overlap):**

- `@operator(symbol)` decorator must **reject** symbols in `OPERATOR_SYMBOLS` (from `core/types.ts`) — use `Op<>` for those
- The `__binop__` macro should check both `methodOperatorMappings` and `syntaxRegistry` and emit an ambiguity error if both match

### Scanner Must Respect File Type

The scanner wraps `ts.createScanner`, which needs the correct `LanguageVariant`:

- `.tsx` / `.jsx` → `LanguageVariant.JSX`
- `.ts` / `.js` → `LanguageVariant.Standard`

The `preprocess()` function must accept a `fileName` parameter and thread it through to `tokenize()`. Integrations (unplugin, ESLint processor) must pass the filename.

Without this, JSX elements like `<Component>` are tokenized as comparison operators, causing false `|>` merges and incorrect bracket matching.

### Text-Level Rewriting Rules

The preprocessor operates on text before AST construction. This imposes constraints:

1. **Never change line count** — keep source maps simple (line N in output = line N in input, plus column offsets)
2. **Expression contexts only** — custom operators must not be rewritten in type annotations (e.g., `type P = A |> B` is invalid)
3. **Preserve structure** — the output must be valid TypeScript that parses to the intended AST

Before rewriting a custom operator, check context: scan left for `:`, `extends`, `type ... =`, `<` (generic args). If found, skip rewriting.

### Source Maps Are Mandatory

Any text transformation must produce a usable source map. Use `magic-string` for replacements — it generates standard VLQ source maps automatically.

**Never return `map: null`** from a build plugin. Error locations, stack traces, and debugger breakpoints depend on accurate source maps.

### Language Service Plugin

There must be exactly **one canonical implementation** at `packages/transformer/src/language-service.ts`.

The legacy file `src/language-service/index.ts` must be a thin re-export:

```typescript
export { default } from "@typesugar/transformer/language-service";
```

Do not duplicate the 700+ lines of language service code.

### Unplugin Type-Checker Limitation

When unplugin preprocesses a file, it creates a fresh `ts.SourceFile` disconnected from the `ts.Program`. The type checker cannot resolve types for this file, which means:

- `@operator` dispatch on custom types **falls back to default semantics** (e.g., `|>` becomes `f(a)`)
- Type-aware `__binop__` resolution requires **ts-patch**, not unplugin

Document this limitation in code comments and the preprocessor README.

---

## Workflow

### Completing Tasks

When you finish implementing a feature or fix, **you are not done until you commit**.

A commit is your guarantee that:

1. **Build passes** — `pnpm build` succeeds
2. **Tests pass** — `pnpm test` (or relevant subset) succeeds
3. **Lints pass** — no new lint errors introduced
4. **Documentation updated** — if the change affects user-facing behavior
5. **CI passes** — after pushing, verify the CI run succeeds

Do not stop at "tests pass locally" and wait for the user to ask about committing. The full workflow is:

```
Implement → Build → Test → Lint → Document → Commit → Push → Verify CI
```

If any step fails after commit, fix it and amend or create a follow-up commit.

### What "Done" Means

When you say a task is complete:

- All verification steps above have passed
- Changes are committed with a clear message
- CI is green (or you're actively watching it)

If you cannot complete a step (e.g., CI is slow, needs user input), explicitly say so rather than marking the task done.

## GitHub Account

Use `dpovey` (personal account) for this repo.
