# Module Evaluation Log

Evaluation of all typesugar modules across 4 dimensions:

1. **Usefulness/Utility** (1-5): How likely are people to use this?
2. **Completeness** (1-5): How thoroughly implemented?
3. **Documentation** (1-5): How complete is the documentation?
4. **Coherence** (1-5): Does it follow design philosophy? Uses auto-derivation, correct operator patterns, favors operators over commands?

---

## @typesugar/codec

**Usefulness**: 3/5 - Solves a real problem (schema versioning/migration) relevant for wire protocols, persistent storage, and APIs. However, most TypeScript projects use simpler JSON or zod/superjson. Niche but valuable where needed.
**Completeness**: 3/5 - JSON and binary codecs work well with solid test coverage. But macros are pass-through stubs ("Phase 2"), no nested schema composition, no streaming codec.
**Documentation**: 3/5 - README has clear problem statement, quick start, evolution rules table. Missing required sections (zero-cost guarantee, package integration), sparse JSDoc.
**Coherence**: 2/5 - Uses defineAttributeMacro but all 5 macros are no-op stubs. No typeclass integration. Essentially a plain runtime library that doesn't leverage typesugar's zero-cost philosophy.
**Summary**: Functional versioned serialization library but doesn't meaningfully integrate with typesugar's core value proposition.

---

## @typesugar/comptime

**Usefulness**: 4/5 - Solves real problems (build info, lookup tables, config parsing) but niche — most TS projects can use bundler plugins instead.
**Completeness**: 4/5 - Well-implemented with vm-based evaluation, permission system (fs/env), circular reference detection, BigInt support, timeout protection.
**Documentation**: 5/5 - Excellent README with clear examples, comprehensive guide page, JSDoc on all exports, runnable showcase.
**Coherence**: 5/5 - Follows typesugar philosophy perfectly — true zero-cost abstraction (values inlined as literals), inspired by Zig as intended.
**Summary**: A well-designed implementation of Zig's comptime concept. Permission-based sandbox is thoughtfully designed.

---

## @typesugar/contracts

**Usefulness**: 4/5 - Design by Contract with compile-time proof elimination is unique value; multi-layer prover differentiates from validation-only alternatives.
**Completeness**: 4/5 - Comprehensive implementation: requires/ensures/old/invariant macros, proof certificates, decidability annotations, laws verification.
**Documentation**: 4/5 - Thorough README with API reference, configuration, examples; excellent showcase with 12 sections; one stale import (@ttfx/contracts).
**Coherence**: 4/5 - Exemplifies zero-cost abstractions through proof elimination; proper macro usage; algebraic rules integrate with typeclass laws.
**Summary**: A mature, sophisticated DbC implementation with unique compile-time proof elimination.

---

## @typesugar/contracts-refined

**Usefulness**: 2/5 - Very narrow use case; bridges two specialized packages for compile-time proof elision. Most projects don't need SMT-style contract proving.
**Completeness**: 3/5 - Core registration/bridging works well. TODO.md reveals incomplete features: @validate integration, cross-function propagation.
**Documentation**: 4/5 - Excellent README with tables, dedicated guide, comprehensive 316-line showcase.ts, good JSDoc.
**Coherence**: 4/5 - Clean "import-to-activate" pattern, zero-cost by design, proper separation of concerns.
**Summary**: Well-architected bridge module but highly specialized use case.

---

## @typesugar/contracts-z3

**Usefulness**: 2/5 - Very niche; SMT-level proof verification is rarely needed. Heavy Z3 WASM dependency (~40MB+, 100-500ms init).
**Completeness**: 3/5 - Solid predicate parser supporting arithmetic, comparisons, logical operators. Good test coverage. Doesn't leverage Z3's full power.
**Documentation**: 4/5 - Clear README with usage patterns, API reference, and performance notes. Comprehensive showcase (262 lines).
**Coherence**: 2/5 - Doesn't align with zero-cost philosophy; SMT solving is inherently expensive. Types inlined "to avoid build issues" (code smell).
**Summary**: Technically sound Z3 integration, but very specialized niche. Heavy dependency and compile-time cost conflict with zero-cost principles.

---

## @typesugar/core

**Usefulness**: 4/5 - Essential foundational infrastructure for macro authors. Indispensable but niche audience (macro authors, not app developers).
**Completeness**: 5/5 - Exceptionally thorough. All 6 macro kinds, full MacroContext, comprehensive diagnostics catalog (~50+ error codes), generic registry.
**Documentation**: 4/5 - Strong README, excellent JSDoc throughout. 482-line showcase. Minor gap: no dedicated feature guide.
**Coherence**: 5/5 - Exemplary adherence to philosophy. Zero-cost Op<> branded type, Rust-inspired diagnostics, modern patterns throughout.
**Summary**: Foundational infrastructure that powers the entire macro system. Well-architected and thoroughly documented.

---

## @typesugar/derive

**Usefulness**: 4/5 - Derive macros for Eq, Clone, Debug, Hash, Json, Builder address extremely common boilerplate patterns.
**Completeness**: 3/5 - Sum type support now implemented (all derives have expandXxxForSumType functions). Clone is shallow (not deep), Eq/Hash use JSON.stringify. Tests exist in root tests/derive.test.ts but not package-local.
**Documentation**: 3/5 - Well-structured README but makes misleading claims about operator support (requires typeclass system).
**Coherence**: 2/5 - Per AGENTS.md, should favor auto-derivation via summon() but requires explicit @derive().
**Summary**: Core functionality improved with sum type support. Tests in root tests/ rather than package-local.

**Update (2026-02-28):** Sum type support added — all derive macros now handle discriminated unions via expandXxxForSumType functions.

---

## @typesugar/drizzle

**Usefulness**: 3/5 - Drizzle already has good type safety; main value is compile-time SQL validation and ConnectionIO-style integration.
**Completeness**: 2/5 - Functional but minimal. Has macros but no tests, fewer helpers than Kysely adapter.
**Documentation**: 4/5 - Well documented: README, dedicated guide, example files. Small issue: JSDoc header says "typemacro" (old name).
**Coherence**: 3/5 - Follows macro patterns correctly. Doesn't leverage deeper typesugar features (no auto-derivation for schemas).
**Summary**: Thin but functional adapter. Documentation solid but implementation lacks tests.

---

## @typesugar/effect

**Usefulness**: 5/5 - Effect-TS is a major ecosystem; provides substantial DX wins with @service, @layer, resolveLayer<R>(), do-notation, typeclass bridge.
**Completeness**: 4/5 - Core features solid: service/layer macros with dependency graph, HKT types, full typeclass hierarchy, 40+ extension methods. Minor type inconsistencies.
**Documentation**: 4/5 - README is comprehensive with API tables, quick start, examples. JSDoc on exports. Minor: some type signatures in showcase don't match actual API.
**Coherence**: 4/5 - Follows zero-cost philosophy well: HKT types correct, extension methods delegate to Effect, dictionary-passing style. Uses `any` casts in instances.
**Summary**: High-quality integration delivering real value for Effect-TS users. @service/@layer/resolveLayer workflow is well-designed with topological sorting.

---

## @typesugar/erased

**Usefulness**: 3/5 - Solves real niche problem (heterogeneous collections with shared capabilities, like Rust's `dyn Trait`), but manual vtable construction is tedious.
**Completeness**: 4/5 - Core functionality solid: 7 built-in capabilities, construction helpers, collection operations, widen/narrow. Missing the erased() macro (Phase 2 stub).
**Documentation**: 5/5 - Excellent README with clear problem statement, working examples, comparison table, zero-cost analysis. Showcase covers all features (350+ lines).
**Coherence**: 3/5 - Clean zero-cost design, but exists in parallel to typeclass system rather than integrating. No use of auto-derivation or summon() for vtable resolution.
**Summary**: Well-documented type erasure library but manual vtable construction contradicts auto-derivation philosophy.

---

## @typesugar/eslint-plugin

**Usefulness**: 5/5 - Essential for any typesugar project using ESLint; without it, floods of false positives for macro imports, decorators, labeled blocks.
**Completeness**: 3/5 - Solid implementation with two processors (fast + full), source map support. However, there are **zero tests**.
**Documentation**: 4/5 - Good README with installation, three config modes. Comprehensive showcase. Missing dedicated guide page.
**Coherence**: 4/5 - Correctly delegates to preprocessor and transformer. N/A for most typesugar design principles since this is build tooling.
**Summary**: Well-designed ESLint integration essential for DX but critically lacks tests.

---

## @typesugar/fp

**Usefulness**: 4/5 - Comprehensive FP toolkit (Option, Either, IO, State, Reader, Writer, Validated, List). Zero-cost Option using `A | null` is innovative.
**Completeness**: 4/5 - Full typeclass hierarchy, 50+ operations per data type, stack-safe IO, bracket/resource management, parallel ops, retry. Missing: explicit instance objects for summon().
**Documentation**: 5/5 - Excellent README, thorough JSDoc on every export, comprehensive 380-line showcase. HKT encoding and zero-cost philosophy clearly explained.
**Coherence**: 4/5 - Strong zero-cost philosophy (null-based Option). Correct $<F, A> encoding. Gap: uses manual instances rather than @typeclass/@instance decorators.
**Summary**: Well-executed, comprehensive FP library embodying zero-cost philosophy. Production-ready. Main gap is macro-based typeclass integration.

---

## @typesugar/fusion

**Usefulness**: 4/5 - Addresses real performance concern (intermediate array allocations in method chains). Similar to Rust iterators, Java Streams, lodash/lazy.
**Completeness**: 3/5 - Good lazy pipeline foundation. However, macro integration is entirely stub - lazyMacro and fusedMacro just pass-through. Missing zip, distinct, scan, partition.
**Documentation**: 4/5 - Excellent README with clear problem/solution framing, API tables. Missing required "Integration" and "Zero-cost guarantee" sections.
**Coherence**: 2/5 - Claims "zero-cost" but doesn't deliver. Runtime LazyPipeline class allocates objects; macros are stubs. No Op<> integration, no auto-derivation.
**Summary**: Well-implemented runtime lazy iterator but contradicts zero-cost principle. Macro integration is stub code.

---

## @typesugar/geometry

**Usefulness**: 2/5 - Niche utility; only relevant for projects doing 2D/3D geometry. Most use three.js or gl-matrix with richer ecosystems.
**Completeness**: 3/5 - Solid basics (points, vectors, transforms, coordinate conversions) but missing quaternions, projection matrices, intersection tests.
**Documentation**: 4/5 - Well-structured README showing type safety benefits. Comprehensive showcase. JSDoc on all exports.
**Coherence**: 2/5 - Achieves zero-cost via branded number[], but **ignores typesugar's core value**: no Op<> operators, no typeclass integration, no extension methods.
**Summary**: Competent standalone geometry library but fails to demonstrate typesugar's capabilities (operators, typeclasses).

---

## @typesugar/graph

**Usefulness**: 3/5 - Solid graph/state machine library with nice DSL, but competes with xstate, graphlib. Verification features are differentiator.
**Completeness**: 4/5 - Comprehensive algorithms (topoSort, BFS, DFS, Dijkstra, SCC), thorough tests (~540 lines). Missing: visualization, generic node typing.
**Documentation**: 3/5 - Good README with algorithm complexity table. Missing dedicated guide page, "Zero-cost guarantee" section.
**Coherence**: 2/5 - Uses modern patterns but doesn't leverage typesugar's core value: no typeclass integration, no comptime(), "compile-time" claim is misleading.
**Summary**: Well-implemented standalone graph library but disconnected from typesugar philosophy.

---

## @typesugar/hlist

**Usefulness**: 3/5 - Niche utility for type-level programming and library authors. LabeledHList's merge/project are strongest value prop.
**Completeness**: 4/5 - Solid API covering construction, positional access, structural ops, labeled ops, higher-order ops. 536 lines of tests.
**Documentation**: 4/5 - Follows module-lifecycle template. README has motivation, API tables, zero-cost explanation. 244-line showcase.
**Coherence**: 3/5 - Good zero-cost principles. However: no typeclass instances, no auto-derivation, no extension methods registered, uses older function-first pattern.
**Summary**: Well-implemented HList but doesn't integrate with modern typeclass/extension system.

---

## @typesugar/kysely

**Usefulness**: 3/5 - Niche audience (Kysely + typesugar users). ConnectionIO integration for FP-style database code is main value-add.
**Completeness**: 2/5 - Basic macros present but no tests directory, no red-team tests. Macros are thin wrappers.
**Documentation**: 3/5 - Good README with examples, API reference. Missing guide in docs/guides/. JSDoc still says "typemacro" (stale).
**Coherence**: 3/5 - Zero-cost macros that compile away. ConnectionIO follows Doobie patterns. No typeclass integration or auto-derivation.
**Summary**: Minimal adapter providing macro wrappers. Undertested and adds limited value over native Kysely.

---

## @typesugar/macros

**Usefulness**: 3/5 - Central macro package providing all built-in macros. Essential for the ecosystem but primarily consumed indirectly via umbrella package.
**Completeness**: 3/5 - Now buildable with proper package.json, tsup.config.ts, vitest.config.ts. Contains 27 source files with comprehensive macro implementations. Still missing dedicated tests directory.
**Documentation**: 2/5 - Has proper package structure but no README.md. Not documented in docs/ anywhere.
**Coherence**: 3/5 - Source code follows typesugar patterns. Now serves as canonical location for macros rather than duplicating.
**Summary**: Now functional and buildable. Main gaps: missing README and dedicated test suite.

**Update (2026-02-28):** Package is now buildable with proper package.json and build configuration. No longer non-functional.

---

## @typesugar/mapper

**Usefulness**: 4/5 - Object mapping is ubiquitous. Genuinely solves common problem, though basic compared to Chimney/AutoMapper.
**Completeness**: 2/5 - Basic mapping works but critical features missing: nested objects (TODO), collection mapping, ignore config not implemented. Only 2 tests.
**Documentation**: 3/5 - Clear README, excellent showcase. Missing required sections per module-lifecycle.
**Coherence**: 2/5 - Achieves zero-cost but doesn't integrate with typeclass system. Could be redesigned as @derive(Mapper<Target>).
**Summary**: Functional proof-of-concept. Misses opportunity to integrate with typesugar's derivation system.

---

## @typesugar/math

**Usefulness**: 4/5 - Addresses real problems: exact rational arithmetic, type-safe Money with currency branding, dimension-tracked matrices.
**Completeness**: 4/5 - Comprehensive API for each type with full typeclass instances. Core functionality production-ready.
**Documentation**: 5/5 - Excellent README with clear sections, JSDoc on all exports, well-structured showcase.ts.
**Coherence**: 4/5 - Uses Op<> return types, branded types for zero-cost safety, dictionary-passing style. Operator syntax (`a + b`) pending transformer integration.
**Summary**: Mature, well-documented math library. Type-safe Money and exact Rational are particularly valuable.

---

## @typesugar/named-args

**Usefulness**: 2/5 - Solves real problem but manual ParamMeta arrays are more boilerplate than problem they fix. Native TS destructured objects are simpler.
**Completeness**: 2/5 - Runtime wrapper works, builder solid, good tests. Phase 2 (compile-time rewriting) is vaporware — macro is no-op.
**Documentation**: 3/5 - README well-structured. Missing required sections: zero-cost guarantee, integration, no guide, no API table.
**Coherence**: 1/5 - **Not zero-cost**: allocates wrappers, Map lookups, array sorting at runtime. **No auto-derivation**. "Compile-time validation" claim is misleading.
**Summary**: Well-tested runtime library that contradicts zero-cost principles. Native TS patterns are strictly better.

---

## @typesugar/operators

**Usefulness**: 3/5 - pipe/flow/compose are useful, but @operators/ops() is explicitly "legacy pattern" in AGENTS.md. Preferred is Op<> on typeclass returns.
**Completeness**: 2/5 - No unit tests exist. showcase.ts substitutes but isn't proper coverage. Missing red-team tests.
**Documentation**: 4/5 - README well-structured with examples, API reference, supported operators list.
**Coherence**: 2/5 - Explicitly labeled "legacy pattern". Op<> typeclass system is preferred. Duplicates src/macros/operators.ts rather than re-exporting.
**Summary**: Competently-implemented but architecturally outdated. Consider deprecating operator mapping in favor of Op<> typeclass integration.

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
**Completeness**: 4/5 - Three extensions fully implemented with tokenizer, source maps, JSX handling. Good test coverage including red-team tests.
**Documentation**: 4/5 - README covers all syntax extensions with before/after examples. JSDoc on major exports. Comprehensive showcase.
**Coherence**: 4/5 - Zero-cost by design (text-level rewriting). Clean architecture. Proper precedence and associativity handling.
**Summary**: Solid infrastructure package enabling custom TypeScript syntax. Well-tested. Internal plumbing not directly consumed by users.

---

## @typesugar/prettier-plugin

**Usefulness**: 5/5 - Essential infrastructure for any project using typesugar custom syntax with Prettier; without it, Prettier crashes on |>, ::, F<\_>.
**Completeness**: 4/5 - Core functionality complete (plugin, round-trip format, CLI, programmatic API), but test coverage thin (~50 lines).
**Documentation**: 5/5 - Excellent README with clear explanation, CLI examples, API reference, integration guide; JSDoc on every export.
**Coherence**: 4/5 - Well-integrated with typesugar architecture, uses preprocessor, handles **binop**.
**Summary**: Essential, well-documented tooling package enabling Prettier on typesugar files. Needs more edge case testing.

---

## @typesugar/react

**Usefulness**: 5/5 - Addresses real pain points: automatic dependency arrays, embedded component hoisting, compile-time purity checks.
**Completeness**: 4/5 - Thorough implementation with full macros. However, fine-grained mode is stubbed, stale module name typemacro/react.
**Documentation**: 4/5 - Well-structured README with transformation examples. Missing dedicated guide in docs/guides/.
**Coherence**: 4/5 - Correctly uses core infrastructure, follows zero-cost principle. Stale module name needs update.
**Summary**: Genuinely useful package bringing Vue/Svelte-style reactivity to React. Core functionality solid and production-ready.

---

## @typesugar/reflect

**Usefulness**: 4/5 - Valuable for form generation, API validation, serialization, ORM mapping. Unique compile-time reflection in TS ecosystem.
**Completeness**: 3/5 - Core features work but validator<T>() only handles primitives—complex types silently skipped. Missing union/intersection.
**Documentation**: 4/5 - Clear README with examples. Good showcase. One example file has API bug.
**Coherence**: 3/5 - Follows macro-based design, zero-cost. But requires explicit @reflect decorator—doesn't leverage auto-derivation pattern.
**Summary**: Solid compile-time reflection but needs better complex type handling and auto-derivation integration.

---

## @typesugar/specialize

**Usefulness**: 3/5 - Valuable for FP codebases but niche. Most projects won't need explicit specialization when @implicits handles it automatically.
**Completeness**: 2/5 - Package re-exports from @typesugar/macros. Real inlining logic in packages/macros/src/specialize.ts. **Export gap**: `specialize$` macro exists but runtime stub not exported — imports would fail.
**Documentation**: 3/5 - README well-structured but has issues: (1) `specialize$` not exported so examples fail, (2) signature mismatch — README shows `specialize$(call)` but macro takes `specialize$(dict, expr)`.
**Coherence**: 3/5 - Uses correct patterns but doesn't deliver on "zero-cost" promise. @implicits is preferred path per AGENTS.md.
**Summary**: Export and signature issues discovered. `specialize$` macro exists but can't be imported. Documentation shows wrong signature.

**Update (2026-02-28):** New issues found — `specialize$` runtime stub missing from exports, signature mismatch between docs and implementation.

---

## @typesugar/sql

**Usefulness**: 3/5 - SQL query building is common, but mature alternatives exist (Kysely, Drizzle, Prisma). Doobie-style appeals mainly to Scala developers.
**Completeness**: 4/5 - Comprehensive implementation: sql$ macro exists (in infer-macro.ts), @deriving(Read/Write/Codec) fully implemented, TypedFragment/TypedQuery/TypedUpdate system, Meta/Get/Put typeclass hierarchy, select().from().where() query builder DSL.
**Documentation**: 2/5 - README is now **outdated** — significantly under-documents features that exist. Many implemented features (sql$, TypedFragment, schema decorator) not documented.
**Coherence**: 4/5 - Good conceptual alignment. Macro integration now complete. Auto-derivation working for Read/Write/Codec.
**Summary**: More complete than previously assessed. README needs updating to reflect implemented features.

**Update (2026-02-28):** Previous assessment incorrect — sql$ macro and @deriving(Read/Write/Codec) ARE implemented. README is outdated (under-documents), not overselling.

---

## @typesugar/std

**Usefulness**: 5/5 - Extremely practical stdlib with 300+ extension methods (clamp, chunk, groupBy, camelCase), pattern matching macro, do-notation.
**Completeness**: 4/5 - Core functionality production-ready. Some advanced typeclasses are interfaces only. Tests exist but no red-team coverage.
**Documentation**: 4/5 - Good README with examples and API tables. Excellent showcase. Missing dedicated guide, inconsistent JSDoc on some exports.
**Coherence**: 4/5 - Uses Op<> typeclass pattern correctly. Match macro compiles to zero-cost code (ternary chains, switch, binary search).
**Summary**: Solid, high-value standard library. ~1400-line match.ts demonstrates zero-cost philosophy well.

---

## @typesugar/strings

**Usefulness**: 2/5 - Limited real-world demand. regex marginally useful, html XSS redundant in frameworks, json duplicates object literals, fmt incomplete.
**Completeness**: 2/5 - fmt macro explicitly incomplete, zero tests in package, uses stale project name (typemacro prefix).
**Documentation**: 3/5 - README covers all macros with examples, guide exists. Missing JSDoc comments.
**Coherence**: 2/5 - Stale naming, doesn't leverage typeclass system, html generates runtime helper calls (not truly zero-cost).
**Summary**: Thin wrapper around basic string operations with limited compile-time value. Consider deprecating or completing fmt.

---

## @typesugar/symbolic

**Usefulness**: 4/5 - Valuable for CAS, education, physics, LaTeX generation. Niche audience but well-executed.
**Completeness**: 4/5 - Comprehensive AST, differentiation, basic integration, 3 rendering formats, pattern matching, equation solving.
**Documentation**: 5/5 - Excellent README with full API coverage, comprehensive showcase with type assertions, thorough JSDoc.
**Coherence**: 4/5 - Properly uses Op<> typeclass, provides Numeric<Expression<T>> instance, uses Refined<> for division safety. Comprehensive red-team tests (1334 lines).
**Summary**: Well-implemented symbolic math package following typesugar patterns correctly. Production-ready for intended use cases.

---

## @typesugar/testing

**Usefulness**: 4/5 - Power assertions with sub-expression capture, compile-time assertions, type-level assertions, property-based testing, parameterized tests.
**Completeness**: 4/5 - All core features implemented. Missing advanced PBT features (shrinking, generator combinators, refined type integration).
**Documentation**: 5/5 - Excellent README showing actual failure output, comprehensive API reference, Vitest integration guide. JSDoc on all public APIs.
**Coherence**: 4/5 - Follows typesugar philosophy: staticAssert/typeAssert have zero runtime cost, uses proper macro infrastructure. @derive(Arbitrary) fits auto-derivation pattern.
**Summary**: Well-implemented testing macro package bringing power-assert style diagnostics to TypeScript. Solid implementation and thorough documentation.

---

## @typesugar/transformer

**Usefulness**: 5/5 - Core build infrastructure. Every typesugar user depends on this. Provides engine for all macro expansion, preprocessing, IDE integration.
**Completeness**: 4/5 - Very comprehensive: full ts-patch transformer (~1500 lines), TransformationPipeline with source map composition, language service plugin, caching, rich CLI.
**Documentation**: 3/5 - README covers installation, configuration, CLI commands. Missing deeper architectural explanation, troubleshooting, visual examples.
**Coherence**: 5/5 - As build infrastructure, correctly doesn't use typeclasses itself—it enables them. Fully aligned with zero-cost philosophy. Modern patterns throughout.
**Summary**: Essential, well-implemented build infrastructure forming backbone of typesugar. Production-ready with comprehensive CLI and IDE integration.

---

## @typesugar/ts-plugin

**Usefulness**: 5/5 - Essential infrastructure. Without this, custom syntax would show red squiggles in IDEs.
**Completeness**: 3/5 - Intentionally thin wrapper (23 lines) delegating to transformer/language-service. Good architecture. Missing tests.
**Documentation**: 4/5 - Strong README with installation, config options, debugging guide, architecture explanation.
**Coherence**: 4/5 - Follows design principles: single source of truth, CommonJS format as required by TS. Missing standard package files per module-lifecycle.
**Summary**: Well-designed thin wrapper delegating to canonical implementation. Excellent docs but incomplete per module-lifecycle standards.

---

## @typesugar/type-system

**Usefulness**: 4/5 - High utility for type-safe TS. Refinement types (Port, Byte, Email), newtypes, HKT encoding, Vec solve real problems.
**Completeness**: 3/5 - Good API coverage but showcase.ts has API mismatches with implementation. No dedicated test suite.
**Documentation**: 4/5 - Excellent README with feature organization, branding spectrum table. Some examples don't compile due to API drift.
**Coherence**: 3/5 - Good zero-cost design (wrap/unwrap compile away). Uses macro infrastructure. Misses deeper integration with Op<> typeclass patterns.
**Summary**: Well-designed type-level programming library. Zero-cost philosophy honored but operates standalone rather than integrating with typeclass system.

---

## @typesugar/typeclass

**Usefulness**: 4/5 - Typeclasses are powerful, widely-applicable abstraction pattern for generic programming. Excellent for Scala-style ad-hoc polymorphism.
**Completeness**: 2/5 - Package is now a re-export facade. Delegates to @typesugar/macros for actual implementations. Still missing comprehensive tests.
**Documentation**: 3/5 - README has decent structure but doesn't reflect implementation limitations.
**Coherence**: 3/5 - Architectural issue resolved: now properly re-exports from @typesugar/macros rather than duplicating. Single source of truth maintained.
**Summary**: Re-export facade for typeclass macros. Architecture improved — no longer duplicates implementation.

**Update (2026-02-28):** Architectural duplication resolved. Package now correctly re-exports from @typesugar/macros.

---

## typesugar (umbrella)

**Usefulness**: 5/5 - Essential entry point for ecosystem. "One import to rule them all" - every user needs this for macros, bundler plugins, CLI.
**Completeness**: 4/5 - Comprehensive re-exports from all major packages with bundler entry points and CLI. No dedicated test suite (only showcase.ts).
**Documentation**: 4/5 - Well-structured README with installation, quick start, features table, bundler configs. Showcase (265 lines) excellent.
**Coherence**: 3/5 - Stale references to "typemacro". README emphasizes @operators class decorator rather than preferred Op<> typeclass approach.
**Summary**: Solid umbrella package consolidating ecosystem into one import. Main issues are stale references and not showcasing preferred Op<> pattern.

---

## @typesugar/units

**Usefulness**: 3/5 - Real use case for scientific/engineering domains, but niche for general TypeScript.
**Completeness**: 2/5 - Core dimension tracking works. README documents .to() method that doesn't exist. Temperature handling incorrect. Many missing features per TODO.md.
**Documentation**: 3/5 - Well-structured README. Documents non-existent features. Missing required sections per module-lifecycle.
**Coherence**: 2/5 - Major miss: doesn't use typeclass system at all. Uses .add()/.mul() methods instead of Op<> operators. Feels like standalone library.
**Summary**: Functional dimension-tracking but doesn't leverage typesugar philosophy. Would benefit from Numeric/Ord typeclasses and Op<> pattern.

---

## unplugin-typesugar

**Usefulness**: 5/5 - Essential for any real project; provides plugins for all major bundlers (Vite, Webpack, esbuild, Rollup).
**Completeness**: 4/5 - Covers all major bundlers with include/exclude, verbose mode, syntax extensions, cache invalidation, source maps. Minor example file shows non-existent options.
**Documentation**: 4/5 - Clear examples for all 4 bundlers, explains lifecycle, documents type-checker limitation. Minor README/implementation drift.
**Coherence**: 5/5 - Uses unified TransformationPipeline, follows modern unplugin patterns, correctly delegates transformation. Build-time only = zero-cost.
**Summary**: Well-architected bundler integration. Production-ready for all major bundlers with minor documentation drift.

---

## @typesugar/validate

**Usefulness**: 3/5 - Solves real need for type-safe validation, but competes with mature alternatives (Zod, Valibot) without significant differentiation.
**Completeness**: 2/5 - Has Schema typeclass abstraction (for Zod/Valibot/native integration) and tests. However, README shows Zod-like builder DSL (`Schema.object()`, `Schema.string().minLength()`) that doesn't exist. Console.logs still in production code (4 locations).
**Documentation**: 1/5 - README **severely misleading** — shows builder DSL API that doesn't exist at all. Actual implementation is a typeclass abstraction over validation libraries, not a DSL itself. Missing required sections per module-lifecycle.
**Coherence**: 3/5 - Correctly uses macro infrastructure and HKT encoding. Integrates with @typesugar/fp. Uses verbose AST factory instead of quote().
**Summary**: Has functional Schema typeclass but README documents a completely different API (builder DSL) that was never implemented. Major documentation/implementation mismatch.

**Update (2026-02-28):** Documentation score lowered — README shows builder DSL that doesn't exist. Schema typeclass exists but is NOT the builder pattern shown in README.

---

## @typesugar/vscode

**Usefulness**: 4/5 - Essential DX for typesugar projects; provides semantic highlighting, CodeLens, inlay hints, code actions, diagnostics.
**Completeness**: 4/5 - Comprehensive feature set: 7 semantic token types, manifest-driven macro detection, TS language service plugin. Missing test coverage.
**Documentation**: 4/5 - Excellent README with architecture diagram, settings table, manifest format docs. Source files have file-level JSDoc.
**Coherence**: 5/5 - Manifest-driven architecture adapts to custom macros without code changes. Properly integrates with transformer/pipeline. Follows VS Code best practices.
**Summary**: Well-architected VS Code extension providing essential IDE support. Manifest-driven design is elegant. Main gaps: missing tests, heuristic expansion extraction.

**Update (2026-02-22):** Test gap addressed — 83+ unit tests added covering ManifestLoader, SemanticTokensProvider, CodeLensProvider, InlayHintsProvider, ExpansionService, DiagnosticsManager, and error scenarios. Integration tests added for Extension Host activation, provider registration, and command execution. TS plugin tests added via language service harness.

---

# SUMMARY

## Score Distribution

| Score | Count | Packages                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5/5   | Many  | eslint-plugin (usefulness), transformer (usefulness), ts-plugin (usefulness), unplugin (usefulness), std (usefulness), umbrella (usefulness), prettier-plugin (usefulness, docs), react (usefulness), effect (usefulness), testing (docs), erased (docs), symbolic (docs), math (docs), comptime (docs, coherence), core (completeness, coherence), transformer (coherence), unplugin (coherence), vscode (coherence) |
| 4/5   | Many  | sql (completeness, coherence) *(improved)*, (see individual evaluations)                                                                                                                                                                                                                                                                                                                                                          |
| 3/5   | Many  | macros (completeness) *(improved from 1)*, typeclass (coherence) *(improved from 2)*, derive (completeness) *(improved from 2)*, (see individual evaluations)                                                                                                                                                                                                                                                                                                                                                                                          |
| 2/5   | Many  | sql (docs) *(worsened from 3)*, (see individual evaluations)                                                                                                                                                                                                                                                                                                                                                          |
| 1/5   | 2     | ~~macros (completeness, docs)~~ *(now 3/5, 2/5)*, named-args (coherence), validate (docs) *(worsened from 2)*                                                                                                                                                                                                                                                                                                                                                                   |

## Key Patterns Identified

### Strong Packages (avg >= 4.0)

- **@typesugar/core** — Exemplary infrastructure, well-documented, high coherence
- **@typesugar/comptime** — Perfect zero-cost implementation, excellent docs
- **@typesugar/transformer** — Essential, comprehensive, production-ready
- **@typesugar/std** — High-value stdlib, 300+ methods, good match macro
- **@typesugar/testing** — Power assertions, compile-time assertions, solid
- **@typesugar/fp** — Comprehensive FP library, null-based Option is innovative
- **@typesugar/effect** — High-quality Effect-TS integration
- **@typesugar/prettier-plugin** — Essential tooling, well-documented
- **@typesugar/symbolic** — Well-implemented with good Op<> usage and red-team tests
- **@typesugar/math** — Mature library with proper typeclass integration
- **@typesugar/vscode** — Well-architected extension with manifest-driven design, tests confirmed
- **@typesugar/sql** — *(Added 2026-02-28)* More complete than assessed; sql$, @deriving(Read/Write/Codec), TypedFragment implemented

### Packages Needing Work (avg <= 2.5)

- ~~**@typesugar/macros**~~ *(Removed 2026-02-28)* — Now functional and buildable
- **@typesugar/named-args** — Not zero-cost, contradicts philosophy
- ~~**@typesugar/typeclass**~~ *(Removed 2026-02-28)* — Architecture fixed, now re-exports from macros
- **@typesugar/strings** — Limited value, incomplete fmt, stale naming
- ~~**@typesugar/derive**~~ *(Removed 2026-02-28)* — Sum types now implemented
- **@typesugar/units** — Doesn't use typeclass system, documents non-existent API
- **@typesugar/validate** — README shows builder DSL that doesn't exist (worse than previously assessed)
- **@typesugar/fusion** — Claims zero-cost but macros are stubs
- **@typesugar/specialize** — *(Added 2026-02-28)* Export missing (`specialize$`), signature mismatch

### Common Issues

1. **Architecture Duplication** — Status improved (2026-02-28):
   - ~~@typesugar/macros~~ — Now serves as canonical location
   - ~~@typesugar/typeclass~~ — Now properly re-exports from macros
   - **Remaining**: @typesugar/operators still duplicates rather than re-exporting

2. **Stale Project Names** — References to "typemacro" and "@ttfx" more widespread than documented:
   - **Previously noted**: contracts README, drizzle JSDoc, kysely JSDoc, strings, react, umbrella
   - **Core macro registration**: `module: "typemacro"` in implicits.ts, comptime.ts, many test fixtures
   - **Root config files**: vitest.config.ts variable name, .gitignore cache directory
   - **Cache system defaults**: `.typemacro-cache/` hardcoded in packages/core/src/cache.ts
   - **Hygiene system**: generates `__typemacro_*` identifiers (packages/core/src/hygiene.ts)
   - **examples/basic/**: Entire README and source files use old name
   - **JSDoc in core packages**: specialize.ts, quote.ts, types.ts still reference "typemacro"

3. **Missing Tests** — Status updated (2026-02-28):
   - **@typesugar/vscode**: Tests confirmed — 9 test files with 2,014 lines of coverage
   - **@typesugar/eslint-plugin**: No tests/ directory at all
   - **Empty tests/ directories** (have vitest.config.ts but no test files): derive, drizzle, kysely, operators, strings
   - **@typesugar/macros**: Now buildable but still lacks tests

4. **Documentation/Implementation Drift** — Updated assessment (2026-02-28):
   - **validate**: README shows builder DSL that doesn't exist (SEVERE drift)
   - **units**: .to() method documented but not implemented
   - **sql**: ~~sql$ macro~~ CORRECTED — sql$ macro EXISTS, README is outdated (under-documents)
   - **specialize**: `specialize$` not exported, signature mismatch in README

5. **Not Leveraging Typeclass System** — Several packages don't use Op<>, summon(), auto-derivation:
   - geometry, graph, hlist, units, fusion, erased

### Recommendations

1. ~~**Delete or complete @typesugar/macros**~~ — *(Done)* Package is now functional
2. ~~**Consolidate typeclass implementations**~~ — *(Done)* Package now re-exports from macros
3. **Fix documentation/implementation drift** — Priority: validate (severe), specialize (export/signature), sql (under-documented)
4. **Add Op<> typeclass integration** — geometry, units, fusion should use operators
5. **Update stale names** — Scope larger than expected: core macro registration, cache system, hygiene, vitest config, examples/basic
6. **Add missing test coverage** — Priority: eslint-plugin (no tests/ at all), then derive, drizzle, kysely, operators, strings (empty tests/)
7. **Fix specialize exports** — Add `specialize$` runtime stub to exports, fix signature documentation

---

_Generated: 2026-02-22_
_Updated: 2026-02-28_
