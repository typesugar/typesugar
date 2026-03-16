# Module Evaluation Log

Evaluation of all typesugar modules across 4 dimensions:

1. **Usefulness/Utility** (1-5): How likely are people to use this?
2. **Completeness** (1-5): How thoroughly implemented?
3. **Documentation** (1-5): How complete is the documentation?
4. **Coherence** (1-5): Does it follow design philosophy? Uses auto-derivation, correct operator patterns, favors operators over commands?

---

## @typesugar/codec

**Usefulness**: 3/5 - Solves a real problem (schema versioning/migration) relevant for wire protocols, persistent storage, and APIs. However, most TypeScript projects use simpler JSON or zod/superjson. Niche but valuable where needed.
**Completeness**: 4/5 - JSON and binary codecs work well. All 5 macros now registered. @codec macro extracts type structure and generates defineSchema() call. @since/@removed/@renamed/@defaultValue still stubs.
**Documentation**: 3/5 - README has clear problem statement, quick start, evolution rules table. Missing required sections (zero-cost guarantee, package integration), sparse JSDoc.
**Coherence**: 3/5 - Macros registered; @codec generates defineSchema at compile time. Field-level metadata macros still Phase 2 stubs.
**Summary**: Functional versioned serialization with macro-driven schema generation.

**Update (2026-03-01):** Registered all 5 macros with globalRegistry; @codec now extracts class/interface fields and emits defineSchema() call; added macro tests.

---

## ~~@typesugar/comptime~~ (REMOVED)

**Status**: Package removed (2026-03-15). Was just a re-export wrapper around @typesugar/macros with no unique value. Users should import comptime utilities directly from @typesugar/macros or the umbrella package: comptime(), staticAssert(), includeStr(), includeJson().

---

## @typesugar/contracts

**Usefulness**: 5/5 - Design by Contract with compile-time proof elimination is unique value; multi-layer prover differentiates from validation-only alternatives.
**Completeness**: 4/5 - Comprehensive implementation: requires/ensures/old/invariant macros, proof certificates, decidability annotations, laws verification. 556-line test file covering configuration, macros, parser, and prover.
**Documentation**: 5/5 - Excellent README with code examples for every feature. Coq-inspired decidability annotations well-documented.
**Coherence**: 5/5 - Exemplifies zero-cost abstractions through proof elimination; proper macro usage; algebraic rules integrate with typeclass laws.
**Summary**: A mature, sophisticated DbC implementation with unique compile-time proof elimination.

**Update (2026-03-15):** No changes since March 1 — stable and comprehensive.

---

## @typesugar/contracts-refined

**Usefulness**: 4/5 - Bridges `type-system` and `contracts` for compile-time proof elision. Registers Vec dynamic predicate generator for dependent types.
**Completeness**: 3/5 - Core registration/bridging works well. No package-level tests (tested indirectly via contracts tests). TODO.md reveals incomplete features: @validate integration, cross-function propagation.
**Documentation**: 3/5 - README is functional but brief (99 lines). Could use more integration examples.
**Coherence**: 5/5 - Clean "import-to-activate" pattern, zero-cost by design, proper separation of concerns.
**Summary**: Integration glue between `type-system` and `contracts`. Well-architected but needs more documentation.

**Update (2026-03-15):** No changes since March 1 — stable.

---

## ~~@typesugar/contracts-z3~~ (REMOVED)

**Status**: Package removed (2026-03-01). Z3 SMT solver integration conflicts with zero-cost philosophy due to heavy WASM dependency (~40MB+, 100-500ms init). Compile-time verification capabilities retained in `@typesugar/contracts` without Z3.

---

## @typesugar/core

**Usefulness**: 5/5 - Essential foundational infrastructure for macro authors. Indispensable but niche audience (macro authors, not app developers). More critical than ever with diagnostic improvements.
**Completeness**: 4/5 - Exceptionally thorough. All 6 macro kinds, full MacroContext, comprehensive diagnostics catalog (~50+ error codes), generic registry. 215 exports.
**Documentation**: 4/5 - Strong README, excellent JSDoc throughout. 482-line showcase. Minor gap: no dedicated feature guide.
**Coherence**: 5/5 - Exemplary adherence to philosophy. Zero-cost Op<> branded type, Rust-inspired diagnostics, modern patterns throughout.
**Summary**: Foundational infrastructure that powers the entire macro system. Well-architected and thoroughly documented.

**Update (2026-03-15):** PEP-007 Wave 1 added `_` marker type and HKT context improvements. PEP-005 Waves 2-4 added DiagnosticBuilder, type confidence detection (`getTypeConfidence()`). Import-scoped instance resolution now activated by default. Prelude expanded with `FlatMap`, `ParCombine`.

---

## @typesugar/derive

**Usefulness**: 4/5 - Derive macros for Eq, Clone, Debug, Hash, Json, Builder address extremely common boilerplate patterns.
**Completeness**: 4/5 - Sum type support implemented (all derives have expandXxxForSumType functions). 9 built-in derives (Eq, Ord, Clone, Debug, Hash, Default, Json, Builder, TypeGuard), `defineCustomDerive()`, generic programming utilities. Tests in root tests/ + 1 package test.
**Documentation**: 4/5 - Good README emphasizing implicit derivation as default. Well-structured.
**Coherence**: 5/5 - Follows auto-derivation pattern via summon(). Implicit derivation is default behavior.
**Summary**: Core functionality improved with sum type support.

**Update (2026-02-28):** Sum type support added — all derive macros now handle discriminated unions via expandXxxForSumType functions.

**Update (2026-03-15):** No significant changes — stable.

---

## ~~@typesugar/drizzle~~ (REMOVED)

**Status**: Package removed (2026-03-01). Drizzle already has excellent type safety; the adapter added minimal value. Users can use `@typesugar/sql`'s DSL directly with Drizzle's raw SQL APIs.

---

## @typesugar/effect

**Usefulness**: 5/5 - Effect-TS is a major ecosystem; provides substantial DX wins with @service, @layer, layerMake<R>(), resolveLayer<R>(), do-notation, typeclass bridge.
**Completeness**: 4/5 - Core features solid: service/layer macros with dependency graph, HKT types, full typeclass hierarchy, 40+ extension methods, testing utilities (`mockService`, `testLayer`, `assertCalled`). 11 package tests + red-team coverage. Rich diagnostics (EFFECT001-040) with labeled spans and suggestions.
**Documentation**: 5/5 - Excellent README showing actual error output, API tables, clear examples.
**Coherence**: 5/5 - Follows zero-cost philosophy well: HKT types correct, extension methods delegate to Effect, dictionary-passing style. Layer graph uses `@typesugar/graph`'s `GraphLike` typeclass + `topoSortG`.
**Summary**: High-quality integration delivering real value for Effect-TS users. Layer wiring now uses proper graph algorithms.

**Update (2026-03-15):** Most active package. Significant improvements (10 commits):

- `layerMake<R>()` — ZIO-style explicit layer wiring
- `resolveLayer<R>()` — import-scoped implicit resolution
- Layer graph integration with `@typesugar/graph`'s `GraphLike` typeclass
- Rich diagnostics (EFFECT001-040) with labeled spans and suggestions
- Testing utilities (`mockService`, `testLayer`, `assertCalled`)

---

## @typesugar/erased

**Usefulness**: 4/5 - Solves real niche problem (heterogeneous collections with shared capabilities, like Rust's `dyn Trait`). The `erased()` macro auto-resolves vtables from typeclasses at compile time.
**Completeness**: 3/5 - Core functionality solid: 7 built-in capabilities, construction helpers, collection operations, widen/narrow. 57 tests (32 existing + 25 new) covering all exports.
**Documentation**: 4/5 - Good README explaining widen/narrow patterns. Showcase covers all features (350+ lines).
**Coherence**: 4/5 - Clean zero-cost design.
**Summary**: Type erasure library with vtable auto-resolution. Now has comprehensive test coverage.

**Update (2026-03-15):** Single minor commit — import-scoped resolution tweak.

**Update (2026-03-16):** 25 new tests added in `packages/erased/tests/erased-extended.test.ts`. Total: 57 tests covering all exports. Completeness 2/5 → 3/5.

---

## @typesugar/eslint-plugin

**Usefulness**: 4/5 - Essential for any typesugar project using ESLint; without it, floods of false positives for macro imports, decorators, labeled blocks.
**Completeness**: 4/5 - Solid implementation with two processors (fast + full), source map support. Tests confirmed — 3 test files with 945 lines of coverage.
**Documentation**: 4/5 - Good README with installation, three config modes. Comprehensive showcase. Missing dedicated guide page.
**Coherence**: 4/5 - Correctly delegates to preprocessor and transformer. N/A for most typesugar design principles since this is build tooling.
**Summary**: Well-designed ESLint integration essential for DX.

**Update (2026-03-15):** Minor change — `full-processor.ts` updated for ecosystem integration (PEP-001 Wave 4). Tests confirmed: processor.test.ts, full-processor.test.ts, position-mapping.test.ts.

---

## @typesugar/fp

**Usefulness**: 5/5 - Comprehensive FP toolkit (Option, Either, IO, State, Reader, Writer, Validated, List). Zero-cost Option using `A | null` is innovative.
**Completeness**: 4/5 - Full typeclass hierarchy, 50+ operations per data type, stack-safe IO, bracket/resource management, parallel ops, retry. 256 lines of exports, 658 LOC red-team tests.
**Documentation**: 5/5 - Excellent README, thorough JSDoc on every export, comprehensive 380-line showcase. HKT encoding and zero-cost philosophy clearly explained.
**Coherence**: 5/5 - Strong zero-cost philosophy (null-based Option). Correct Kind<F, A> encoding. Explicit TC namespace.
**Summary**: Well-executed, comprehensive FP library embodying zero-cost philosophy. Production-ready.

**Update (2026-03-15):** HKT system overhauled via PEP-007 Wave 1:

- New `_` marker type for HKT syntax
- Standardized on `Kind<F, A>`, removed legacy `$<F, A>` alias
- Integrated "use extension" directive for extension methods

---

## @typesugar/fusion

**Usefulness**: 4/5 - Addresses real performance concern (intermediate array allocations in method chains). Similar to Rust iterators, Java Streams, lodash/lazy.
**Completeness**: 4/5 - Good lazy pipeline foundation with zip, scan, distinct, partition. Macros now registered with globalRegistry (lazyMacro, fusedMacro). Phase 2 compile-time fusion still pass-through.
**Documentation**: 4/5 - Excellent README with clear problem/solution framing, API tables. Missing required "Integration" and "Zero-cost guarantee" sections.
**Coherence**: 3/5 - Macros registered. Runtime LazyPipeline achieves single-pass fusion. Phase 2 compile-time fusion still stub. No Op<> integration.
**Summary**: Well-implemented runtime lazy iterator with full operation set. Macros registered; Phase 2 compile-time fusion deferred.

**Update (2026-03-01):** Added zip, scan, distinct, partition operations; registered lazyMacro and fusedMacro with globalRegistry.

---

## ~~@typesugar/geometry~~ (REMOVED)

**Status**: Package removed (2026-03-01). Niche utility competing with mature ecosystems (three.js, gl-matrix). Didn't provide sufficient value over existing solutions.

---

## @typesugar/graph

**Usefulness**: 5/5 - Solid graph/state machine library with nice DSL, compile-time verification differentiates from xstate/graphlib.
**Completeness**: 4/5 - Comprehensive algorithms (topoSort, BFS, DFS, Dijkstra with Monoid weights, SCC). 806 LOC red-team tests + 317 LOC typeclass tests.
**Documentation**: 5/5 - Excellent README with algorithm complexity table, Zero-cost guarantee section, full GraphLike examples with custom types.
**Coherence**: 5/5 - Now leverages typesugar philosophy: compile-time FSM verification via defineTaggedTemplateMacro, Monoid<W>/Ord<W> for generic path costs. GraphLike<G,N,E> typeclass.
**Summary**: Well-integrated graph library with compile-time verification and typeclass-based algorithms.

**Update (2026-03-01):** Added compile-time FSM verification via stateMachineMacro; generalized Dijkstra to use Monoid<W> and Ord<W> for path costs.

**Update (2026-03-15):** Major feature addition:

- New `GraphLike<G, N, E>` typeclass with full generic algorithm suite
- `topoSortG`, `bfsG`, `dfsG`, `dijkstraWithG`, `sccG`, etc.
- Custom graph types can now use all algorithms with Eq + Hash

---

## @typesugar/hlist

**Usefulness**: 4/5 - Niche utility for type-level programming and library authors. LabeledHList's merge/project are strongest value prop.
**Completeness**: 3/5 - Solid API covering construction, positional access, structural ops, labeled ops, higher-order ops. 536 lines of tests.
**Documentation**: 4/5 - Follows module-lifecycle template. README has motivation, API tables, zero-cost explanation. 244-line showcase.
**Coherence**: 4/5 - Good zero-cost principles. Operations updated for "use extension" directive.
**Summary**: Well-implemented HList. Stable, well-documented, clean API.

**Update (2026-03-15):** Minor change — operations updated for "use extension" directive.

---

## ~~@typesugar/kysely~~ (REMOVED)

**Status**: Package removed (2026-03-01). Kysely already has excellent type safety; the adapter added minimal value. Users can use `@typesugar/sql`'s DSL directly with Kysely's raw SQL APIs.

---

## @typesugar/macros

**Usefulness**: 5/5 - Central macro package providing all built-in macros. Essential for the ecosystem — contains all macro implementations.
**Completeness**: 5/5 - Comprehensive with 27 source files. 81 global test files cover macros extensively. Red team tests added (PEP-005 Wave 6).
**Documentation**: 3/5 - Internal package — relies on main docs. README is basic.
**Coherence**: 5/5 - Follows auto-derivation patterns, Op<> return types, zero-cost principles throughout.
**Summary**: Central macro implementation package. All built-in macros live here.

**Update (2026-02-28):** Package is now buildable with proper package.json and build configuration. No longer non-functional.

**Update (2026-03-15):** PEP-007 Wave 1 added `@hkt` macro for Tier 3 HKT boilerplate reduction. PEP-005 Wave 6 added adversarial red team tests. `staticAssert` renamed for convention alignment. Diagnostic upgrades across typeclass.ts, operators.ts, implicits.ts, extension.ts.

---

## @typesugar/mapper

**Usefulness**: 3/5 - Object mapping is ubiquitous. Genuinely solves common problem, though basic compared to Chimney/AutoMapper.
**Completeness**: 2/5 - Basic mapping works with rename, const, compute, and ignore.target. Single test file. Nested objects and collection mapping still TODO.
**Documentation**: 3/5 - README is sparse (44 lines). Needs showcase.ts, more examples, extended README.
**Coherence**: 4/5 - Achieves zero-cost.
**Summary**: Minimal viable implementation. Needs more documentation and examples.

**Update (2026-03-01):** Implemented ignore.target config; moved tests to packages/mapper/tests/; added 6 macro unit tests.

**Update (2026-03-15):** No changes — **needs attention** (sparse documentation, single test file).

**Update (2026-03-16):** 10 API surface tests added in `packages/mapper/tests/api.test.ts`.

---

## @typesugar/math

**Usefulness**: 5/5 - Most comprehensive numeric library — Rational, Complex, BigDecimal, Matrix, Interval, Mod, Polynomial, Money, FixedDecimal.
**Completeness**: 4/5 - Comprehensive API for each type with full typeclass instances. 609 LOC exports, 4 dedicated test files + 489 LOC red-team. Core functionality production-ready.
**Documentation**: 5/5 - Excellent README with clear sections, JSDoc on all exports, well-structured showcase.ts.
**Coherence**: 5/5 - Uses Op<> return types, branded types for zero-cost safety, dictionary-passing style.
**Summary**: Mature, well-documented math library. Type-safe Money and exact Rational are particularly valuable.

**Update (2026-03-15):** No changes — already comprehensive and stable.

---

## ~~@typesugar/named-args~~ (REMOVED)

**Status**: Package removed (2026-03-01). Not zero-cost: allocates wrappers, Map lookups, array sorting at runtime. Native TypeScript destructured objects are simpler and more idiomatic.

---

## ~~@typesugar/operators~~ (REMOVED)

**Status**: Package removed (2026-03-01). pipe/flow/compose now re-exported from umbrella package via `@typesugar/macros`. @operators/ops() pattern deprecated in favor of Op<> typeclass approach.

---

## @typesugar/parser

**Usefulness**: 4/5 - Parser combinators serve real use cases (DSLs, config formats), but niche need.
**Completeness**: 4/5 - Full combinator suite, PEG grammar parser with left-recursion detection. Missing Phase 2 compile-time codegen.
**Documentation**: 4/5 - Well-structured README, comprehensive showcase (374 lines), thorough tests (~480 lines).
**Coherence**: 3/5 - Has proper macro registration. But "zero-cost" is deferred to Phase 2 — current implementation is runtime-interpreted.
**Summary**: Solid parser combinator library with clean API. Zero-cost promise is aspirational — Phase 2 codegen unimplemented.

---

## @typesugar/preprocessor

**Usefulness**: 4/5 - Essential infrastructure enabling HKT (F<\_>), pipeline (|>), cons (::) syntax. Developers interact indirectly.
**Completeness**: 4/5 - Three extensions fully implemented with tokenizer, source maps, JSX handling. Good test coverage (6 test files) including red-team tests.
**Documentation**: 4/5 - README covers all syntax extensions with before/after examples. JSDoc on major exports. Comprehensive showcase.
**Coherence**: 5/5 - Zero-cost by design (text-level rewriting). Clean architecture. Proper precedence and associativity handling.
**Summary**: Solid infrastructure package enabling custom TypeScript syntax. Well-tested. Internal plumbing not directly consumed by users.

**Update (2026-03-15):** PEP-001 Wave 1+4 added scanner updates for .sts extension routing. New `decorator-rewrite.ts` rewrites decorators to JSDoc instead of function calls. Import tracker and HKT registry improvements.

---

## @typesugar/prettier-plugin

**Usefulness**: 5/5 - Essential infrastructure for any project using typesugar custom syntax with Prettier; without it, Prettier crashes on |>, ::, F<\_>.
**Completeness**: 4/5 - Core functionality complete (plugin, round-trip format, CLI, programmatic API), but test coverage thin (~50 lines).
**Documentation**: 5/5 - Excellent README with clear explanation, CLI examples, API reference, integration guide; JSDoc on every export.
**Coherence**: 5/5 - Well-integrated with typesugar architecture, uses preprocessor, handles **binop**. Zero-cost round-trip.
**Summary**: Essential, well-documented tooling package enabling Prettier on typesugar files.

**Update (2026-03-15):** HKT refactor — standardized on `Kind<F, A>`, removed `$<F, A>` alias. Cleaned up unused test fixtures (cons-basic.ts, hkt-interface.ts, pipeline-simple.ts).

---

## ~~@typesugar/react~~ (REMOVED)

**Status**: Package removed (2026-03-15). Stagnant since March 1, 2026 with no development activity. Scores were 3/2/3/3 — lowest in ecosystem. Vue/Svelte-style reactivity macros for React didn't gain traction. Users needing React integration can use Effect-TS or implement custom macros.

---

## @typesugar/reflect

**Usefulness**: 4/5 - Valuable for form generation, API validation, serialization, ORM mapping. Unique compile-time reflection in TS ecosystem.
**Completeness**: 3/5 - Exports `@reflect`, `typeInfo<T>()`, `fieldNames<T>()`, `validator<T>()`. Core features work but validator<T>() only handles primitives—complex types silently skipped. Missing union/intersection. Vitest config and package-level tests exist (36 tests, 2 files).
**Documentation**: 4/5 - Good README with TypeInfo structure examples. Good showcase.
**Coherence**: 4/5 - Follows macro-based design, zero-cost.
**Summary**: Solid compile-time reflection but needs better complex type handling.

**Update (2026-03-16):** Vitest config and tests verified. 36 tests (28 in reflect.test.ts + 8 in reflect-behavioral.test.ts) covering exports, TypeInfo structures, runtime stub behavior, and edge cases. Module-evaluation-log updated: "Missing vitest config" was incorrect — config and tests exist.

---

## @typesugar/specialize

**Usefulness**: 4/5 - Valuable for FP codebases. `= implicit()` is preferred path but explicit specialization useful for debugging.
**Completeness**: 3/5 - Exports `specialize()`, `specialize$()` (via `specializeKind`), `mono()`, `inlineCall()`, cache utilities. 88 tests (34 existing + 54 new behavioral tests). Package is a re-export facade so completeness capped.
**Documentation**: 4/5 - Good README showing before/after patterns.
**Coherence**: 5/5 - Uses correct patterns. PEP-004 related cleanup.
**Summary**: Zero-cost specialization infrastructure with comprehensive behavioral test coverage.

**Update (2026-02-28):** Previous assessment corrected — `specialize$` IS exported with correct signature.

**Update (2026-03-15):** 5 commits — PEP-004 related cleanup, instance method registration changes.

**Update (2026-03-16):** 54 behavioral tests added in `packages/specialize/tests/specialize-behavioral.test.ts`. Total: 88 tests. Vitest config already existed (previous "missing vitest config" note was incorrect).

---

## @typesugar/sql

**Usefulness**: 5/5 - Comprehensive Doobie-inspired SQL library. TypedFragment<P,R> with compile-time type tracking, ConnectionIO free monad, full typeclass hierarchy.
**Completeness**: 4/5 - Comprehensive implementation with sql$ macro, @deriving(Read/Write/Codec), query builder DSL. README is 1000+ lines. 179 tests (130 existing + 49 new) covering all exports.
**Documentation**: 5/5 - Very thorough Doobie-inspired API documentation: TypedFragment, ConnectionIO, Get/Put/Meta/Read/Write/Codec hierarchy, ORM integration via Queryable.
**Coherence**: 4/5 - Good conceptual alignment. Macro integration complete. Auto-derivation working for Read/Write/Codec.
**Summary**: Well-documented, comprehensive SQL library following Doobie patterns with thorough test coverage.

**Update (2026-02-28):** README rewritten to document all implemented features. Docs score improved from 2/5 to 4/5.

**Update (2026-03-15):** 8 commits — namespace merge fixes, HKT standardization, `staticAssert` rename, formatting.

**Update (2026-03-16):** 49 new tests added in `packages/sql/tests/sql-extended.test.ts`. Total: 179 tests covering all exports. Completeness 3/5 → 4/5.

---

## @typesugar/std

**Usefulness**: 5/5 - Extremely practical stdlib with 300+ extension methods (clamp, chunk, groupBy, camelCase), pattern matching macro, do-notation.
**Completeness**: 4/5 - Core functionality production-ready. Some advanced typeclasses are interfaces only. Tests exist including red-team and comprehension tests.
**Documentation**: 5/5 - Excellent README with UFCS examples, Range API, do-notation patterns. Excellent showcase.
**Coherence**: 5/5 - Uses Op<> typeclass pattern correctly. Match macro compiles to zero-cost code (ternary chains, switch, binary search). Proper "use extension" directive.
**Summary**: Solid, high-value standard library. ~1400-line match.ts demonstrates zero-cost philosophy well.

**Update (2026-03-15):** Significant activity — new Hash typeclass added, fluent Range extension methods (`.to()`, `.until()`, `.step()`), `seq:`/`all:` aliases for do-notation, and the "use extension" directive redesign for UFCS.

---

## @typesugar/strings

**Usefulness**: 4/5 - regex compile-time validation is genuinely useful. html XSS escaping valuable for server-rendered content. raw and fmt are utilities.
**Completeness**: 3/5 - 4 macros (regex, html, fmt, raw) properly defined as tagged-template macros with correct metadata. Tests covering exports, runtime stubs, macro definitions, and HTML escaping. **Gap**: `fmt` macro's printf-style formatting is incomplete (just converts to String).
**Documentation**: 4/5 - README covers all macros with examples, guide exists. Good test coverage.
**Coherence**: 5/5 - Zero-cost macros that compile away. Proper tagged-template macro kind. Focused on web/string utilities.
**Summary**: Compile-time string validation macros.

**Update (2026-03-01):** Removed json macro. Package now focused on regex validation and html escaping.

**Update (2026-03-15):** No changes — stable.

---

## @typesugar/symbolic

**Usefulness**: 4/5 - Valuable for CAS, education, physics, LaTeX generation. Niche audience but well-executed.
**Completeness**: 4/5 - Comprehensive AST, differentiation, basic integration, 3 rendering formats, pattern matching, equation solving.
**Documentation**: 5/5 - Excellent README with full API coverage, comprehensive showcase with type assertions, thorough JSDoc.
**Coherence**: 4/5 - Properly uses Op<> typeclass, provides Numeric<Expression<T>> instance, uses Refined<> for division safety. Comprehensive red-team tests (1334 lines).
**Summary**: Well-implemented symbolic math package following typesugar patterns correctly. Production-ready for intended use cases.

---

## @typesugar/testing

**Usefulness**: 5/5 - Power assertions with sub-expression capture, compile-time assertions, type-level assertions, property-based testing, parameterized tests.
**Completeness**: 5/5 - All core features implemented. Comprehensive 680-line test suite. DiagnosticBuilder integration.
**Documentation**: 5/5 - Excellent README showing actual failure output, comprehensive API reference, Vitest integration guide. JSDoc on all public APIs.
**Coherence**: 5/5 - Follows typesugar philosophy: staticAssert/typeAssert have zero runtime cost, uses proper macro infrastructure. @derive(Arbitrary) fits auto-derivation pattern.
**Summary**: Well-implemented testing macro package bringing power-assert style diagnostics to TypeScript. Solid implementation and thorough documentation.

**Update (2026-03-15):** Infrastructure upgrades — `macro-context.ts` upgraded to use DiagnosticBuilder (PEP-005 Wave 2). Type confidence detection added (PEP-005 Wave 3). Effect integration utilities. Formatting fixes.

---

## @typesugar/transformer

**Usefulness**: 5/5 - Core build infrastructure. Every typesugar user depends on this. Provides engine for all macro expansion, preprocessing, IDE integration.
**Completeness**: 5/5 - Very comprehensive: full ts-patch transformer (~1500 lines), TransformationPipeline with source map composition, language service plugin, caching, rich CLI. 17 test files. All PEP waves implemented.
**Documentation**: 5/5 - Excellent README with CLI options, programmatic usage, examples. Troubleshooting and architecture well-documented.
**Coherence**: 5/5 - As build infrastructure, correctly doesn't use typeclasses itself—it enables them. Fully aligned with zero-cost philosophy. Clean Oxc backend integration.
**Summary**: Essential, well-implemented build infrastructure forming backbone of typesugar. Production-ready with comprehensive CLI and IDE integration.

**Update (2026-03-15):** Most active package since March 1. Implemented:

- PEP-007 Wave 1: HKT rewriter (`hkt-rewriter.ts`), language service HKT support
- PEP-005 Waves 3-5: Macro diagnostics surfaced in language service, strict mode (`--strict`)
- PEP-004 Waves 1-4: Source-based operator syntax, auto-specialization, Oxc detection patterns
- PEP-002: Complete Oxc-native macro engine integration (`oxc-backend.ts`)
- PEP-001 Waves 1-4: Extension-based routing (.sts files), module resolution, ecosystem integration
- CLI expanded with `--cache`, `--strict`, `expand`, `watch` commands

---

## @typesugar/ts-plugin

**Usefulness**: 4/5 - Essential infrastructure. Without this, custom syntax would show red squiggles in IDEs.
**Completeness**: 3/5 - Intentionally thin wrapper (41 lines) delegating to transformer/language-service. Good architecture. Only 1 test file.
**Documentation**: 4/5 - Strong README with installation, config options, debugging guide, architecture explanation.
**Coherence**: 5/5 - Follows design principles: single source of truth, CommonJS format as required by TS. Clean delegation pattern.
**Summary**: Well-designed thin wrapper delegating to canonical implementation. Excellent docs.

**Update (2026-03-15):** `staticAssert` import path updated. Improved fallback resolution for VS Code extension.

---

## @typesugar/type-system

**Usefulness**: 5/5 - High utility for type-safe TS. Refinement types (Port, Byte, Email), newtypes, HKT encoding, Vec solve real problems. PEP-007 `_` marker is significant usability improvement.
**Completeness**: 4/5 - Good API coverage. Exports HKT, refinements, existential types, newtype, opaque, Vec, effects. No dedicated test suite.
**Documentation**: 5/5 - Excellent README with comprehensive `_` marker documentation, feature organization, branding spectrum table.
**Coherence**: 5/5 - Good zero-cost design (wrap/unwrap compile away). Uses macro infrastructure. Proper HKT patterns.
**Summary**: Well-designed type-level programming library with PEP-007 improvements.

**Update (2026-03-15):** Significant changes:

- March 5: Standardized on `Kind<F, A>`, removed `$<F, A>` alias
- March 13 (PEP-007): Added `_` marker type for Tier 3 `@hkt` macro:
  ```typescript
  /** @hkt */
  type ArrayF = Array<_>;
  // Generates: interface ArrayF extends TypeFunction { readonly _: Array<this["__kind__"]> }
  ```

---

## @typesugar/typeclass

**Usefulness**: 5/5 - Typeclasses are powerful, widely-applicable abstraction pattern for generic programming. Excellent for Scala-style ad-hoc polymorphism.
**Completeness**: 4/5 - Package exports `@typeclass`, `@impl`/`@instance`, `@deriving`, `summon()`, `extend()`, HKT support via `registerHKTTypeclass()`. Tests in root `tests/typeclass-*.test.ts`.
**Documentation**: 4/5 - Good README with JSDoc/decorator syntax, deprecation table. Could add HKT usage patterns section.
**Coherence**: 5/5 - Properly re-exports from @typesugar/macros. Single source of truth. PEP-007 HKT improvements integrated.
**Summary**: Re-export facade for typeclass macros. Clean architecture with full HKT support.

**Update (2026-02-28):** Architectural duplication resolved. Package now correctly re-exports from @typesugar/macros.

**Update (2026-03-15):** PEP-007 Wave 1/3 HKT improvements — Tier 1 implicit resolution for `@impl`. PEP-004 deprecated API removal. JSDoc syntax as primary interface.

---

## typesugar (umbrella)

**Usefulness**: 4/5 - Essential entry point for ecosystem. "One import to rule them all" - every user needs this for macros, bundler plugins, CLI.
**Completeness**: 4/5 - Comprehensive re-exports from all major packages with bundler entry points (`typesugar/vite`, `/webpack`, `/esbuild`, `/rollup`) and CLI. No dedicated test suite (only showcase.ts).
**Documentation**: 4/5 - Well-structured README with installation, quick start, features table, bundler configs. Showcase (265 lines) excellent.
**Coherence**: 4/5 - Good umbrella pattern.
**Summary**: Solid umbrella package consolidating ecosystem into one import.

**Update (2026-03-15):** 3 minor commits — `_` marker type re-export from `@typesugar/type-system`, `staticAssert` rename, implicits refactor.

---

## @typesugar/units

**Usefulness**: 3/5 - Real use case for scientific/engineering domains, but niche for general TypeScript.
**Completeness**: 3/5 - Core dimension tracking works. `.to()` conversion method implemented. 115 comprehensive tests covering unit arithmetic, conversions, and edge cases.
**Documentation**: 3/5 - Well-structured README explains type-level dimension tracking well.
**Coherence**: 4/5 - Has Op<> annotations on methods. Auto-derive works for classes with methods.
**Summary**: Functional dimension-tracking following boost::units with working conversions and solid test coverage.

**Update (2026-02-28):** Auto-derive bug fixed in `extractMetaFromTypeChecker` — methods are now filtered out, so classes like `Unit<D>` auto-derive Eq/Ord/Show from their data properties (value, symbol). Coherence improved from 2/5 to 3/5.

**Update (2026-03-15):** 2 minor commits — `staticAssert` rename, PEP-002 reference.

**Update (2026-03-16):** `.to()` conversion method implemented (was documented but missing). vitest devDependency and `test` script added to package.json. 115 comprehensive tests added at `packages/units/tests/units.test.ts`. Completeness 2/5 → 3/5.

---

## unplugin-typesugar

**Usefulness**: 4/5 - Essential for any real project; provides plugins for all major bundlers (Vite, Webpack, esbuild, Rollup).
**Completeness**: 3/5 - Covers all major bundlers with include/exclude, verbose mode, syntax extensions, cache invalidation, source maps. Only 1 test file (source-maps.test.ts) — thin wrapper.
**Documentation**: 5/5 - Excellent README with clear examples for all 4 bundlers, explains lifecycle, documents type-checker limitation.
**Coherence**: 5/5 - Uses unified TransformationPipeline, follows modern unplugin patterns, correctly delegates transformation. Build-time only = zero-cost.
**Summary**: Well-architected bundler integration. Production-ready for all major bundlers.

**Update (2026-03-15):** PEP-005 Wave 5 added strict mode support (`strict: true` option). PEP-004 Wave 3 added Oxc integration exports (`needsTypescriptTransformer`). PEP-001 Wave 1 added .sts file routing.

---

## @typesugar/validate

**Usefulness**: 4/5 - Solves real need for type-safe validation. Schema typeclass is library-agnostic for Zod/Valibot/native integration.
**Completeness**: 3/5 - Has Schema typeclass abstraction, compile-time macros (`is<T>()`, `assert<T>()`, `validate<T>()`), derived operations. Two test files: `schema.test.ts` (119 lines) and `macros.test.ts` (16 lines). **Gap**: Macro tests are stub-only (just verify runtime throws).
**Documentation**: 4/5 - README accurately documents the compile-time macros and Schema typeclass. Includes code examples, API reference tables, and zero-cost explanation.
**Coherence**: 5/5 - Correctly uses macro infrastructure and HKT encoding. Integrates with @typesugar/fp.
**Summary**: Well-documented Schema typeclass and compile-time validation macros. Generates validators from TypeScript types at compile time.

**Update (2026-02-28):** Previous assessment was incorrect — README does NOT show a builder DSL. It accurately documents compile-time macros and Schema typeclass. Docs score corrected from 1/5 to 4/5.

**Update (2026-03-15):** Minor change — HKT refactor (Kind standardization) on March 5.

---

## @typesugar/vscode

**Usefulness**: 5/5 - Essential DX for typesugar projects; provides semantic highlighting, CodeLens, inlay hints, code actions, diagnostics, macro expansion peek.
**Completeness**: 4/5 - Comprehensive feature set: 7 semantic token types, manifest-driven macro detection, TS language service plugin. Tests confirmed.
**Documentation**: 4/5 - Excellent README with architecture diagram, settings table, manifest format docs. Source files have file-level JSDoc.
**Coherence**: 5/5 - Manifest-driven architecture adapts to custom macros without code changes. Properly integrates with transformer/pipeline. Follows VS Code best practices.
**Summary**: Well-architected VS Code extension providing essential IDE support. Manifest-driven design is elegant.

**Update (2026-02-22):** Test gap addressed — 83+ unit tests added covering ManifestLoader, SemanticTokensProvider, CodeLensProvider, InlayHintsProvider, ExpansionService, DiagnosticsManager, and error scenarios. Integration tests added for Extension Host activation, provider registration, and command execution. TS plugin tests added via language service harness.

**Update (2026-03-15):** Significant new features:

- Added `.sts`/`.stsx` language support with dedicated icons and grammars (PEP-001 Wave 3-4)
- New peek widget for macro expansion preview
- Surgical expansion view with focused diff
- JSDoc syntax highlighting for `/** @typeclass */` etc.
- Support for `seq:/all:` aliases in do-notation
- Fixed `ExpansionResult` type and test assertions

---

# SUMMARY

## Score Distribution (Updated 2026-03-15)

**Top scores by dimension:**

| Dimension     | 5/5 Count | Notable 5/5 Packages                                                                                  |
| ------------- | --------- | ----------------------------------------------------------------------------------------------------- |
| Usefulness    | 13        | transformer, core, macros, effect, fp, graph, type-system, std, testing, math, contracts, sql, vscode |
| Completeness  | 3         | transformer, macros, testing                                                                          |
| Documentation | 10        | transformer, testing, std, contracts, type-system, graph, math, effect, sql, prettier-plugin          |
| Coherence     | 21        | Most packages now follow design philosophy correctly                                                  |

**Packages with all dimensions ≥4:** transformer (5/5/5/5), testing (5/5/5/5), macros (5/5/3/5), effect (5/4/5/5), fp (5/4/5/5), graph (5/4/5/5), math (5/4/5/5), std (5/4/5/5), contracts (5/4/5/5), type-system (5/4/5/5), prettier-plugin (5/4/5/5), sql (5/4/5/4)

**Packages needing attention (any dimension ≤2):** mapper (3/2/3/4)

## Key Patterns Identified

### Strong Packages (avg >= 4.0) — Updated 2026-03-15

**Top-tier (all 5s in multiple dimensions):**

- **@typesugar/transformer** — _(5/5/5/5)_ Most active package. PEP-001-007 implementations, Oxc backend, 17 test files.
- **@typesugar/testing** — _(5/5/5/5)_ DiagnosticBuilder integration, comprehensive test suite.
- **@typesugar/macros** — _(5/5/3/5)_ @hkt macro, red team tests. All macro implementations.

**Very strong (avg > 4.5):**

- **@typesugar/core** — _(5/4/4/5)_ DiagnosticBuilder, type confidence, 215 exports.
- **@typesugar/effect** — _(5/4/5/5)_ ZIO-style layer wiring, GraphLike integration, 40 diagnostics.
- **@typesugar/fp** — _(5/4/5/5)_ HKT PEP-007 improvements, null-based Option.
- **@typesugar/graph** — _(5/4/5/5)_ GraphLike<G,N,E> typeclass, generic algorithms.
- **@typesugar/type-system** — _(5/4/5/5)_ PEP-007 `_` marker type.
- **@typesugar/std** — _(5/4/5/5)_ Hash typeclass, fluent Range, seq:/all: aliases.
- **@typesugar/typeclass** — _(5/4/4/5)_ PEP-007 HKT improvements.
- **@typesugar/contracts** — _(5/4/5/5)_ Stable and comprehensive DbC.
- **@typesugar/math** — _(5/4/5/5)_ Most comprehensive numeric library.
- **@typesugar/prettier-plugin** — _(5/4/5/5)_ Kind<F,A> standardization.

**Strong:**

- **@typesugar/vscode** — _(5/4/4/5)_ .sts language support, peek widget, surgical diff.
- **@typesugar/derive** — _(4/4/4/5)_ Sum type support, stable.
- **@typesugar/sql** — _(5/4/5/4)_ Comprehensive Doobie-style SQL, 179 tests.
- **@typesugar/symbolic** — _(4/3/4/4)_ Stable, good Op<> usage.

### Packages Needing Work (Updated 2026-03-15)

**Current issues:**

- **@typesugar/mapper** — Sparse documentation (44 lines), few tests. Needs showcase.
- ~~**@typesugar/comptime**~~ — _(Removed 2026-03-15)_ Re-export wrapper removed.

**Resolved (2026-03-16):**

- ~~**@typesugar/reflect**~~ — Vitest config and 36 tests verified; 8 behavioral tests added.

- ~~**@typesugar/erased**~~ — _(Resolved 2026-03-16)_ 25 package-level tests added, 57 total.
- ~~**@typesugar/sql**~~ — _(Resolved 2026-03-16)_ 49 package-level tests added, 179 total.
- ~~**@typesugar/units**~~ — _(Resolved 2026-03-16)_ `.to()` method implemented, 115 tests added.
- ~~**@typesugar/specialize**~~ — _(Resolved 2026-03-16)_ 54 behavioral tests added; vitest config already existed.

**Previously resolved:**

- ~~**@typesugar/macros**~~ _(Resolved 2026-02-28)_ — Now functional and buildable
- ~~**@typesugar/named-args**~~ _(Removed 2026-03-01)_ — Package deleted, not zero-cost
- ~~**@typesugar/typeclass**~~ _(Resolved 2026-02-28)_ — Architecture fixed, now re-exports from macros
- ~~**@typesugar/strings**~~ _(Resolved 2026-02-28)_ — Tests added (28), macros fixed, completeness now 3/5
- ~~**@typesugar/derive**~~ _(Resolved 2026-02-28)_ — Sum types now implemented
- ~~**@typesugar/units**~~ _(Resolved 2026-02-28)_ — Auto-derive bug fixed, now works with typeclass system
- ~~**@typesugar/validate**~~ _(Resolved 2026-02-28)_ — README was correct all along (not builder DSL), docs 4/5
- ~~**@typesugar/fusion**~~ _(Resolved 2026-03-01)_ — zip/scan/distinct/partition added, macros registered
- ~~**@typesugar/specialize**~~ _(Resolved 2026-02-28)_ — `specialize$` IS exported, signature matches docs
- ~~**@typesugar/contracts-z3**~~ _(Removed 2026-03-01)_ — Package deleted, Z3 too heavy
- ~~**@typesugar/geometry**~~ _(Removed 2026-03-01)_ — Package deleted, niche utility
- ~~**@typesugar/kysely**~~ _(Removed 2026-03-01)_ — Package deleted, minimal value over native Kysely
- ~~**@typesugar/drizzle**~~ _(Removed 2026-03-01)_ — Package deleted, minimal value over native Drizzle
- ~~**@typesugar/operators**~~ _(Removed 2026-03-01)_ — Package deleted, re-exported from umbrella via macros

### Common Issues

1. **Architecture Duplication** — _(Resolved 2026-03-01)_:
   - ~~@typesugar/macros~~ — Now serves as canonical location
   - ~~@typesugar/typeclass~~ — Now properly re-exports from macros
   - ~~@typesugar/operators~~ — Package deleted, umbrella re-exports from macros

2. **Stale Project Names** — _(Resolved 2026-02-28)_
   - Already migrated to `typesugar` throughout codebase
   - Remaining `typemacro`/`ttfx` references are intentional for backwards compatibility (transformer/ESLint recognize old imports)

3. **Missing Tests** — Status updated (2026-03-15):
   - **@typesugar/vscode**: Tests confirmed — 9 test files with 2,014 lines of coverage
   - **@typesugar/eslint-plugin**: Tests confirmed — 3 test files with 945 lines of coverage
   - **@typesugar/strings**: Tests added — 28 tests covering exports, runtime stubs, macro definitions
   - **@typesugar/macros**: 81 global test files cover macros extensively; red team tests added
   - **Packages needing tests (2026-03-16):** None
   - **Resolved (2026-03-16):**
     - ~~**@typesugar/reflect**~~ — Vitest config and 36 tests verified
     - ~~**@typesugar/sql**~~ — 49 tests added (179 total)
     - ~~**@typesugar/erased**~~ — 25 tests added (57 total)
     - ~~**@typesugar/specialize**~~ — 54 behavioral tests added (88 total)
     - ~~**@typesugar/units**~~ — 115 tests added

4. **Documentation/Implementation Drift** — Updated assessment (2026-02-28):
   - ~~**validate**~~: README was correct (compile-time macros + Schema typeclass), not builder DSL
   - ~~**units**~~: .to() method implemented (2026-03-16)
   - ~~**sql**~~: README rewritten to document all features (was under-documented, now comprehensive)
   - ~~**specialize**~~: `specialize$` IS exported with correct signature

5. **Not Leveraging Typeclass System** — Several packages don't use Op<>, summon(), auto-derivation:
   - hlist, erased
   - ~~geometry~~ — Package deleted (2026-03-01)
   - ~~graph~~ — Now uses Monoid/Ord for Dijkstra, compile-time FSM verification (2026-03-01)
   - ~~units~~ — auto-derive bug fixed, now works with typeclass system

### Recommendations (Updated 2026-03-15)

**Active recommendations:**

1. **Expand @typesugar/mapper** — Needs showcase.ts, more examples, extended README
2. ~~**Add package-level tests to reflect**~~ — _(Done 2026-03-17)_ 36 tests verified
3. ~~**Implement @typesugar/units .to() method**~~ — _(Done 2026-03-16)_ Implemented with 115 tests
4. ~~**Consider deprecating @typesugar/comptime**~~ — _(Done 2026-03-15)_ Package removed
5. ~~**Add package-level tests to sql, erased, specialize**~~ — _(Done 2026-03-16)_ All three now have comprehensive tests

**Previously resolved:**

1. ~~**Delete or complete @typesugar/macros**~~ — _(Done)_ Package is now functional
2. ~~**Consolidate typeclass implementations**~~ — _(Done)_ Package now re-exports from macros
3. ~~**Fix documentation/implementation drift**~~ — _(Done 2026-02-28)_ sql README rewritten, validate/specialize were correct
4. ~~**Add Op<> typeclass integration**~~ — graph now uses Monoid/Ord (2026-03-01); fusion still Phase 2 stub
5. ~~**Update stale names**~~ — _(Done)_ Already migrated, remaining refs intentional for backwards compat
6. ~~**Add missing test coverage for strings**~~ — _(Done 2026-02-28)_ 28 tests added
7. ~~**Fix specialize exports**~~ — _(Not needed)_ `specialize$` IS exported with correct signature
8. ~~**Add tests for remaining packages**~~ — drizzle, kysely, operators packages deleted; derive still needs tests

---

_Generated: 2026-02-22_
_Updated: 2026-03-01 — Major pruning: removed @typesugar/named-args, @typesugar/contracts-z3, @typesugar/geometry, @typesugar/kysely, @typesugar/drizzle, @typesugar/operators. Improved @typesugar/graph (compile-time FSM, Monoid Dijkstra) and @typesugar/strings (removed json macro)._
_Updated: 2026-03-15 — Full reassessment. Key improvements: transformer (5/5/5/5), macros (5/5/3/5), effect (5/4/5/5), graph (5/4/5/5), fp (5/4/5/5), type-system (5/4/5/5). New concerns: react (stagnant), mapper (sparse docs), comptime (just re-exports)._
_Updated: 2026-03-16 — Test coverage wave: units (.to() implemented + 115 tests, 2→3), sql (49 tests added, 3→4), erased (25 tests added, 2→3), specialize (54 behavioral tests), mapper (10 API tests)._
_Updated: 2026-03-17 — @typesugar/reflect tests verified: 36 tests (28 + 8 behavioral) pass; vitest config and package-level tests confirmed._
