# Package Reference

All typesugar packages with their exports.

## Core

### @typesugar/transformer

The TypeScript transformer that expands macros.

```bash
npm install --save-dev @typesugar/transformer
```

**Exports:**

- Default export: transformer factory
- CLI: `typesugar` command

### @typesugar/core

Macro registration and types.

```bash
npm install @typesugar/core
```

**Exports:**

```typescript
// Registration
defineExpressionMacro;
defineAttributeMacro;
defineDeriveMacro;
defineTaggedTemplateMacro;
defineTypeMacro;
defineLabeledBlockMacro;

// Types
MacroContext;
MacroDefinition;
DeriveTypeInfo;
ComptimeValue;

// Configuration
config;
cfg;
cfgAttr;

// Diagnostics (Rust/Elm-style error messages)
DiagnosticBuilder;
DiagnosticCategory;
DiagnosticDescriptor;
RichDiagnostic;
renderDiagnosticCLI;
DIAGNOSTIC_CATALOG;
TS9001 - TS9999; // Error descriptors

// Resolution Scope
globalResolutionScope;
ResolutionScopeTracker;
scanImportsForScope;
isInOptedOutScope;
hasInlineOptOut;

// Import Suggestions
getExportIndex;
getSuggestionsForSymbol;
getSuggestionsForMethod;
getSuggestionsForTypeclass;
getSuggestionsForMacro;
formatSuggestionsMessage;
generateImportFix;
```

### unplugin-typesugar

Bundler plugins for Vite, Webpack, esbuild, Rollup.

```bash
npm install --save-dev unplugin-typesugar
```

**Exports:**

```typescript
import typesugar from "unplugin-typesugar/vite";
import typesugar from "unplugin-typesugar/webpack";
import typesugar from "unplugin-typesugar/esbuild";
import typesugar from "unplugin-typesugar/rollup";
```

### typesugar

Umbrella package including all common packages.

```bash
npm install typesugar
```

Includes: core, comptime, derive, reflect, operators, typeclass, specialize.

## Macros

### @typesugar/comptime

Compile-time evaluation.

```bash
npm install @typesugar/comptime
```

**Exports:**

```typescript
comptime;
```

### @typesugar/derive

Auto-derive implementations.

```bash
npm install @typesugar/derive
```

**Exports:**

```typescript
derive;
(Eq, Ord, Clone, Debug, Hash, Default, Json, Builder, TypeGuard);
(deriveIgnore, deriveWith);
```

### @typesugar/reflect

Type reflection.

```bash
npm install @typesugar/reflect
```

**Exports:**

```typescript
reflect(decorator);
typeInfo<T>();
fieldNames<T>();
validator<T>();
```

### @typesugar/operators

Operator overloading.

```bash
npm install @typesugar/operators
```

**Exports:**

```typescript
operators(decorator);
ops();
pipe();
compose();
```

### @typesugar/typeclass

Scala 3-style typeclasses.

```bash
npm install @typesugar/typeclass
```

**Exports:**

```typescript
typeclass (decorator)
instance (decorator)
deriving (decorator)
summon<T>()
summonAll<...>()
extend()
implicits (decorator)
```

### @typesugar/specialize

Zero-cost specialization.

```bash
npm install @typesugar/specialize
```

**Exports:**

```typescript
specialize();
```

## Domain-Specific

### @typesugar/sql

Type-safe SQL.

```bash
npm install @typesugar/sql
```

**Exports:**

```typescript
sql (tagged template)
raw()
```

### @typesugar/strings

String validation macros.

```bash
npm install @typesugar/strings
```

**Exports:**

```typescript
regex (tagged template)
html (tagged template)
json (tagged template)
```

### @typesugar/units

Physical units.

```bash
npm install @typesugar/units
```

**Exports:**

```typescript
units (tagged template)
```

### @typesugar/contracts

Design by contract.

```bash
npm install @typesugar/contracts
```

**Exports:**

```typescript
requires (labeled block)
ensures (labeled block)
invariant (decorator)
old()
assert()
configure()
```

### @typesugar/contracts-z3

Z3 SMT solver integration.

```bash
npm install @typesugar/contracts-z3
```

**Exports:**

```typescript
prove();
```

### @typesugar/contracts-refined

Refinement types.

```bash
npm install @typesugar/contracts-refined
```

**Exports:**

```typescript
Refined<T, P>;
(Positive, Negative, NonZero);
(NonEmpty, MaxLength, MinLength);
// ... more predicates
```

## Functional Programming

### @typesugar/fp

FP utilities.

```bash
npm install @typesugar/fp
```

**Exports:**

```typescript
// Option
(Option, Some, None);

// Result
(Result, Ok, Err);

// Either
(Either, Left, Right);

// Validated
(Validated, Valid, Invalid);

// IO
IO;

// List
(List, Cons, Nil);

// Pattern matching
match;

// Typeclasses
(Functor, Applicative, Monad);
(Semigroup, Monoid);
(Eq, Ord, Show);
```

### @typesugar/std

Standard library extensions.

```bash
npm install @typesugar/std
```

**Exports:**

```typescript
// Extension methods
(NumberExt, StringExt, ArrayExt);
extend();
registerExtensions();

// FlatMap for do-notation
FlatMap;
registerFlatMap();
```

### @typesugar/type-system

Advanced types.

```bash
npm install @typesugar/type-system
```

**Exports:**

```typescript
// HKT
($, Kind);

// Newtype
(Newtype, newtype);

// Phantom types
Phantom;

// Refinement
Refined;
```

## Adapters

### @typesugar/effect

Effect-TS integration.

```bash
npm install @typesugar/effect
```

### @typesugar/kysely

Kysely integration.

```bash
npm install @typesugar/kysely
```

**Exports:**

```typescript
kyselySql;
```

### @typesugar/react

React macros.

```bash
npm install @typesugar/react
```

## Tooling

### @typesugar/testing

Testing utilities.

```bash
npm install --save-dev @typesugar/testing
```

**Exports:**

```typescript
expandCode();
expandMacro();
assertExpands();
```

### @typesugar/eslint-plugin

ESLint plugin with processor for typesugar files.

```bash
npm install --save-dev @typesugar/eslint-plugin
```

**Exports:**

```typescript
configs.recommended;
configs.full;
configs.strict;
processor; // Transforms typesugar syntax before linting
```

**Features:**

- Transforms macro syntax before ESLint sees it (prevents false positives)
- Automatically filters "unused import" errors for typesugar packages
- Maps error locations back to original source

### @typesugar/vscode

VSCode extension (install from marketplace).

### @typesugar/preprocessor

Lexical preprocessor for custom syntax.

```bash
npm install --save-dev @typesugar/preprocessor
```

**Exports:**

```typescript
preprocess();
```

## C++ / Boost Inspired {#cpp-inspired}

### @typesugar/hlist {#hlist}

Heterogeneous lists with compile-time type tracking. Inspired by Boost.Fusion/Hana.

```bash
npm install @typesugar/hlist
```

**Key exports:**

- `hlist()` — construct an HList
- `head()`, `tail()`, `last()`, `init()`, `at()` — element access
- `append()`, `prepend()`, `concat()`, `reverse()`, `zip()`, `splitAt()` — operations
- `labeled()`, `get()`, `set()`, `project()`, `merge()` — labeled HList
- `map()`, `foldLeft()`, `forEach()` — higher-order operations

[Guide](/guides/hlist) · [README](https://github.com/dpovey/typesugar/tree/main/packages/hlist)

### @typesugar/parser {#parser}

Compile-time parser generation from PEG grammars and programmatic combinators. Inspired by Boost.Spirit.

```bash
npm install @typesugar/parser
```

**Key exports:**

- `` grammar`...` `` — PEG grammar tagged template
- `literal()`, `char()`, `charRange()`, `regex()` — primitive parsers
- `seq()`, `alt()`, `many()`, `many1()`, `optional()`, `not()` — combinators
- `map()`, `sepBy()`, `between()`, `lazy()` — composition
- `digit()`, `integer()`, `float()`, `quotedString()` — convenience

[Guide](/guides/parser) · [README](https://github.com/dpovey/typesugar/tree/main/packages/parser)

### @typesugar/fusion {#fusion}

Single-pass iterator fusion and array expression templates. Inspired by Blitz++ and Rust iterators.

```bash
npm install @typesugar/fusion
```

**Key exports:**

- `lazy()` — create a fused iterator pipeline
- `.map()`, `.filter()`, `.flatMap()`, `.take()`, `.drop()` — pipeline operations
- `.toArray()`, `.reduce()`, `.find()`, `.some()`, `.every()` — terminal operations
- `range()`, `iterate()`, `repeat()`, `generate()` — source generators
- `vec()`, `add()`, `sub()`, `mul()`, `dot()` — element-wise vector operations

[Guide](/guides/fusion) · [README](https://github.com/dpovey/typesugar/tree/main/packages/fusion)

### @typesugar/graph {#graph}

Graph algorithms and state machine verification. Inspired by Boost.Graph.

```bash
npm install @typesugar/graph
```

**Key exports:**

- `createDigraph()`, `createGraph()` — construction
- `` digraph`...` `` — DSL construction
- `topoSort()`, `bfs()`, `dfs()`, `reachable()`, `shortestPath()`, `dijkstra()` — algorithms
- `stronglyConnectedComponents()`, `detectCycles()`, `isDAG()` — structural analysis
- `defineStateMachine()`, `verify()`, `createInstance()` — state machines

[Guide](/guides/graph) · [README](https://github.com/dpovey/typesugar/tree/main/packages/graph)

### @typesugar/erased {#erased}

Typeclass-based type erasure for heterogeneous collections. Inspired by Rust's `dyn Trait`.

```bash
npm install @typesugar/erased
```

**Key exports:**

- `eraseWith()` — create an erased value with explicit vtable
- `showable()`, `equatable()`, `showableEq()` — convenience constructors
- `show()`, `equals()`, `compare()`, `hash()`, `clone()` — dispatch functions
- `widen()`, `narrow()`, `hasCapability()` — capability management
- `mapErased()`, `sortErased()`, `dedup()`, `groupByHash()` — collection ops

[Guide](/guides/erased) · [README](https://github.com/dpovey/typesugar/tree/main/packages/erased)

### @typesugar/codec {#codec}

Versioned codec generation with schema evolution. Inspired by serde, Boost.Serialization, Protocol Buffers.

```bash
npm install @typesugar/codec
```

**Key exports:**

- `schema()` — fluent schema builder with version annotations
- `createJsonCodec()` — JSON codec with version migration
- `createBinaryCodec()` — binary codec with explicit field layouts
- `defineSchema()`, `validateSchema()` — schema definition and validation
- `generateMigrations()` — auto-generate migration chain

[Guide](/guides/codec) · [README](https://github.com/dpovey/typesugar/tree/main/packages/codec)

### @typesugar/named-args {#named-args}

Named function arguments with compile-time validation. Inspired by Kotlin, Swift, Boost.Parameter.

```bash
npm install @typesugar/named-args
```

**Key exports:**

- `namedArgs()` — wrap a function for named argument calling
- `callWithNamedArgs()` — call with an object of named arguments
- `createBuilder()` — builder pattern for many-param functions
- `NamedArgsError` — structured error type

[Guide](/guides/named-args) · [README](https://github.com/dpovey/typesugar/tree/main/packages/named-args)

### @typesugar/geometry {#geometry}

Type-safe geometry with coordinate system and dimension safety. Inspired by Boost.Geometry.

```bash
npm install @typesugar/geometry
```

**Key exports:**

- `point2d()`, `point3d()`, `vec2()`, `vec3()` — Cartesian constructors
- `polar()`, `spherical()`, `cylindrical()` — other coordinate systems
- `translate()`, `distance()`, `dot()`, `cross()`, `normalize()` — operations
- `cartesianToPolar()`, `sphericalToCartesian()`, etc. — conversions
- `rotation2d()`, `translation3d()`, `compose()`, `applyToPoint()` — transforms

[Guide](/guides/geometry) · [README](https://github.com/dpovey/typesugar/tree/main/packages/geometry)

## Peer Dependencies

Most packages have:

- `typescript: >=5.0.0`
- `@typesugar/transformer: >=0.1.0` (peer)

Check each package's package.json for specifics.
