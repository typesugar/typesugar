# Agent Guidelines for typesugar

## GitHub Repository

- **Repo:** `typesugar/typesugar` (org account, NOT `dpovey/typesugar`)
- **URL:** `https://github.com/typesugar/typesugar`
- **Auth user:** `dpovey` (personal account — has push access to the org)
- **Push pattern:**
  ```bash
  TOKEN=$(gh auth token --user dpovey)
  git remote set-url origin "https://x-access-token:${TOKEN}@github.com/typesugar/typesugar.git"
  git push -u origin HEAD
  ```

## File Extensions: `.ts` vs `.sts`

typesugar uses two file extensions based on whether custom syntax is needed:

| Extension        | Preprocessor | Use When                                                                      |
| ---------------- | ------------ | ----------------------------------------------------------------------------- |
| `.ts` / `.tsx`   | No           | JSDoc macros only (`/** @typeclass */`, `let:`, `comptime()`, `summon()`)     |
| `.sts` / `.stsx` | Yes          | Custom operators (`\|>`, `::`), HKT syntax (`F<_>`), decorators on interfaces |

**Extension routing is automatic.** The build pipeline routes files by extension:

- `.sts`/`.stsx` files ALWAYS go through the preprocessor
- `.ts`/`.tsx` files NEVER go through the preprocessor

**Module resolution is transparent.** `import { foo } from "./bar"` resolves to:

1. `bar.ts` (preferred)
2. `bar.tsx`
3. `bar.sts` (fallback)
4. `bar.stsx`
5. `bar/index.ts`
6. `bar/index.sts`

**Declaration files are standard.** `.sts` files emit `.d.ts` (not `.d.sts.ts`), so consumers don't need typesugar.

## Key Principles

1. **Zero-Cost or Don't Ship It** — Every abstraction must compile away to what you'd write by hand. No runtime dictionary lookups, no wrapper types, no closure allocation. If it can be done at compile time, it must be.

2. **Auto-Derivation + Auto-Specialization by Default** — Never require `@deriving` annotations for basic typeclass support. When the compiler sees `p1 === p2`, it auto-derives Eq from the type's fields AND auto-specializes (inlines) the method body at the call site. `p1 === p2` compiles to `p1.x === p2.x && p1.y === p2.y`, not `eqPoint.equals(p1, p2)`. The typeclass abstraction is erased entirely. `@deriving(Eq)` is documentation, not activation. Favor auto-specialization everywhere — explicit `specialize()` calls should be the exception, not the norm.

3. **JSDoc Macros, Not Decorators** — Use `/** @typeclass */`, `/** @impl TC<T> */`, `/** @deriving Eq, Ord */`, `/** @op + */`. No preprocessor required. For HKT typeclasses, `/** @impl Functor<Option> */` resolves the type constructor via TypeChecker (Tier 1) — no `@hkt` or `*F` needed. Partial application works: `/** @impl Functor<Either<string>> */`. Resolution failures emit TS9305. Decorator syntax (`@typeclass`, `@instance`) is supported via the preprocessor, which rewrites them to JSDoc so everything flows through one path in the transformer.

4. **Extensions are Import-Scoped (Scala 3 Model)** — Extension methods only activate when you import the function. `import { clamp } from "@typesugar/std"` makes `n.clamp(0, 100)` work. No import, no extension. This prevents surprising method injection and makes dependencies explicit. Extension files must have `"use extension"` at the top. The package's `index.ts` must barrel-export all extensions.

5. **Extension Methods for Types You Don't Own** — Use `"use extension"` directive or `@extension` decorator for primitives (`number`, `string`), built-ins (`Array`, `Map`), and third-party types. For types you define, use classes with methods.

6. **Library Import Patterns** — Three kinds of imports, each with a specific purpose:
   - **Named imports for extensions**: `import { clamp, isEven } from "@typesugar/std"` — activates extension methods
   - **Side-effect imports for macros**: `import "@typesugar/std/macros"` — registers `let:`, `par:`, `match`, etc.
   - **Type-only imports for typeclasses**: `import type { Eq, Ord } from "@typesugar/std"` — no runtime cost

   Libraries must re-export everything from `index.ts` (barrel exports) and handle name conflicts with explicit aliases (e.g. `export { toInt as parseIntSafe } from "./string"`).

7. **Do-Notation via Labeled Blocks** — `let:` / `seq:` for sequential monadic chains (flatMap), `par:` / `all:` for parallel (Promise.all). These compile to zero-cost chains. `par:` blocks can nest inside `let:` blocks.

8. **Reuse `specialize.ts` for Inlining** — `inlineMethod()` is the gold standard for zero-cost. `fn.specialize(dict)` creates named specialized functions. Study `packages/macros/src/specialize.ts` before implementing new transformations.

9. **Use `quote()` for AST Construction** — Tagged template quasiquoting with `spread`, `ident`, `raw` helpers. Never use raw `ts.factory` calls in macro implementations.

10. **Respect Package Boundaries** — Typeclass machinery in `@typesugar/typeclass`, typeclass definitions in `@typesugar/std`, FP data types in `@typesugar/fp`, collection hierarchy in `@typesugar/collections`. Don't mix.

11. **HKT: Use Tier 0/1 by Default** — Write `F<A>` in typeclass bodies (the transformer rewrites to `Kind<F, A>`). Use `@impl Functor<Option>` for instances (the macro resolves the type constructor). Manual `TypeFunction` interfaces are the escape hatch. When writing manual interfaces, `_` MUST use `this["__kind__"]` — unsound phantom types must NOT implement Functor/Monad. Use `F<_>` syntax in `.sts` files, `F<A>` in `.ts` files, never Scala's `F[_]`.

12. **Search Before Building** — Check `packages/*/src/`, `typeclassRegistry`, `instanceRegistry`, existing macros, and extension files before implementing anything new. The feature likely already exists.

13. **Pattern Matching Conventions** — `match()` supports two forms: fluent (`.case().then().else()`) and legacy (object handler). Always prefer the fluent API for new code. The fluent API supports structural patterns (array, object, type, regex, OR, AS, nested, extractors), compile-time exhaustiveness, and optimized code generation. The preprocessor syntax (`| pattern => expr`) in `.sts` files rewrites to the fluent API. `when()`, `otherwise()`, and `P.*` are deprecated — use `.case().if().then()` and `.else()` instead. `match` lives in `@typesugar/std`, not `@typesugar/fp`. See [docs/guides/pattern-matching.md](docs/guides/pattern-matching.md) for the full guide and [PEP-008](docs/PEP-008-pattern-matching.md) for the spec.

See [PHILOSOPHY.md](PHILOSOPHY.md) for the full design philosophy.

---

## Architecture

For the compilation pipeline details, see [docs/architecture.md](docs/architecture.md).
For macro authoring reference, see the `macro-authoring` skill.

```
packages/
│
│   ## Build Infrastructure
├── core/               # @typesugar/core — macro registration, types, context
├── macros/             # @typesugar/macros — built-in macro implementations
├── transformer/        # @typesugar/transformer — ts-patch transformer plugin
├── preprocessor/       # @typesugar/preprocessor — lexical preprocessor for custom syntax
├── oxc-engine/         # @typesugar/oxc-engine — native Rust macro engine (experimental)
├── unplugin-typesugar/ # unplugin-typesugar — build tool integrations (Vite, esbuild, Rollup, Webpack)
├── ts-plugin/          # @typesugar/ts-plugin — TypeScript language service plugin
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
├── strings/            # @typesugar/strings — string manipulation macros
│
│   ## Type Safety & Contracts
├── type-system/        # @typesugar/type-system — refined types, newtype, vec
├── contracts/          # @typesugar/contracts — requires/ensures/invariant
├── contracts-refined/  # @typesugar/contracts-refined — refinement types
├── validate/           # @typesugar/validate — schema validation macros
├── units/              # @typesugar/units — units of measure
│
│   ## Data Structures & Algorithms
├── fp/                 # @typesugar/fp — functional programming (Option, Result, IO)
├── hlist/              # @typesugar/hlist — heterogeneous lists (Boost.Fusion)
├── fusion/             # @typesugar/fusion — iterator fusion, expression templates (Blitz++)
├── parser/             # @typesugar/parser — PEG parser generation (Boost.Spirit)
├── collections/        # @typesugar/collections — collection typeclasses, HashSet, HashMap
├── graph/              # @typesugar/graph — GraphLike typeclass, graph algorithms, state machines (Boost.Graph)
├── erased/             # @typesugar/erased — typeclass-based type erasure (dyn Trait)
├── codec/              # @typesugar/codec — versioned codecs, schema evolution (serde)
├── math/               # @typesugar/math — math types and typeclasses
├── mapper/             # @typesugar/mapper — zero-cost object mapping
├── symbolic/           # @typesugar/symbolic — symbolic math, calculus, simplification
│
│   ## Ecosystem Integrations
├── effect/             # @typesugar/effect — Effect TS integration (@service, @layer, layerMake, resolveLayer, derives)
└── sql/                # @typesugar/sql — typed SQL fragments
```

---

## Package Boundaries

| Package                  | Contents                                                                                                                              | Does NOT contain                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `@typesugar/typeclass`   | Machinery: `@typeclass`, `@impl`, `@deriving`, `summon`, `extend`, `specialize`                                                       | Typeclass definitions                     |
| `@typesugar/std`         | Standard typeclasses (Eq, Ord, Show, Hash, Semigroup, FlatMap), built-in extensions, `let:/seq:` and `par:/all:` do-notation, `match` | FP data types                             |
| `@typesugar/fp`          | FP data types (Option, Either, IO, List, etc.) and their typeclass instances                                                          | General-purpose utilities                 |
| `@typesugar/collections` | Collection typeclass hierarchy (IterableOnce, Iterable, Seq, MapLike, SetLike), HashSet, HashMap                                      | Typeclass definitions (those live in std) |
| `@typesugar/hlist`       | Heterogeneous lists with compile-time type tracking, labeled HList, map/fold operations                                               | Typeclass instances                       |
| `@typesugar/parser`      | PEG grammar DSL, parser combinators, tagged template macro                                                                            | Compile-time code gen                     |
| `@typesugar/fusion`      | Single-pass lazy iterator pipelines, element-wise vec operations                                                                      | Matrix operations                         |
| `@typesugar/graph`       | GraphLike<G,N,E> typeclass, graph algorithms (topo sort, SCC, Dijkstra), state machines                                               | Visual rendering                          |
| `@typesugar/erased`      | Typeclass-based type erasure, vtable dispatch, capability widen/narrow                                                                | Typeclass definitions                     |
| `@typesugar/codec`       | Versioned schema builder, JSON/binary codecs, migration chain generation                                                              | Transport/network layer                   |

**Key clarifications:**

- `match` is a general-purpose control flow primitive — it belongs in `std`, not `fp`
- `@typesugar/typeclass` provides the machinery to define typeclasses, but the typeclasses themselves live in `std`
- Extensions on built-in types (`number`, `string`, `Array`) go in `std`
- `@typesugar/fusion`'s `lazy()` is always single-pass — it MUST NOT create intermediate arrays

### `@derive` vs `@deriving` vs Auto-derivation

| Mechanism                 | What it does                                              | When to use                                    |
| ------------------------- | --------------------------------------------------------- | ---------------------------------------------- |
| Auto-derivation (default) | Automatically synthesizes instances for product/sum types | **Always** — this is the default behavior      |
| `@deriving(TC)`           | Same as auto-derivation, but documents intent explicitly  | Documentation — makes capabilities visible     |
| `@derive(TC)`             | Generates standalone functions                            | Rarely — doesn't integrate with `summon`       |
| `@impl` (or `@instance`)  | Custom hand-written instance, overrides auto-derivation   | When auto-derived behavior isn't what you want |

---

## When Adding Features

1. Check [PHILOSOPHY.md](PHILOSOPHY.md) for design principles
2. Check [docs/architecture.md](docs/architecture.md) for the compilation pipeline
3. Check existing macros in `packages/macros/src/` for patterns to follow
4. Reuse `specialize.ts` infrastructure for inlining
5. Use `quote()` for AST construction instead of raw `factory` calls
6. Add tests in `tests/` directory
7. Update docs if user-facing

## When Adding Packages

1. Always declare `devDependencies` — don't rely on hoisting (`vitest`, `typescript`, etc.)
2. Create `vitest.config.ts` with a project name matching the package name
3. Add JSDoc comments on every exported type, interface, and function
4. All imports must be at the top of the file — no mid-file imports
5. Re-export everything from `index.ts` — including derived operations
6. Don't export dead code — if a type has no instances, don't export it

---

## Quick Lookup: "I Need To..."

| Need                            | Use                                                                     | Location                                  |
| ------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------- |
| Inline a method body            | `inlineMethod(ctx, method, callArgs)`                                   | `packages/macros/src/specialize.ts`       |
| Create specialized function     | `createSpecializedFunction(ctx, options)`                               | `packages/macros/src/specialize.ts`       |
| Register a new expression macro | `defineExpressionMacro(name, macro)`                                    | `packages/core/src/registry.ts`           |
| Register a new attribute macro  | `defineAttributeMacro(name, macro)`                                     | `packages/core/src/registry.ts`           |
| Register a new derive macro     | `defineDeriveMacro(name, macro)`                                        | `packages/core/src/registry.ts`           |
| Create AST from code string     | `ctx.parseExpression(code)`, `ctx.parseStatements(code)`                | `packages/core/src/context.ts`            |
| Create AST with splicing        | `` quote(ctx)`...` ``, `` quoteStatements(ctx)`...` ``                  | `packages/macros/src/quote.ts`            |
| Get type information            | `ctx.typeChecker`, `ctx.getTypeOf(node)`, `ctx.getTypeString(node)`     | `packages/core/src/context.ts`            |
| Evaluate at compile time        | `ctx.evaluate(node)`, `ctx.isComptime(node)`                            | `packages/core/src/context.ts`            |
| Report compile error            | `ctx.reportError(node, message)`                                        | `packages/core/src/context.ts`            |
| Generate unique names           | `ctx.generateUniqueName(prefix)`                                        | `packages/core/src/context.ts`            |
| Safe reference (hygiene)        | `ctx.safeRef(symbol, from)`                                             | `packages/core/src/context.ts`            |
| Track typeclass instances       | `instanceRegistry`, `findInstance()`                                    | `packages/macros/src/typeclass.ts`        |
| Mark file as extension source   | `"use extension";` directive at file top                                | `packages/core/src/resolution-scope.ts`   |
| Mark function as extension      | `@extension` decorator                                                  | `packages/macros/src/extension.ts`        |
| Register instance methods       | `registerInstanceMethods(dictName, brand, methods)`                     | `packages/macros/src/specialize.ts`       |
| Extract type metadata           | `extractMetaFromTypeChecker(ctx, typeName)`                             | `packages/macros/src/auto-derive.ts`      |
| Detect discriminated unions     | `tryExtractSumType(ctx, target)`                                        | `packages/macros/src/typeclass.ts`        |
| Define pattern-based macro      | `defineSyntaxMacro(name, options)`                                      | `packages/macros/src/syntax-macro.ts`     |
| Define custom derive (simple)   | `defineCustomDerive(name, callback)`                                    | `packages/macros/src/custom-derive.ts`    |
| Chain macro transformations     | `pipeline(name).pipe(...).build()`                                      | `packages/core/src/pipeline.ts`           |
| Read config values              | `config.get(path)`, `config.evaluate(condition)`                        | `packages/core/src/config.ts`             |
| Include file at compile time    | `includeStr()`, `includeJson()`                                         | `packages/macros/src/include.ts`          |
| Assert at compile time          | `staticAssert(cond, msg)`                                               | `packages/macros/src/static-assert.ts`    |
| Register FlatMap instance       | `registerFlatMap<F>(name, impl)`                                        | `packages/std/src/typeclasses/flatmap.ts` |
| Use do-notation for monads      | `let: { x << ... } yield: { ... }`                                      | `packages/std/src/macros/let-yield.ts`    |
| Check if node is opted out      | `isInOptedOutScope(sourceFile, node, tracker, feature?)`                | `packages/core/src/resolution-scope.ts`   |
| Get import suggestions          | `getSuggestionsForSymbol(name)`, `getSuggestionsForMethod(name)`        | `packages/core/src/import-suggestions.ts` |
| Work on match exhaustiveness    | `analyzeScrutineeType()`, `isAllPureLiteralArms()`, `ScrutineeAnalysis` | `packages/std/src/macros/match-v2.ts`     |
| Write fluent pattern match      | `match(v).case(...).if(...).then(...).else(...)`                        | `packages/std/src/macros/match.ts`        |
| Write preprocessor match        | `match(v) \| pattern => expr` (`.sts` files only)                       | `packages/preprocessor/src/scanner.ts`    |
| Emit rich diagnostic            | `DiagnosticBuilder(descriptor, sourceFile, emitter).at(node).emit()`    | `packages/core/src/diagnostics.ts`        |

---

## Deep Reference

For detailed documentation beyond this overview:

- **Macro authoring** (MacroContext API, macro kinds, quasiquoting, built-in macros, transformer): see the `macro-authoring` skill
- **Preprocessor** (custom operators, scanner, source maps, rewriting rules): see the `preprocessor-guidelines` skill
- **Compilation pipeline**: [docs/architecture.md](docs/architecture.md)
- **Design philosophy**: [PHILOSOPHY.md](PHILOSOPHY.md)
- **Code quality**: `.cursor/rules/code-quality-checklist.mdc`
- **HKT conventions**: `.cursor/rules/hkt-conventions.mdc`
- **Zero-cost guidelines**: `.cursor/rules/zero-cost-guidelines.mdc`
- **Collections patterns**: `.cursor/rules/collections-patterns.mdc`
