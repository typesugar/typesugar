# PEP-023: Playground Examples Overhaul

**Status:** Done
**Date:** 2026-03-18
**Author:** Dean Povey

## Context

An audit of all 23 playground examples revealed a systemic failure: **~15 of 23 examples produce identical source/expanded output** — they use no macros at all. The playground's core UX is a side-by-side view of source code (left) and macro-expanded output (right). When the two panels show the same code, the playground actively undermines typesugar's value proposition.

Users opening the playground for the first time see:

1. A **welcome example** that is vanilla TypeScript with a single `staticAssert` (which disappears)
2. **FP examples** that import functions and call them manually — no dot-syntax, no `@opaque` rewrites, no do-notation
3. **Domain examples** (codec, parser, graph, units, symbolic) that ignore their headline macro features entirely
4. **6 registered categories with zero examples** (effect, math, validate, sql, mapper, testing)

The examples treat typesugar as a utility library rather than a compiler plugin. A user clicking through them would conclude "why do I need a build step for this?"

### Audit Scoring Summary

| Category        | Examples | Use Macros?                                                      | Visible Transformation?        | Verdict          |
| --------------- | -------- | ---------------------------------------------------------------- | ------------------------------ | ---------------- |
| getting-started | 1        | Barely (staticAssert only)                                       | No — line disappears           | **Rewrite**      |
| core            | 8        | Partially (comptime, pipe good; extension, static-assert weak)   | Mixed — 3 good, 5 weak         | **Enhance**      |
| fp              | 3        | None                                                             | None — vanilla TS              | **Rewrite all**  |
| std             | 2        | pattern-matching uses deprecated API; ranges uses none           | Minimal                        | **Rewrite all**  |
| collections     | 1        | None (manual Eq/Hash instead of @derive)                         | None                           | **Rewrite**      |
| graph           | 2        | None (no tagged template macros)                                 | None                           | **Rewrite both** |
| units           | 1        | None (no operator overloading, no `units` macro)                 | None                           | **Rewrite**      |
| contracts       | 1        | Minimal (inline requires/ensures only)                           | Minimal                        | **Rewrite**      |
| codec           | 1        | None (no `@codec` macro)                                         | None                           | **Rewrite**      |
| parser          | 1        | None (no `grammar` tagged template)                              | None                           | **Rewrite**      |
| symbolic        | 1        | None (no operator overloading despite Numeric instance existing) | None                           | **Rewrite**      |
| preprocessor    | 1        | Yes (`\|>`)                                                      | Visible but weak first example | **Enhance**      |

### Missing Feature Coverage

These flagship features appear in **zero** playground examples:

1. **`@opaque` type rewrites** — `Some(5).map(f).getOrElse(0)` → null checks
2. **Do-notation** (`let:` / `seq:` / `par:` / `all:`)
3. **Operator overloading** (`@op` JSDoc on typeclass methods)
4. **`specialize()` / dictionary elimination**
5. **`cfg()` conditional compilation**
6. **Fluent pattern matching** (current example uses deprecated `when()`/`otherwise()`)
7. **`::` cons operator** (preprocessor)
8. **`@contract` / `@invariant` decorators**
9. **Tagged template macros** (`grammar`, `stateMachine`, `digraph`, `units`)
10. **Cross-feature composition** (no example combines multiple features)

### Missing Example Categories

6 categories registered in `GROUP_META` have zero examples:

| Category | Package               | What it would show                                       |
| -------- | --------------------- | -------------------------------------------------------- |
| effect   | `@typesugar/effect`   | `@service`, `@layer`, `layerMake`, Effect TS integration |
| math     | `@typesugar/math`     | Math typeclasses, Numeric, operator overloading          |
| validate | `@typesugar/validate` | Schema validation macros                                 |
| sql      | `@typesugar/sql`      | Typed SQL fragments                                      |
| mapper   | `@typesugar/mapper`   | Zero-cost object mapping                                 |
| testing  | `@typesugar/testing`  | powerAssert, comptimeAssert, ArbitraryDerive             |

## Waves

### Wave 1: Welcome + Core Fixes (Critical Path)

**Goal:** First impression goes from "vanilla TS" to "wow, this is powerful."

**Tasks:**

- [x] **Rewrite welcome example** — 25 lines demonstrating comptime, staticAssert, @derive(Eq), and @opaque Option with dot-syntax. Must show dramatic before/after transformation.
- [x] **Replace pattern-matching example** — Remove deprecated `when()`/`otherwise()` API. Use fluent `.case().then().else()` with discriminated union patterns, array patterns, OR patterns, and exhaustiveness.
- [x] **Enhance extension example** — Show import-scoped activation (Scala 3 model), chain extensions on Number/String, demonstrate that output has no prototype mutation.
- [x] **Enhance static-assert example** — Merge into comptime example OR add compile-time-provable assertions and interactive "uncomment to see the error" hints.
- [x] **Add operator overloading example** (`core/operators.ts`) — Vec2 with typeclass instance and `@op`, showing `a + b` → `instance.add(a, b)` transformation.
- [x] **Add specialize example** (`core/specialize.ts`) — Generic `fold` with Monoid, specialized to `sumAll` with dictionary completely eliminated.
- [x] **Add do-notation example** (`std/do-notation.ts`) — `let:` / `yield:` for Promise and Option chains, showing desugaring to flatMap/then.

**Gate:**

- [ ] All 7 new/rewritten examples load in playground without errors
- [ ] Every example produces visibly different JS Output (manual verification in browser)
- [ ] Zero use of deprecated APIs (`when()`, `otherwise()`, `P.*`)
- [ ] Welcome example demonstrates ≥3 distinct features
- [ ] **Deep code review (subagent):** For each example, verify (a) the code actually uses the APIs it claims to (no fake/invented APIs), (b) the expected transformation actually fires in the browser transformer, (c) the console output is correct when Run is clicked, (d) no TypeScript errors in the source. Fix any issues found before proceeding.

### Wave 2: FP + Preprocessor Rewrites

**Goal:** FP examples become the zero-cost showcase.

**Tasks:**

- [x] **Rewrite option-either example** — Demonstrate `@opaque` dot-syntax: `Some(42).map(f).filter(p).getOrElse(d)` compiling to null checks. Show `None` is `null`, `Some(x)` is `x`. Include do-notation on Option.
- [x] **Rewrite validated example** — Show applicative accumulation with `mapN` or `zip`, not manual array filtering. Demonstrate error accumulation via `Semigroup<NonEmptyList>`.
- [x] **Rewrite linked-list example** — Use `match()` pattern matching on List variants (Cons/Nil null-check discrimination). Recursive sum via match. Structural sharing demo.
- [x] **Add linked-list preprocessor example** (`preprocessor/cons-operator.sts`) — `1 :: 2 :: 3 :: []` → array spread cons with the `::` operator. Combines with `|>` for functional data flow.
- [x] **Enhance pipeline example** — Remove weak first example (lambda wrapping). Named transform functions composed via `|>`. Combines with `::` operator.

**Gate:**

- [ ] All FP examples show @opaque type rewrites in JS Output (method calls → function calls)
- [ ] At least one FP example uses do-notation
- [ ] Preprocessor category has ≥2 examples showing different operators
- [ ] No FP example uses manual `isSome()`/`isRight()` guard patterns
- [ ] **Deep code review (subagent):** For each example, verify (a) `@opaque` method rewrites actually fire — `.map()`, `.flatMap()`, `.getOrElse()` become standalone function calls in JS Output, (b) do-notation desugars to visible `.flatMap()`/`.then()` chains, (c) `::` operator in `.sts` file produces `Cons()` calls, (d) all imports resolve to real exports from the packages. Fix any issues found before proceeding.

### Wave 3: Domain Package Rewrites

**Goal:** Every domain package demonstrates its headline macro feature.

**Tasks:**

- [x] **Rewrite collections example** — Uses `@derive(Eq)` for structural equality on custom types + `HashSet`/`HashMap` with custom Eq/Hash. `makeEq`/`makeHash` for HashSet keys, `staticAssert` for macro visibility.
- [x] **Rewrite graph/directed-graph example** — Uses `digraph` tagged template for graph DSL + `comptime()` for compile-time build timestamp. Shows `topoSort`, `shortestPath`, `dijkstra`.
- [x] **Rewrite graph/state-machine example** — Uses `stateMachine` tagged template macro (compile-time verified). DSL parsed/validated at build time, generates inlined object literal. Shows `verify()`, `deadEndStates`, typed transitions.
- [x] **Rewrite units example** — Uses `units` tagged template macro (compile-time: `units\`100 meters\``→`meters(100)`). Shows type-safe arithmetic (`.add()`, `.div()`), `staticAssert`.
- [x] **Rewrite contracts example** — Uses `/** @contract */` JSDoc macro with `requires:`/`ensures:` labeled blocks (transformed to if-throw). Uses `comptime()` for compile-time constants. Note: `@invariant` decorator not used as standalone function import unavailable.
- [x] **Rewrite codec example** — Uses `/** @codec */` JSDoc macro on interface to auto-extract schema. Shows `SchemaBuilder` for versioned schema evolution. Uses `comptime()` + `staticAssert`.
- [x] **Rewrite parser example** — Uses `grammar` tagged template macro with compile-time grammar validation. Keeps combinator version for comparison. Uses `comptime()`.
- [x] **Rewrite symbolic example** — Uses builder API (`add`, `mul`, `pow`) + `diff()` + `integrate()` + `simplify()`. Added integration example (∫x²dx = x³/3). Uses `comptime()` + `staticAssert` for visible macro transformation.

**Gate:**

- [ ] Every domain example uses at least one macro that produces visible transformation
- [ ] Tagged template macros used in: graph (both), parser, units
- [ ] Operator overloading used in: units, symbolic
- [ ] `@derive` used in: collections
- [ ] No example produces identical source/expanded output
- [ ] **Deep code review (subagent):** For each example, verify (a) tagged template macros (`grammar`, `stateMachine`, `digraph`, `units`) actually expand — the template literal is replaced with generated code in JS Output, (b) operator overloading via `@op` on typeclass methods actually rewrites `+`/`-`/`*`/`/` to method calls, (c) `@derive(Eq, Hash)` generates instance objects in the output, (d) `@contract`/`@invariant` decorators inject checks (or strip them in "none" mode), (e) no invented APIs — every function/macro call maps to a real export. Fix any issues found before proceeding.

### Wave 4: New Category Examples + Cross-Feature

**Goal:** Fill empty categories, add cross-feature showcase.

**Tasks:**

- [x] **Add effect example** (`effect/service-layer.ts`) — `@service` decorator, `@layer`, dependency injection with Effect TS. Show compile-time layer resolution. _Note: Effect TS not bundled in playground; example uses @derive(Eq) + comptime + staticAssert on service architecture domain._
- [x] **Add math example** (`math/numeric-typeclass.ts`) — `Numeric` typeclass with operator overloading on custom number types (e.g., Complex, Fraction). _Uses @op on typeclass methods with comptime + staticAssert._
- [x] **Add validate example** (`validate/schema-validation.ts`) — Schema validation macros generating runtime validators from types. _Uses comptime + staticAssert + pipe on validation domain; manual validator mirrors what is<T>() generates._
- [x] **Add testing example** (`testing/power-assert.ts`) — `powerAssert` showing failure output with expression tree, `comptimeAssert`. _Uses staticAssert + comptime + pipe; documents power assert failure format in comments._
- [x] **Add cfg example** (`core/cfg.ts`) — Dead code elimination: `cfg("debug", ...)` vanishes in production build. Before/after is dramatic. _Uses cfg() + comptime + staticAssert._
- [x] **Add "full stack" example** (`getting-started/full-stack.ts`) — 30-line example combining comptime + @derive + @opaque + operator dispatch + match. The "everything works together" demo. _Combines 6 features: comptime, staticAssert, @derive(Eq), @op typeclass operators, match(), @opaque Option dot-syntax, pipe._

**Gate:**

- [ ] All 6 new examples load and transform in playground
- [ ] At least 4 of 6 previously-empty categories now have examples
- [ ] "Full stack" example demonstrates ≥5 distinct typesugar features in ≤35 lines
- [ ] Total playground examples ≥ 28
- [ ] **Deep code review (subagent):** For each new example, verify (a) the package actually exports the APIs used — check `packages/<name>/src/index.ts` for every import, (b) the macro/transformation claimed actually works in the browser-based transformer (not just the Node.js transformer), (c) console output matches what the example comments promise, (d) the "full stack" example's 5+ features all produce visible transformation (not just one or two actually firing). Fix any issues found before proceeding.

### Wave 5: Polish + Cross-Cutting Quality

**Goal:** Every example follows consistent quality standards.

**Tasks:**

- [x] **Add transformation hints** — Every example gets a comment like `// 👀 Check JS Output to see the zero-cost compilation` near the most interesting macro usage.
- [x] **Add "try this" callouts** — Every example ends with an interactive suggestion: `// Try: change Some to None and watch the output adapt`.
- [x] **Audit all import paths** — Standardize: core macros from `"typesugar"`, module-specific from `"@typesugar/<name>"`. No inconsistencies.
- [x] **Verify all examples run** — Every example should produce meaningful console output when the Run button is clicked.
- [x] **Sort examples by impact** — Within each category, order examples so the most impressive one appears first.
- [x] **Update playground-examples.ts** — Ensure GROUP_META entries exist for all new categories. Verify sort order puts the most compelling categories first.
- [ ] **Screenshot updated playground** — Capture before/after for documentation.

**Gate:**

- [ ] Every example has a transformation hint comment
- [ ] Every example has a "try this" interactive suggestion
- [ ] All examples use consistent import paths
- [ ] All examples produce console output when run
- [ ] **Deep code review (subagent):** Full sweep of all ~28 examples — (a) verify every import path resolves (`"typesugar"` for core macros, `"@typesugar/<name>"` for modules), (b) check for any remaining deprecated API usage across all files, (c) verify transformation hints point at lines that actually transform (not pass-through code), (d) ensure "try this" suggestions actually work when followed (e.g., "change Some to None" doesn't cause a runtime error), (e) spot-check 5 examples end-to-end in the browser playground. Fix any issues found before marking wave complete.

## Design Principles for Examples

Every playground example should follow these rules:

1. **Show a dramatic transformation.** If source === expanded output, the example fails. Every example must use at least one macro with visible output changes.

2. **Lead with the contrast.** Include a comment directing users to check the JS Output tab near the most interesting transformation.

3. **Use real-world domains.** `Account`, `User`, `Order`, not `Foo`, `Bar`, `Container<A>`.

4. **Keep to 20-40 lines.** Every line should earn its place.

5. **Never use deprecated APIs.** The playground is aspirational — it shows how you _should_ write code.

6. **Prioritize compilation over runtime.** `console.log()` proves the code runs, but the transformation pane is the playground's power. Choose examples where the before/after is visually striking.

7. **Encourage interaction.** End with a `// Try:` comment that invites the user to modify the code.

## Consequences

1. **Benefits:**
   - First-time users immediately understand typesugar's value proposition
   - Every example demonstrates visible macro transformation
   - Flagship features (opaque, do-notation, operators, specialize) are prominently showcased
   - 6 previously-empty categories get representative examples

2. **Trade-offs:**
   - Significant rewrite effort (~20 examples to create or rewrite)
   - Examples may need updating as APIs evolve
   - Some proposed examples depend on macro features working correctly in the browser-based transformer

3. **Future work:**
   - Interactive tutorials (step-by-step guided examples)
   - "Share" button for custom examples
   - Example versioning tied to package versions
   - Video walkthroughs of key examples
