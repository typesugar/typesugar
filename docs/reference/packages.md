# Package Reference

All typesugar packages organized by category.

## Build Infrastructure

### typesugar {#typesugar}

Umbrella package including all common packages.

```bash
npm install typesugar
```

Includes: core, comptime, derive, reflect, operators, typeclass, specialize.

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
cfg;
cfgAttr;

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
typeclassRegistry;
instanceRegistry;
instanceMethodRegistry;

// Derive Infrastructure  
defineCustomDerive;
defineFieldDerive;
extractTypeInfo;

// Extension Methods
standaloneExtensionRegistry;
registerExtensions;

// Operators
syntaxRegistry;
methodOperatorMappings;

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

### @typesugar/preprocessor {#preprocessor}

Lexical preprocessor for custom syntax (`F<_>`, `|>`).

```bash
npm install --save-dev @typesugar/preprocessor
```

**Exports:**

```typescript
preprocess();
```

**Inspired by:** Zig comptime

### unplugin-typesugar {#unplugin}

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

### @typesugar/ts-plugin {#ts-plugin}

TypeScript language service plugin for IDE integration.

```bash
npm install --save-dev @typesugar/ts-plugin
```

Enables type-aware transformation, diagnostics, go-to-definition, completions, and hover info for typesugar syntax in any TypeScript editor.

---

## Developer Experience

### @typesugar/vscode {#vscode}

VSCode/Cursor extension (install from marketplace).

- Syntax highlighting for custom syntax
- Inline expansion previews
- Go-to-definition for macro-generated code
- Error lens integration

### @typesugar/eslint-plugin {#eslint-plugin}

ESLint plugin with processor for typesugar files.

```bash
npm install --save-dev @typesugar/eslint-plugin
```

**Exports:**

```typescript
configs.recommended;
configs.full;
configs.strict;
processor;
```

### @typesugar/prettier-plugin {#prettier-plugin}

Prettier formatting for custom syntax.

```bash
npm install --save-dev @typesugar/prettier-plugin
```

### @typesugar/testing {#testing}

Power assertions, property-based testing, macro testing.

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
// Extension methods
(NumberExt, StringExt, ArrayExt, ObjectExt, DateExt);
extend();
registerExtensions();

// Pattern matching
match();

// FlatMap for do-notation
FlatMap;
registerFlatMap();

// Standard typeclasses
(Eq, Ord, Show, Semigroup, Monoid);
```

**Inspired by:** Scala 3 extension methods, Rust derives, Kotlin stdlib

[Extension Methods Guide](/guides/extension-methods) · [Pattern Matching Guide](/guides/match) · [Do-Notation Guide](/guides/do-notation) · [Standard Typeclasses Guide](/guides/std-typeclasses)

---

## Typeclasses & Derivation

### @typesugar/typeclass {#typeclass}

Scala 3-style typeclasses with implicit resolution.

```bash
npm install @typesugar/typeclass
```

**Exports:**

```typescript
typeclass();  // decorator
instance();   // decorator
deriving();   // decorator
summon<T>();
summonAll<...>();
extend();
implicits();  // decorator
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
(Eq, Ord, Clone, Debug, Hash, Default, Json, Builder, TypeGuard);
(deriveIgnore, deriveWith);
```

**Inspired by:** Rust derive macros

[Guide](/guides/derive)

### @typesugar/specialize {#specialize}

Zero-cost typeclass specialization.

```bash
npm install @typesugar/specialize
```

**Exports:**

```typescript
specialize();
specialize$();
mono<T>();
inlineCall();
```

**Inspired by:** GHC SPECIALIZE pragma, Rust monomorphization

[Guide](/guides/specialize)

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

### @typesugar/operators {#operators}

Operator overloading.

```bash
npm install @typesugar/operators
```

**Exports:**

```typescript
operators(); // decorator
ops();
pipe();
compose();
```

**Inspired by:** Scala operators, Rust operator traits

[Guide](/guides/operators)

### @typesugar/strings {#strings}

String validation macros with compile-time checking.

```bash
npm install @typesugar/strings
```

**Exports:**

```typescript
regex`...`; // tagged template
html`...`; // tagged template
json`...`; // tagged template
raw`...`; // tagged template
fmt`...`; // tagged template
```

[Guide](/guides/strings)

### @typesugar/comptime {#comptime}

Compile-time evaluation.

```bash
npm install @typesugar/comptime
```

**Exports:**

```typescript
comptime();
includeStr();
includeJson();
includeBytes();
static_assert();
```

**Inspired by:** Zig comptime

[Guide](/guides/comptime)

### @typesugar/named-args {#named-args}

Named function arguments with compile-time validation.

```bash
npm install @typesugar/named-args
```

**Exports:**

```typescript
namedArgs();
callWithNamedArgs();
createBuilder();
```

**Inspired by:** Kotlin, Swift, Boost.Parameter

[Guide](/guides/named-args)

---

## Type Safety & Contracts

### @typesugar/type-system {#type-system}

Advanced type system extensions.

```bash
npm install @typesugar/type-system
```

**Exports:**

```typescript
// HKT
($, Kind, ArrayF, PromiseF);

// Newtype
(Newtype, wrap, unwrap, newtypeCtor);

// Refinement
(Refined, refine);
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
assert();
configure();
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

### @typesugar/contracts-z3 {#contracts-z3}

Z3 SMT solver integration for complex proofs.

```bash
npm install @typesugar/contracts-z3
```

**Exports:**

```typescript
z3ProverPlugin();
proveWithZ3Async();
```

**Inspired by:** Dafny, F\*

[Guide](/guides/contracts-z3)

### @typesugar/validate {#validate}

Zero-cost validation and schema macros.

```bash
npm install @typesugar/validate
```

**Exports:**

```typescript
is<T>(); // type guard
assert<T>(); // assertion
validate<T>(); // validation with error accumulation
Schema; // schema DSL
```

**Inspired by:** Zod, io-ts

[Guide](/guides/validate)

### @typesugar/units {#units}

Type-safe physical units with dimensional analysis.

```bash
npm install @typesugar/units
```

**Exports:**

```typescript
(meters, kilometers, feet);
(seconds, minutes, hours);
(kilograms, grams);
(newtons, joules, watts);
units`...`; // tagged template
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
// Option (null-based, zero-cost)
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

// Typeclasses
(Functor, Applicative, Monad);
(Semigroup, Monoid);
(Eq, Ord, Show);
```

**Inspired by:** Scala fp-ts, Haskell Prelude

[Guide](/guides/fp)

### @typesugar/hlist {#hlist}

Heterogeneous lists with compile-time type tracking.

```bash
npm install @typesugar/hlist
```

**Exports:**

```typescript
hlist();
(head(), tail(), last(), at());
(append(), prepend(), concat(), reverse(), zip());
(labeled(), get(), set(), project(), merge());
(map(), foldLeft(), forEach());
```

**Inspired by:** Boost.Fusion, Boost.Hana

[Guide](/guides/hlist)

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
```

**Inspired by:** Boost.Graph

[Guide](/guides/graph)

### @typesugar/erased {#erased}

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

### @typesugar/geometry {#geometry}

Type-safe geometry with coordinate system safety.

```bash
npm install @typesugar/geometry
```

**Exports:**

```typescript
(point2d(), point3d(), vec2(), vec3());
(polar(), spherical(), cylindrical());
(translate(), distance(), dot(), cross(), normalize());
(rotation2d(), translation3d(), compose());
```

**Inspired by:** Boost.Geometry

[Guide](/guides/geometry)

### @typesugar/math {#math}

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

### @typesugar/symbolic {#symbolic}

Type-safe symbolic mathematics with AST, rendering, evaluation, calculus, and simplification.

```bash
npm install @typesugar/symbolic
```

**Exports:**

```typescript
// AST construction
var_;
const_;
add;
mul;
pow;
sin;
cos;
ln;

// Calculus
diff;
integrate;
limit;

// Evaluation & rendering
evaluate;
toLatex;
toMathML;
simplify;
solve;
```

**Inspired by:** SymPy, Mathematica

[Guide](/guides/symbolic)

---

## Ecosystem Integrations

### @typesugar/effect {#effect}

Effect-TS integration.

```bash
npm install @typesugar/effect effect
```

**Exports:**

```typescript
service(); // decorator
layer(); // decorator
resolveLayer<R>();
(EffectSchema, EffectEqual, EffectHash); // derives
(EffectExt, OptionExt, EitherExt); // extensions
(effectFunctor, effectMonad); // typeclass instances
```

**Inspired by:** Scala ZIO

[Guide](/guides/effect)

### @typesugar/react {#react}

Vue/Svelte-style reactivity for React.

```bash
npm install @typesugar/react
```

**Exports:**

```typescript
state();
derived();
effect();
watch();
component();
each();
match();
```

**Inspired by:** Vue 3 Composition API, Solid.js

[Guide](/guides/react)

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

### @typesugar/kysely-adapter {#kysely}

Kysely integration.

```bash
npm install @typesugar/kysely-adapter kysely
```

**Exports:**

```typescript
ksql`...`;
(ref$(), table$(), id$(), lit$(), join$(), raw$());
```

[Guide](/guides/kysely)

### @typesugar/drizzle-adapter {#drizzle}

Drizzle ORM integration.

```bash
npm install @typesugar/drizzle-adapter drizzle-orm
```

**Exports:**

```typescript
dsql`...`;
(ref$(), id$(), join$(), raw$());
DrizzleQueryable;
```

[Guide](/guides/drizzle)

---

## Peer Dependencies

Most packages have:

- `typescript: >=5.0.0`
- `@typesugar/transformer: >=0.1.0` (peer)

Check each package's package.json for specifics.
