# typesugar Roadmap

> Last updated: 2026-02-21

This roadmap is ordered by **adoption impact**, not coolness. The core thesis: typesugar has a compelling macro system with ~30 packages — but zero external users. More features won't fix that. Debuggability, trust, and killer demos will.

---

## P0 — Table Stakes

These gate adoption. Nothing else matters until these work. A developer evaluating typesugar who can't debug their code, format their files, or understand error messages will walk away immediately.

### Source Maps for Macro-Expanded Code

**Difficulty: 4 · Impact: 5**

The preprocessor generates source maps via `magic-string`, but the AST transformer returns `map: null`. Breakpoints and stack traces for macro-expanded code point to generated code rather than the original macro call site. `ExpansionTracker.generateSourceMap()` is referenced in comments but not implemented.

- [ ] Implement `ExpansionTracker.generateSourceMap()`
- [ ] Thread source maps through the transformer pipeline
- [ ] Verify breakpoints land on original macro call sites
- [ ] Verify stack traces show original source locations

**Where:** `src/core/source-map.ts`, `src/transforms/macro-transformer.ts`

### Prettier Plugin

**Difficulty: 3 · Impact: 5**

Custom syntax (`|>`, `::`, `F<_>`) breaks Prettier. Every file save produces mangled output. Developers format code dozens of times per day — this is constant friction.

- [ ] Prettier plugin or preprocessor integration for custom operators
- [ ] Handle `F<_>` HKT syntax
- [ ] Handle `|>` pipeline and `::` cons operators

### Specialization Diagnostics

**Difficulty: 2 · Impact: 4**

`specialize()` silently falls back to dictionary passing when it encounters early returns, try/catch, loops, or mutable state. Users think they have zero-cost code when they don't. This is a trust problem.

- [x] Emit compile-time warnings on fallback to dictionary passing
- [x] Include reason (early return, try/catch, loop, mutation)
- [x] Suggest refactoring to enable inlining

**Where:** `src/macros/specialize.ts`

### Resolution Traces in Error Messages

**Difficulty: 2 · Impact: 4**

When `summon()` fails, the error is opaque. `packages/core/src/resolution-trace.ts` collects resolution events but they're not attached to failure diagnostics. Show what was tried and why each path failed.

- [ ] Attach resolution trace to `summon()` failure diagnostics
- [ ] Show: typeclass sought, types checked, instances found/rejected, reason for each rejection
- [ ] Format as a readable "resolution trace" in the compile error

**Where:** `packages/core/src/resolution-trace.ts`, `src/macros/typeclass.ts`

### Tree-Shaking: `/*#__PURE__*/` and `sideEffects: false`

**Difficulty: 1 · Impact: 4**

Half-day fix with immediate impact on every bundler integration.

- [ ] Add `sideEffects: false` to all package.json files
- [ ] Auto-emit `/*#__PURE__*/` on generated instance constants and side-effect-free expressions in the transformer

**Where:** `packages/*/package.json`, `src/transforms/macro-transformer.ts`

---

## P1 — Killer Demos

These are what goes in the README, blog posts, and conference talks. Each one solves a real, universal TypeScript pain point and makes a compelling "before/after" demo.

### Algebraic Data Types (`@adt`)

**Difficulty: 2 · Impact: 4**

Best bang-for-buck on the entire roadmap. Easy to build, pairs perfectly with the existing `match` macro, and instantly useful for every codebase with discriminated unions.

- [ ] `@adt` decorator generates constructors, type guards, and match arms
- [ ] Integration with `match()` for exhaustive pattern matching
- [ ] Auto-derive `Eq`, `Show`, `Clone` for ADT variants

```typescript
@adt
type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "rect"; width: number; height: number };

const area = match(shape, {
  circle: ({ radius }) => Math.PI * radius ** 2,
  rect: ({ width, height }) => width * height,
});
```

### Zero-Cost Optics (`@optics` / Lens)

**Difficulty: 3 · Impact: 5**

Deep immutable updates are a universal TypeScript pain point. Every React developer has written 5 levels of spread. Lenses that compile away to direct object spreads are a compelling story.

- [ ] `@optics` decorator generates lenses for each field
- [ ] Composable lens paths: `User.address.city.set(user, "NYC")`
- [ ] Compiles to nested object spread — zero runtime overhead
- [ ] Prism support for optional/sum type fields

```typescript
@optics
interface User { name: string; address: { city: string; zip: string } }

// Source:
User.address.city.set(user, "NYC")

// Compiles to:
{ ...user, address: { ...user.address, city: "NYC" } }
```

### Zero-Cost Array Comprehensions

**Difficulty: 3 · Impact: 5**

Everyone uses arrays. Everyone chains `.map().filter()`. Showing this compiles to a single for-loop with zero intermediate allocations is a mic-drop moment.

- [ ] Comprehension syntax: `[for (x of items) if (x > 0) x * 2]`
- [ ] Compiles to single-pass `for` loop
- [ ] No intermediate array allocations
- [ ] Support nested comprehensions

```typescript
// Source:
const result = [for (x of items) if (x > 0) x * 2];

// Compiles to:
const result = [];
for (let i = 0; i < items.length; i++) {
  const x = items[i];
  if (x > 0) result.push(x * 2);
}
```

### Iterator Fusion (Phase 2 — compile-time chain analysis)

**Difficulty: 5 · Impact: 5**

The ultimate zero-cost demo. "Blitz++/Eigen but in TypeScript" is genuinely novel. Phase 1 (runtime lazy iterators) exists in `packages/fusion/`. Phase 2 fuses method chains at compile time.

- [ ] Compile-time analysis of `.filter().map().reduce()` chains
- [ ] Fuse into single loop with inlined predicates and transforms
- [ ] Handle `take()`, `drop()`, early termination
- [ ] Detect unfusable operations (sort, reverse) and materialize at boundaries
- [ ] Benchmark suite proving zero intermediate allocations

**Where:** `packages/fusion/`

### `@memoize` Macro

**Difficulty: 2 · Impact: 4**

Universally useful, easy to implement, integrates with `Hash` typeclass for key generation. Everyone understands memoization.

- [ ] `@memoize` decorator on functions
- [ ] Use `Hash` typeclass for cache key generation when available
- [ ] Configurable `maxSize` and `ttl`
- [ ] Strippable via `cfg()` for production builds
- [ ] Handle async functions

---

## P2 — Typeclass System Hardening

Making the flagship feature production-grade. Nobody trusts a typeclass system that has coherence bugs or mysterious resolution failures.

### Orphan Instance Detection

**Difficulty: 3 · Impact: 4**

Without orphan rules, instances can be defined anywhere, and module execution order determines which one wins. In large codebases this will cause subtle, hard-to-diagnose bugs.

- [ ] Enforce: instances must be defined in the module of the typeclass or the type
- [ ] Clear compile error with fix suggestion when orphan detected
- [ ] Escape hatch annotation for intentional orphans

**Where:** `src/macros/typeclass.ts`, `CoherenceChecker`

### Macro Expansion Cycle Detection

**Difficulty: 2 · Impact: 3**

No expansion depth limit exists. Recursive macro expansion can hang the compiler.

- [ ] Configurable max expansion depth (default: 32)
- [ ] Clear compile error with expansion trace when exceeded
- [ ] Detect direct cycles (A expands to B which expands to A)

**Where:** `src/transforms/macro-transformer.ts`

### Binding-Time Analysis for Specialization

**Difficulty: 4 · Impact: 3**

Replace the ad-hoc "can we inline this?" checks with a proper binding-time analysis pass. Makes specialization predictable instead of "try and hope."

- [ ] Static analysis pass before inlining attempts
- [ ] Classify each expression as "static" or "dynamic"
- [ ] Use classification to determine specialization feasibility
- [ ] Report results via specialization diagnostics (P0)

**Where:** `src/macros/specialize.ts`

### Post-Expansion Type Checking

**Difficulty: 4 · Impact: 4**

Macro-generated code isn't re-type-checked. Generated type errors surface as cryptic failures downstream.

- [ ] Run incremental type checker on macro expansion results
- [ ] Map type errors back to the original macro invocation
- [ ] Clear error: "macro X generated invalid code: [type error]"

### Migrate Remaining Errors to Rich Diagnostics

**Difficulty: 2 · Impact: 3**

Some code still uses legacy `ctx.reportError()` (string-based). Migrate to `ctx.diagnostic()` (rich builder with spans, notes, suggestions).

- [ ] Audit all `ctx.reportError()` call sites
- [ ] Migrate to `DiagnosticBuilder` with source spans
- [ ] Add "Did you mean?" suggestions where applicable

---

## P3 — Cross-Cutting Infrastructure

Building the foundation that unblocks an entire category of features.

### `defineWrappingMacro()` Helper

**Difficulty: 3 · Impact: 4**

No uniform helper exists for body-wrapping macros. Each `@profiled`/`@traced`/`@retry` would independently handle async functions, generators, arrows, methods, `cfg()` stripping, and composition ordering. One helper unblocks five features.

- [ ] Higher-level API for "wrap function body with before/after/around" pattern
- [ ] Handle: async functions, generators, arrow functions, method declarations
- [ ] Support `cfg()` stripping for conditional compilation
- [ ] Support `expandAfter` for composition ordering
- [ ] Document the nesting convention for multiple wrappers

**Where:** `src/macros/`, `packages/core/`

### `@mustUse` (Rust `#[must_use]`)

**Difficulty: 3 · Impact: 4**

Emit compile-time warning when return value of a `@mustUse` function is discarded. Prevents a whole category of bugs with `Result`, `Option`, and async operations. Unique in the TypeScript ecosystem.

- [ ] `@mustUse` attribute macro
- [ ] Call-site analysis to detect discarded return values
- [ ] Configurable: warning vs error
- [ ] Pre-register for `Option`, `Result`, `Either` types

### `@traced` Macro

**Difficulty: 3 · Impact: 4**

OpenTelemetry is ubiquitous. Type-aware span attribute extraction (inspect parameter types at compile time, auto-extract `.id`, `.name`) is a genuine differentiator. Requires `defineWrappingMacro()`.

- [ ] Wrap functions in OpenTelemetry spans
- [ ] Auto-extract span attributes from parameter types (compile-time introspection)
- [ ] Strippable via `cfg("tracing")`
- [ ] Handle async functions, class methods

### Unplugin HMR / Watch Mode

**Difficulty: 3 · Impact: 4**

The unplugin creates `ts.Program` once at `buildStart` and never invalidates it. During dev mode, type information goes stale as files change. Developers get wrong behavior without knowing why.

- [ ] Add watch mode support to unplugin
- [ ] Incremental program updates on file change
- [ ] Proper cache invalidation
- [ ] Custom CompilerHost that preprocesses before Program creation (see PLAN-implicit-operators.md §Future)

**Where:** `packages/unplugin-typesugar/`

---

## P4 — Validation & Type System

Practical features that make the type system feel magical.

### Validate + Refined Type Integration

**Difficulty: 3 · Impact: 4**

`@typesugar/validate` and `@typesugar/type-system` refined types aren't wired together. `generateValidationChecks` sees `Refined<number, Positive>` as plain `number` and misses the registered predicate.

- [ ] Wire `generateValidationChecks` to recognize `Refined<Base, Brand>` types
- [ ] Look up `REFINEMENT_PREDICATES` from the registry
- [ ] Emit `.is()` / `.refine()` checks instead of just checking the base type
- [ ] Compose with `@typesugar/contracts` to avoid duplicating checks

**Where:** `packages/validate/`, `packages/type-system/`

### Discriminated Union Validation

**Difficulty: 2 · Impact: 4**

Discriminated unions are everywhere in TypeScript. The validator should detect the discriminant field and generate switch-based validation.

- [ ] Detect discriminant field (`kind`, `type`, `_tag`, etc.)
- [ ] Generate switch-based validation per variant
- [ ] Validate variant-specific fields

**Where:** `packages/validate/`

### Inline Constraint Syntax (`number :| Positive`)

**Difficulty: 3 · Impact: 4**

Beautiful ergonomics. `number :| Positive` instead of `Refined<number, Positive>`. Needs preprocessor support.

- [ ] Preprocessor rewrite: `T :| C` → `Refined<T, C>`
- [ ] Support constraint composition: `number :| Positive & Lt<100>`
- [ ] Integrate with Prettier plugin (P0)

**Where:** `packages/preprocessor/`

### Implicit Unit Conversion

**Difficulty: 3 · Impact: 4**

`kilometers(1) + meters(500)` should auto-convert within the same dimension. Squants-style behavior.

- [ ] Detect same-dimension addition/subtraction
- [ ] Auto-insert conversion factor at compile time
- [ ] Compile error for incompatible dimensions (length + time)
- [ ] More unit domains: Data (bytes/KB/MB), Angle, Frequency

**Where:** `packages/units/`

### Property-Based Test Shrinking

**Difficulty: 3 · Impact: 4**

Shrinking is the difference between "property testing" and "random testing." When tests fail, shrink to the minimal failing case.

- [ ] Shrink strategies for all built-in types
- [ ] Refined type integration: auto-generate valid values for `Positive`, `Port`, `Email`
- [ ] Generator combinators: `Arbitrary.oneOf()`, `.frequency()`, `.suchThat()`

**Where:** `packages/testing/`

---

## P5 — Advanced Features

For power users. These are the exciting roadmap items that keep engaged users invested once adoption exists.

### Compile-Time Parser Generation (Phase 2)

**Difficulty: 5 · Impact: 5**

The `grammar` tagged template already parses and produces runtime combinators. Phase 2 compiles the grammar into a zero-cost recursive descent parser — no combinator overhead, just `if`/`while` loops.

- [ ] Compile grammar IR to recursive descent parser AST
- [ ] Inline semantic actions
- [ ] Error recovery with furthest-failure tracking
- [ ] Benchmark against hand-written parsers

**Where:** `packages/parser/`

### Implicit Context Passing (Scala 3 `using`)

**Difficulty: 4 · Impact: 5**

Functions declare implicit parameters, and a macro auto-threads context through call graphs. Powerful but dangerous — easy to create spooky action at a distance. Needs careful design to avoid becoming the new `any`.

- [ ] `using` parameter annotation
- [ ] Automatic context threading through call graph
- [ ] Compile error when context is missing (not silently `undefined`)
- [ ] Scope boundaries: where does implicit resolution stop?

### Erased Type Auto-Resolution (Phase 2)

**Difficulty: 4 · Impact: 4**

Phase 1 has explicit vtables. Phase 2 auto-resolves vtables from the typeclass registry at compile time. `dyn Trait` for TypeScript.

- [ ] `erased(value)` inspects type and resolves typeclass instances
- [ ] Auto-generate vtable from resolved instances
- [ ] Vtable deduplication across module

**Where:** `packages/erased/`

### State Machine Verification

**Difficulty: 3 · Impact: 4**

Compile-time reachability analysis, deadlock detection, and determinism checking for state machines. Practical for workflow engines and order processing.

- [ ] Reachability from initial state
- [ ] Dead-end state detection
- [ ] Determinism check (no state has two transitions with same event)
- [ ] Integrate with phantom state machines from `type-system`

**Where:** `packages/graph/`

---

## P6 — Nice to Have

Lower priority. Either the audience is narrow, the problem is solved elsewhere, or the effort-to-value ratio is poor.

| Feature                                            | Difficulty | Why Lower                                                                                                       |
| -------------------------------------------------- | :--------: | --------------------------------------------------------------------------------------------------------------- |
| **Taint tracking** (`@tainted`/`@sanitized`)       |     4      | Intellectually elegant but TS injection surfaces are narrow. Frameworks solve this.                             |
| **Capability tracking** (`@requires`/`@provides`)  |     4      | Effect-system-for-TS has been attempted many times. Small audience, already served by Effect.                   |
| **Cross-function contract propagation**            |     4      | Inter-procedural analysis is a research project. Basic contracts are good enough for now.                       |
| ~~**Z3 integration for decidable predicates**~~    |     —      | Removed. Basic algebraic prover is sufficient.                                                                  |
| **Compile-time graph algorithms (Dijkstra, etc.)** |     4      | When will someone run shortest-path at compile time? State machine verification (P5) covers the practical case. |
| **`@profiled` / `@timeout` / `@retry` macros**     |     2      | Easy but not differentiating. These exist as npm packages. Build after `defineWrappingMacro()` as examples.     |
| **Debug mode with expansion comments**             |     2      | Source maps (P0) solve this better.                                                                             |
| **HList `mapWith(TC)` Phase 2**                    |     3      | TS tuple type recursion limits (~20 elements) limit the practical audience.                                     |
| **Lazy instance registration**                     |     3      | Tree-shaking improvement. Nice but `/*#__PURE__*/` (P0) covers most of it.                                      |
| **`@deprecated` attribute macro**                  |     3      | JSDoc `@deprecated` + TypeScript's built-in strikethrough covers 80% of this.                                   |

---

## Deferred — Web Framework

The entire web framework vision (component builders, `html` tagged templates, `Fx<A,E,R>` effect system, custom syntax blocks, islands architecture, server/client code splitting) is a **separate multi-year project**.

It's exciting and the macro system makes it uniquely feasible — but shipping it before typesugar has external users would be building a house on sand. The framework depends on every P0-P2 item being solid.

**Revisit when:** typesugar has stable adoption, source maps work, the typeclass system is battle-tested, and there's community demand.

See `docs/VISION-WEB-FRAMEWORK.md` for the full design.

---

## Language Design Decisions (Open)

These are design questions, not implementation tasks. They need decisions before work can proceed.

| Question                         | Context                                                                                    | Options                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| **`===` operator semantics**     | Rewriting `===` from reference to structural equality violates principle of least surprise | Use a distinct operator for structural equality? Keep `===` and document? |
| **True lexical hygiene**         | Current hygiene is name-mangling, not scope-aware                                          | Investigate TypeScript Symbol API for scope tracking? Accept gensym?      |
| **Phase separation in unplugin** | Preprocessor rewrites text but type checker sees original source                           | Custom CompilerHost (see PLAN-implicit-operators.md)? Accept limitation?  |

See `docs/ANALYSIS-language-design.md` for detailed analysis.

---

## How to Contribute

Pick any unchecked item and open a PR. For P0-P1 items, just start — these are high priority and won't be rejected for "wrong approach." For P3+ items, check the corresponding `docs/PLAN-*.md` for design context before diving in.

When picking work:

- **P0 items** are blocking everything. Any progress here is valuable.
- **P1 items** are the best way to make typesugar look compelling. Great for a first contribution.
- **P2 items** need understanding of the typeclass internals. Read `AGENTS.md` first.
- **P3+ items** are for contributors who are already comfortable with the codebase.
