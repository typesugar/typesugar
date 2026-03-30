# typesugar TODO

## Language Features

1. **Zero-Cost Optics (`@optics` / `Lens`)**
   - **What:** A macro that generates type-safe, zero-cost lenses for data structures.
   - **Why:** Deep immutable updates in TypeScript are verbose. This compiles to direct object spread operations with zero runtime overhead and fully typed paths.

2. **Zero-Cost Array Comprehensions**
   - **What:** A macro that compiles declarative list comprehensions (e.g., `[for (x of items) if (x > 0) x * 2]`) into highly optimized, single-pass `for` loops.
   - **Why:** Avoids intermediate array allocations from `.map().filter()`, fitting the zero-cost abstraction philosophy perfectly.

3. **Standalone `@specialize` Macro (Non-Typeclass)**
   - **What:** A `@specialize` annotation for generic functions outside the typeclass system, enabling C++-style template specialization.
   - **Why:** Sometimes you want to monomorphize a generic function for a specific type without defining a full typeclass. The transformer would generate specialized versions at call sites where the type argument is known.
   - **Challenge:** Tricky when the specialized function is passed as a callback (e.g., to `map`, `reduce`). Would need to trace through higher-order functions or limit to direct call sites.

4. **Keyword / Named Arguments**
   - **What:** A preprocessor feature that allows calling functions with named arguments (e.g., `fn(a=1, b=2)`).
   - **Why:** The macro rewrites them into positional arguments at compile time based on the function signature, bringing Python/C#-style named arguments to TS with zero runtime cost.

5. **`transformInto` Macro Expansion (`@typesugar/mapper`)**
   - **What:** Implement `transformInto<S, T>()` as a compile-time macro in the transformer. Currently it throws at runtime; the macro must expand to zero-cost object mapping code.
   - **Why:** Mapper tests are skipped until this is implemented. See `packages/mapper/src/__tests__/mapper.test.ts`.

6. **Deep-Type Compatibility Checking (`@typesugar/mapper`)**
   - **What:** Add recursive deep-type compatibility checking to the `transformInto` macro.
   - **Why:** To ensure nested objects and complex mappings strictly adhere to the target type without runtime mapping errors.

7. **Nested pattern merging** — Decision tree fusion across nested `match()` calls.

## Polymorphic Result (`@typesugar/result`)

Inspired by [~/src/experiments/result](~/src/experiments/result) — a Scala 3 experiment where
`Result[E, T, F[_]]` is a typeclass algebra that lets functions return into any error-handling
type (Option, Either, Try, Future, bare value) driven by the call-site's expected type.

### Design: Invisible Whole-Function Specialization (Design B)

The user writes a normal function returning `Result<E, T>`. The macro system treats
`Result<E, T>` in return position as a signal that the function is specializable. At call
sites where the target type differs (e.g., `const x: Option<number> = parseAge("42")`),
the compiler monomorphizes the function body, replacing `ok()`/`err()` with the target
type's constructors. No intermediate Result object is ever created.

```typescript
// User writes:
function parseAge(input: string): Result<string, number> {
  const n = Number(input);
  if (isNaN(n)) return err("not a number");
  if (n < 0 || n > 150) return err("out of range");
  return ok(n);
}

// Call site drives specialization:
const opt: Option<number> = parseAge("42");
// Monomorphized to: const n = Number("42"); isNaN(n) ? null : n < 0 || n > 150 ? null : n

const either: Either<string, number> = parseAge("-1");
// Monomorphized to: const n = Number("-1"); isNaN(n) ? Left("not a number") : ...
```

### Prerequisite: `specialize()` improvements

These are general improvements to the specialization infrastructure that benefit all of
typesugar, not just Result. Tracked inline in `src/macros/specialize.ts`.

- [ ] **Deduplication / hoisting** — Currently each call site generates a fresh inlined copy.
      If 50 call sites specialize `parseAge → Option`, we get 50 identical functions. Need to
      hoist specialized functions to module scope with a cache key (`fnName × targetAlgebra`),
      generating one `const __parseAge_Option = ...` and reusing it. (C++ COMDAT folding model.)

- [ ] **Early-return inlining** — `classifyInlineFailure()` rejects functions with early
      returns, but that's the most common pattern for Result-returning functions. Need to handle
      multi-return functions by rewriting as nested ternaries or a single match expression.
      This is the same transformation the `?` operator compilation would need.

- [ ] **Return-type-driven auto-specialization** — The transformer needs to detect when a
      function returning `Result<E, T>` is assigned to a different type (Option, Either, bare T)
      and automatically trigger specialization without an explicit `specialize()` call.

### Package implementation

- [ ] **`@typesugar/result` package** — New package with:
  - `Result<E, T>` type (compatible with existing `ZeroCostResult`, param order: error first)
  - `ok(value)` / `err(error)` constructors (expression macros, inline to target constructors)
  - Result algebra instances: Option, Either, ZeroCostResult, Unsafe (bare T), Promise
  - Extension methods: `.map()`, `.flatMap()`, `.unwrapOr()`, `.toOption()`, `.toEither()`, etc.
  - FlatMap registration for `let:/yield:` do-notation
  - `match()` integration (discriminant: `ok`)

- [ ] **`?` operator** — Preprocessor syntax for early return on error:
  - `expr?` rewrites to `__resultTry__(expr)` at text level
  - `__resultTry__` expression macro expands to: `const _t = expr; if (!_t.ok) return _t; _t.value`
  - Must respect function boundary (only early-returns from enclosing function)

### Progressive disclosure

| Level     | What the user writes                     | What happens                           |
| --------- | ---------------------------------------- | -------------------------------------- |
| Basic     | `ok()`, `err()`, `.map()`, `.unwrapOr()` | Macro inlines checks (concrete Result) |
| Ergonomic | `?` operator, `match()`, `let:/yield:`   | Compile-time rewrite                   |
| Interop   | Assign `Result` to `Option`/`Either`/`T` | Auto-specializes whole function        |
| Explicit  | `specialize(fn, optionResult)`           | Manual monomorphization                |

## Soundness & Type Safety

- [ ] **Post-expansion type checking** — Macro expansions are not re-type-checked after the transformer runs. Explore running a second `tsc` pass on expanded output, or integrating with TypeScript's incremental checker to validate generated code. (Analysis §4.1)
- [ ] **Binding-time analysis for specialization** — Replace the ad-hoc "can we inline this?" checks in `specialize.ts` with a proper binding-time analysis pass that statically determines specialization feasibility before attempting it. (Analysis §4.6)
- [ ] **Macro expansion cycle detection** — No expansion depth limit or cycle detection exists for recursive re-expansion of macro results. Add a configurable max depth with a clear compile error when exceeded. (Analysis §4.7)

## Coherence & Instance Resolution

- [ ] **Orphan instance detection** — `CoherenceChecker` exists with priority-based conflict detection, but there are no orphan rules (instances must be defined in the module of the typeclass or the type). In JS, this is especially dangerous since module execution order can be non-deterministic. (Analysis §4.3)
- [ ] **Migrate all error paths to rich diagnostics** — Some code still uses legacy `ctx.reportError()` (string-based) instead of `ctx.diagnostic()` (rich builder with spans, notes, suggestions). Audit and migrate remaining call sites.

## Source Maps & Debugging

- [ ] **Debug mode with expansion comments** — Consider a debug/development mode that emits inline comments in generated code showing the original macro invocation, making transformed output easier to read.

## Build & Bundle Optimization

- [ ] **Tree-shaking: `/*#__PURE__*/` annotations on generated code** — The transformer should auto-emit `/*#__PURE__*/` on generated instance constants and other side-effect-free expressions. Currently only the unplugin export has this annotation. Without it, bundlers can't eliminate unused auto-derived instances.
- [ ] **`sideEffects: false` in package.json** — Most packages now declare `sideEffects: false`, but audit for completeness and add to any remaining packages.
- [ ] **Lazy/tree-shakeable instance registration** — `registerInstance()` calls are side-effectful and anchor unused instances in the bundle. Consider lazy registration (register on first `summon()`) or making registration eliminable.

## Tooling & DX

- [ ] **Unplugin HMR/watch mode** — The unplugin creates `ts.Program` once at `buildStart` and never invalidates it. During dev mode, type information goes stale as files change. Add watch mode support with incremental program updates and proper cache invalidation.

## Language Design

- [ ] **`===` operator semantics** — Rewriting `===` from reference equality to structural equality is the biggest "principle of least surprise" concern. Consider whether structural equality should use a distinct operator (e.g., `==` or a custom operator via the preprocessor) rather than overloading `===`. (Analysis §4.2)
- [ ] **True lexical hygiene** — Current hygiene is name-mangling (`gensym`-style), not true lexical hygiene (Racket/`syntax-case`). Investigate whether TypeScript's Symbol API can support scope-aware identifier tracking so macros can reliably refer to bindings from their definition site. (Analysis §4.5)
- [ ] **Phase separation in unplugin path** — The preprocessor rewrites `F<_>` to `Kind<F, A>` at the text level, but the type checker sees the original source. Type information during AST transformation may not match the actual code being compiled. (Analysis §4.4)

## Cross-Cutting Concerns (Analysis §4.8)

- [ ] **`defineWrappingMacro()` helper** — No uniform helper for body-wrapping macros. Each `@profiled`/`@traced`/`@retry` macro would need to independently handle async, generators, arrow functions, method vs standalone, `cfg()` stripping, and composition ordering. A shared helper would unblock the entire category.
- [ ] **Validate + refined type integration** — `@typesugar/validate` and `@typesugar/type-system` refined types are not wired together. `generateValidationChecks` sees `Refined<number, Positive>` as plain `number` and misses the registered predicate `n > 0`.
- [ ] **Call-site analysis macros** — `@deprecated` (warn at callers), `@mustUse` (detect discarded return values), taint tracking — all need call-site analysis. The transformer is definition-oriented; `moduleIndex()`/`collectTypes()` exist but aren't integrated into the expansion pipeline for definition-site macros to trigger call-site diagnostics.
- [ ] **Type-directed taint tracking** — Branded `TaintedString = Refined<string, "Tainted">` + `@sanitized` functions + contracts prover for compile-time sink verification. All pieces exist; composition does not.
