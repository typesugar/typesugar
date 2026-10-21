# Package Reference

All typesugar packages organized by category.

Packages marked 🧊 **Frozen** ([PEP-048](https://github.com/typesugar/typesugar/blob/main/peps/PEP-048-package-triage.md)) are still published to npm and build, but are not under active development and are not part of typesugar's actively-maintained surface.

## Build Infrastructure

### typesugar {#typesugar}

Umbrella package. Its root (`typesugar`) is runtime-only: the macro placeholders
users import (`comptime`, `derive` and the derive markers, `summon`, `derived`, `implicit`,
`typeInfo`, `cfg`, `includeStr`, `tailrec`, `defineConfig`, …). The macro-authoring
APIs are at `typesugar/core`, and `typesugar/vite`, `/webpack`, `/esbuild`,
`/rollup`, `/tsup` (`withTypesugar`) and `/transformer` re-export the build integrations;
`typesugar/register` is the Node loader (`node --import typesugar/register`). It depends on core,
macros, transformer, reflect, derive, typeclass, type-system and unplugin-typesugar;
install `@typesugar/std` separately for the standard typeclasses and syntax imports.

```bash
npm install typesugar @typesugar/std
```

**Inspired by:** Umbrella packages (Lodash, Effect)

### @typesugar/core {#core}

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
defineConfig;
// (the cfg() / @cfgAttr placeholders are exported by `typesugar`, not by core)

// Diagnostics
DiagnosticBuilder;
DiagnosticDescriptor;
renderDiagnosticCLI;

// Resolution Scope
globalResolutionScope;
isInOptedOutScope;
hasInlineOptOut;

// Import Suggestions
getSuggestionsForSymbol;
getSuggestionsForMethod;
```

### @typesugar/macros {#macros}

Built-in macro implementations. Internal package — most users should import from `typesugar` or specific feature packages.

```bash
npm install @typesugar/macros
```

**Exports:**

```typescript
// Typeclass System
instanceScanner;
resolveInstance;

// Derive Infrastructure
defineCustomDerive;
defineFieldDerive;

// Quasiquoting (string-based; prefer ctx.factory)
(quote, quoteStatements, quoteType, ident, raw, spread);

// Extension Methods
extensionAttribute; // @extension decorator
// "use extension" directive (file-level)

// And many more internal implementations...
```

**Inspired by:** Rust macro system, Scala 3 metaprogramming

### @typesugar/transformer {#transformer}

The TypeScript transformer that expands macros.

```bash
npm install --save-dev @typesugar/transformer
```

**Exports:**

- Default export: transformer factory
- CLI: `typesugar` command
- `emitDeclarations({ project, declarationDir })`: `.d.ts` files from the expanded program
  (`typesugar build --emitDeclarationOnly` as a function)
- `@typesugar/transformer/register`: the Node loader, `node --import @typesugar/transformer/register`
  ([Node.js guide](/getting-started/environments/node))

### unplugin-typesugar {#unplugin}

Bundler plugins for Vite, Webpack, esbuild, Rollup, and a tsup config helper.

```bash
npm install --save-dev unplugin-typesugar
```

**Exports:**

```typescript
import typesugar from "unplugin-typesugar/vite";
import typesugar from "unplugin-typesugar/webpack";
import typesugar from "unplugin-typesugar/esbuild";
import typesugar from "unplugin-typesugar/rollup";
import { withTypesugar } from "unplugin-typesugar/tsup"; // defineConfig(withTypesugar({ ..., dts: true }))
```

### @typesugar/ts-plugin {#ts-plugin}

TypeScript language service plugin: typesugar's single editor engine for 1.0. It is a thin
wrapper around `@typesugar/transformer/language-service`, which is what most projects list in
`tsconfig.json` (with `@typesugar/transformer` as a direct devDependency); the VS Code extension
bundles this wrapper.

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "@typesugar/transformer/language-service" }]
  }
}
```

Diagnostics, completions, hover, go-to-definition, references, rename and quick fixes work
through macro expansions in any tsserver-based editor. See
[Editor Setup](/getting-started/editor-setup).

---

## Developer Experience

### @typesugar/vscode {#vscode}

VS Code / Cursor extension. It bundles and registers the TypeScript server plugin
([`@typesugar/ts-plugin`](#ts-plugin)), which provides all language features, and adds:

- **typesugar: Expand Macro at Cursor** and **typesugar: Show Transformed Source** commands
- Macro-expansion inlay hints (from the plugin)
- Syntax highlighting for `let:`/`yield:` blocks, the `<<` bind operator and `comptime`
- The `typesugar.comptimeInEditor` setting (trusted workspaces only)

See [Editor Setup](/getting-started/editor-setup#vs-code-cursor).

### @typesugar/eslint-plugin {#eslint-plugin}

ESLint plugin with processor for typesugar files.

```bash
npm install --save-dev @typesugar/eslint-plugin
```

**Exports:**

```typescript
configs.recommended; // single flat-config objects: use `[typesugar.configs.recommended]`
configs.full;
configs.strict;
processors.typesugar;
processors["typesugar-full"];
```

### @typesugar/testing {#testing}

Power assertions, property-based testing, and a macro test context.

```bash
npm install --save-dev @typesugar/testing
```

**Exports:**

```typescript
assert(); // Power assertion with sub-expression capture
staticAssert(); // Compile-time assertion
typeAssert<T>(); // Type-level assertion
testCases(); // Parameterized tests
forAll(); // Property-based testing
assertSnapshot(); // Source-capturing snapshots

// "@typesugar/testing/macros"
createMacroTestContext(); // MacroContext for unit-testing an expand() function
```

**Inspired by:** Power Assert (JS), QuickCheck (Haskell), proptest (Rust)

[Guide](/guides/testing)

---

## Standard Library

### @typesugar/std {#std}

Standard library extensions: typeclasses, extension methods, pattern matching, do-notation.

```bash
npm install @typesugar/std
```

**Exports:**

```typescript
// Extension methods (import functions, call as methods)
(abs, ceil, floor, sqrt, clamp, isEven, isPrime); // number
(capitalize, truncate, words); // string
(head, tail, chunk, unique, arrayGroupBy); // array

// Pattern matching — fluent API (PEP-008)
match(); // Fluent: match(v).case(...).then(...).else(...)
MatchError; // Runtime error when no pattern matches (extends Error, has .value)
Destructure; // typeclass behind extractor patterns: case Some(v), case Point(x, y)
(FluentMatch, FluentMatchCase, FluentMatchArms); // types of the fluent chain, for plain tsc
// Statement form: `match: switch (x) { ... }`, activated by import "@typesugar/std/syntax/match"

// FlatMap for do-notation — built-in instances (flatMapArray, flatMapPromise,
// flatMapIterable, flatMapAsyncIterable) come with the
// "@typesugar/std/syntax/do" marker import; custom types declare
// @impl-tagged instances (scope-based resolution, PEP-052)
FlatMap;

// Standard typeclasses
(Eq, Ord, Hash, Semigroup, Monoid);

// Syntax activation (PEP-052): import "@typesugar/std/syntax/<tc>" for method
// syntax, "@typesugar/std/syntax/<tc>/ops" for operators, ".../syntax/do" for let:/par:

// Hash instances and combinators
(hashNumber, hashString, hashBoolean, hashBigInt, hashDate);
(makeHash, hashBy, hashArray);
```

**Inspired by:** Scala 3 extension methods, Rust derives, Kotlin stdlib

[Extension Methods Guide](/guides/extension-methods) · [Pattern Matching Guide](/guides/pattern-matching) · [Do-Notation Guide](/guides/do-notation) · [Standard Typeclasses Guide](/guides/std-typeclasses)

---

## Typeclasses & Derivation

### @typesugar/typeclass {#typeclass}

Scala 3-style typeclasses with implicit resolution.

```bash
npm install @typesugar/typeclass
```

**Exports:**

```typescript
typeclass(); // decorator
instance(); // decorator
derive(); // decorator (generates typeclass instances)
summon<T>();
derived<T>(); // export const cloneFeature = derived<Clone<Feature>>(): an instance for a type you don't own
extend(value).method(); // a call form: extend(p).show() → showPoint.show(p); not storable
implicit(); // default parameter marker
```

**Inspired by:** Scala 3 typeclasses, Haskell typeclasses

[Guide](/guides/typeclasses)

### @typesugar/derive {#derive}

Auto-derive implementations from type structure.

```bash
npm install @typesugar/derive
```

**Exports:**

```typescript
derive(); // decorator
(Eq, Ord, Clone, Debug, Hash, Default, Json, TypeGuard);
(defineCustomDerive, defineFieldDerive); // custom derives
```

**Inspired by:** Rust derive macros

[Guide](/guides/derive)

### @typesugar/reflect {#reflect}

Compile-time type reflection.

```bash
npm install @typesugar/reflect
```

**Exports:**

```typescript
reflect(); // decorator
typeInfo<T>();
fieldNames<T>();
validator<T>();
```

**Inspired by:** Zig @typeInfo, Rust proc_macro

[Guide](/guides/reflect)

---

## Syntax Sugar

### @typesugar/strings {#strings}

> 🧊 **Frozen.** Not under active development.

String validation macros with compile-time checking.

```bash
npm install @typesugar/strings
```

**Exports:**

```typescript
regex`...`; // tagged template
html`...`; // tagged template
raw`...`; // tagged template
fmt`...`; // tagged template
```

[Guide](/guides/strings)

## Type Safety & Contracts

### @typesugar/type-system {#type-system}

Advanced type system extensions.

```bash
npm install @typesugar/type-system
```

**Exports:**

```typescript
// HKT
(Kind, _, TypeFunction, ArrayF, PromiseF);

// Newtype
(Newtype, wrap, unwrap, newtypeCtor);

// Refinement (types; build values with the refinement helpers, not a `refine` macro)
Refined;
(Positive, NonNegative, Int, Byte, Port);
(NonEmpty, Email, Url, Uuid);

// Vec
Vec;

// Type-level arithmetic
(Add, Sub, Mul, Div, Pow);
```

**Inspired by:** Haskell/ML type systems, Scala 3 opaque types

[Guide](/guides/type-system)

### @typesugar/contracts {#contracts}

Design by contract with compile-time verification.

```bash
npm install @typesugar/contracts
```

**Exports:**

```typescript
requires:; // labeled block
ensures:; // labeled block
invariant(); // decorator
old();
(setContractConfig, getContractConfig);
(PreconditionError, PostconditionError, InvariantError);
```

**Inspired by:** Eiffel contracts, Coq proofs

[Guide](/guides/contracts)

### @typesugar/contracts-refined {#contracts-refined}

Refinement type integration for contracts.

```bash
npm install @typesugar/contracts-refined
```

**Exports:**

```typescript
registerRefinementPredicate();
getRegisteredPredicates();
```

[Guide](/guides/contracts-refined)

### @typesugar/validate {#validate}

Zero-cost validation and schema macros.

```bash
npm install @typesugar/validate
```

**Exports:**

```typescript
is<T>(); // type guard
assert<T>(); // assertion (also exported as assertType<T>())
validate<T>(); // validation with error accumulation
nativeSchema; // Schema instance for the native validators
```

**Inspired by:** Zod, io-ts

[Guide](/guides/validate)

### @typesugar/units {#units}

> 🧊 **Frozen.** Not under active development.

Type-safe physical units with dimensional analysis.

```bash
npm install @typesugar/units
```

**Exports:**

```typescript
// Unit class with .add(), .sub(), .mul(), .div(), .to(), .scale(), .equals()
Unit;

// Constructors
(meters, kilometers, centimeters, millimeters, feet, inches, miles);
(kilograms, grams, milligrams, pounds);
(seconds, minutes, hours, days, milliseconds);
(metersPerSecond, kilometersPerHour, milesPerHour);
(newtons, joules, kilojoules, watts, kilowatts);
(kelvin, celsius, pascals, kilopascals, atmospheres);
units`...`; // tagged template

// Dimension types
(Length, Mass, Time, Velocity, Force, Energy, Power, Pressure, Temperature);
(MulDimensions, DivDimensions, SameDimensions);
```

**Inspired by:** Boost.Units, F# Units of Measure

[Guide](/guides/units)

---

## Data Structures & Algorithms

### @typesugar/fp {#fp}

Functional programming data types.

```bash
npm install @typesugar/fp
```

**Exports:**

```typescript
// Option (null-based, zero-cost). The Option/Either/List namespace values are
// at "@typesugar/fp/data"; the root exports the constructors and types.
(Option, Some, None);

// Either
(Either, Left, Right);

// Validated
(Validated, Valid, Invalid);

// IO
IO;

// List
(List, Cons, Nil);

// Typeclasses
(Functor, Applicative, Monad);
(Semigroup, Monoid);
(Eq, Ord, Show);

// Destructure instances for the constructors, so match(o).case(Some(v)) works
(destructureSome, destructureNone, destructureLeft, destructureRight);
(destructureCons, destructureNil, destructureValid, destructureInvalid);
```

**Inspired by:** Scala fp-ts, Haskell Prelude

[Guide](/guides/fp)

### @typesugar/fusion {#fusion}

Single-pass iterator fusion and expression templates.

```bash
npm install @typesugar/fusion
```

**Exports:**

```typescript
lazy();
(range(), iterate(), repeat(), generate());
(vec(), add(), sub(), mul(), dot());
```

**Inspired by:** Blitz++, Rust iterators

[Guide](/guides/fusion)

### @typesugar/parser {#parser}

> 🧊 **Frozen.** Not under active development.

Compile-time parser generation from PEG grammars.

```bash
npm install @typesugar/parser
```

**Exports:**

```typescript
grammar`...`; // tagged template
(literal(), char(), charRange(), regex());
(seq(), alt(), many(), many1(), optional());
(map(), sepBy(), between(), lazy());
```

**Inspired by:** Boost.Spirit, PEG.js

[Guide](/guides/parser)

### @typesugar/graph {#graph}

Graph algorithms and state machine verification.

```bash
npm install @typesugar/graph
```

**Exports:**

```typescript
(createDigraph(), createGraph());
digraph`...`; // tagged template
(topoSort(), bfs(), dfs(), dijkstra());
(stronglyConnectedComponents(), detectCycles());
(defineStateMachine(), verify());

// GraphLike typeclass
(GraphLike, WeightedGraphLike);
(graphLike, weightedGraphLike);

// Generic algorithms (parameterized over GraphLike + Eq + Hash)
(topoSortG, hasCyclesG, bfsG, dfsG, reachableG, hasPathG, shortestPathG, dijkstraWithG, sccG);
```

**Inspired by:** Boost.Graph

[Guide](/guides/graph)

### @typesugar/erased {#erased}

> 🧊 **Frozen.** Not under active development.

Typeclass-based type erasure for heterogeneous collections.

```bash
npm install @typesugar/erased
```

**Exports:**

```typescript
eraseWith();
(showable(), equatable(), showableEq());
(show(), equals(), compare(), hash(), clone());
(widen(), narrow(), hasCapability());
```

**Inspired by:** Rust dyn Trait

[Guide](/guides/erased)

### @typesugar/codec {#codec}

> 🧊 **Frozen.** Not under active development.

Versioned codecs with schema evolution.

```bash
npm install @typesugar/codec
```

**Exports:**

```typescript
schema();
createJsonCodec();
createBinaryCodec();
generateMigrations();
```

**Inspired by:** serde, Boost.Serialization, Protocol Buffers

[Guide](/guides/codec)

### @typesugar/collections {#collections}

> 🧊 **Frozen.** Not under active development.

Collection typeclasses and hash-based data structures.

```bash
npm install @typesugar/collections
```

**Exports:**

```typescript
// Typeclasses
(IterableOnce, Iterable, Seq, SetLike, MapLike);
(PersistentSetLike, PersistentMapLike, MutableSetLike, MutableMapLike);

// Data structures
(HashSet, HashMap);

// Instances
(arrayIterableOnce, arrayIterable, arraySeq, arraySeqOf);
(nativeSetLike, nativeMutableSetLike, nativeMapLike, nativeMutableMapLike);
(stringIterable, stringSeq);
(hashSetLike, hashMutableSetLike, hashMapLike, hashMutableMapLike);
(mutableSetFor, mutableMapFor);

// Derived operations
(forEach, toArray, find, exists, forAll, count, sum);
(head, last, take, drop, sorted, seqContains);
(union, intersection, difference, isSubsetOf);
(getOrElse, mapValues, filterEntries, mapEntries);
```

**Inspired by:** Scala collections, Haskell Data.Set/Data.Map, Rust std::collections

### @typesugar/math {#math}

> 🧊 **Frozen.** Not under active development.

Math types and typeclasses.

```bash
npm install @typesugar/math
```

**Exports:**

```typescript
(rational(), complex(), bigDecimal());
(matrix(), det(), matMul(), transpose());
(interval(), mod(), polynomial());
(VectorSpace, InnerProduct, Normed);
```

**Inspired by:** Haskell Numeric, Boost.Multiprecision

[Guide](/guides/math)

### @typesugar/mapper {#mapper}

Zero-cost object mapping.

```bash
npm install @typesugar/mapper
```

**Exports:**

```typescript
transformInto<S, T>();
```

**Inspired by:** Scala Chimney

[Guide](/guides/mapper)

---

## Ecosystem Integrations

### @typesugar/effect {#effect}

Effect-TS integration.

```bash
npm install @typesugar/effect effect
```

**Exports:**

```typescript
// Service & Layer (primary)
service(); // decorator
layer(); // decorator
layerMake<R>(); // ZIO-style explicit wiring
resolveLayer<R>(); // implicit wiring from import scope
// "@typesugar/effect/macros": formatDebugTree() — resolved graph visualization

// Derives
(EffectSchema, EffectEqual, EffectHash);

// Extensions
(EffectExt, OptionExt, EitherExt);

// Typeclass instances
(effectFunctor, effectMonad);
```

**Inspired by:** Scala ZIO

[Guide](/guides/effect)

### @typesugar/sql {#sql}

Type-safe SQL tagged templates with ConnectionIO.

```bash
npm install @typesugar/sql
```

**Exports:**

```typescript
sql`...`; // tagged template
(Query, Update, Fragment);
ConnectionIO;
Transactor;
```

**Inspired by:** Scala Doobie

[Guide](/guides/sql)

---

## Peer Dependencies

Most packages have:

- `typescript: >=5.9.0 <7.0.0` (TypeScript 5.9 or 6.x; TypeScript 7 has no JavaScript
  compiler API, see [Troubleshooting](/getting-started/troubleshooting#typescript-7)).
  Packages whose runtime entry never loads TypeScript (fp, validate, contracts,
  collections, codec, fusion, mapper, parser, strings, units, erased, testing and the
  `typesugar` umbrella) mark it optional: a production install doesn't need it, but
  their `./macros` entries still do at build time.
- `@typesugar/transformer: >=0.1.0` (peer)

Check each package's package.json for specifics.
