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

- [ ] **Post-expansion type checking** — Partly done in PR #83. `typesugar check --strict` / `build --strict` type-check the whole expansion. Plain `check`, `build` and `watch` type-check it only in the regions where a suppression rule hid source errors: comprehensions, `match: switch`, `ensures:`, fluent `match()` chains and `@impl` instances. See [PR #83 follow-ups](#pr-83-follow-ups-2026-10-22) for what is still missing. (Analysis §4.1)
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

- [ ] **`===` operator semantics** — Rewriting `===` from reference equality to structural equality is the biggest "principle of least surprise" concern. Consider whether structural equality should use a distinct operator rather than overloading `===`. (Analysis §4.2)
- [ ] **True lexical hygiene** — Current hygiene is name-mangling (`gensym`-style), not true lexical hygiene (Racket/`syntax-case`). Investigate whether TypeScript's Symbol API can support scope-aware identifier tracking so macros can reliably refer to bindings from their definition site. (Analysis §4.5)
- [ ] **HKT rewriter checker alignment** — The `.ts` HKT rewriter (`hkt-rewriter.ts`, kept after PEP-047) rewrites `F<A>` → `Kind<F, A>` for type parameters, so the checker sees rewritten text. The blast radius is a single identifier substitution (no operators), but type information during AST transformation can still differ from the rewritten code. (Analysis §4.4; the broader `.sts` preprocessor this once described was removed in PEP-047.)

## Cross-Cutting Concerns (Analysis §4.8)

- [ ] **`defineWrappingMacro()` helper** — No uniform helper for body-wrapping macros. Each `@profiled`/`@traced`/`@retry` macro would need to independently handle async, generators, arrow functions, method vs standalone, `cfg()` stripping, and composition ordering. A shared helper would unblock the entire category.
- [ ] **Validate + refined type integration** — now tracked under [PEP-045](peps/PEP-045-taint-tracking.md), which composes `@typesugar/validate` + `@typesugar/type-system` refined types + the contracts prover. (Today `generateValidationChecks` sees `Refined<number, Positive>` as plain `number` and misses the predicate `n > 0`.)
- [ ] **Call-site analysis macros** — `@deprecated` (warn at callers) and `@mustUse` (detect discarded return values) need call-site analysis. The transformer is definition-oriented; `moduleIndex()`/`collectTypes()` exist but aren't integrated into the expansion pipeline for definition-site macros to trigger call-site diagnostics. (Taint tracking, the other call-site consumer, is now [PEP-045](peps/PEP-045-taint-tracking.md).)

## PR #83 follow-ups (2026-10-22)

These were left over from the overnight review-and-fix loop on PR #83 (`case-study-fixes`) and its 9 review rounds. The decisions are Dean's to make. The other entries are confirmed bugs or unfinished work, with the reviewer fixtures noted where they exist.

### Decisions for Dean

- [ ] **Workspace packages imported by name.** A workspace package reached through its `node_modules` link still needs `approve-macros`. The same package reached by a relative import is project code and doesn't. Should bare imports also be judged by real path, so that workspace links count as project code? (packages/transformer/src/macro-loader.ts, `candidateOf`.)
- [ ] **npm aliases.** `"@typesugar/x": "npm:evil"` installs any package under a trusted name. Name-based trust (PEP-055) can't see this. Should SECURITY.md call it out, or should trust also check the installed package's real name or integrity?
- [ ] **`match: switch` on a narrowed value.** A case the narrowed value can't reach still gets TypeScript's TS2678/TS2353, as a native `switch` does. Keep that and document it, or suppress it? (The fluent form widens the scrutinee to its declared type instead.)
- [ ] **An exhaustive `match()` with an out-of-type value.** The no-dead-code change (0079f405) means a value cast outside its type (e.g. through `any`) now falls out of the switch, and the match returns `undefined` rather than throwing `MatchError`. That's zero-cost and documented. Confirm.
- [ ] **Optional fields in fluent `match()`.** An arm that binds an optional field matches only when the field is present (an `"extra" in v` test), so an exhaustive match needs an extra `{ k: "b" }` arm. `match: switch` destructures instead and binds `undefined`. Confirm the fluent semantics, or switch to destructuring.
- [ ] **TS7006 on unannotated `@impl` instances in plain `check`.** The editor checks the expansion, where `satisfies` types the parameters, so it shows no error. `check`/`build` check the source as written and report TS7006. Fixing it means a suppression rule fed by a live registry of the wrapped instances, plus running the CLI's check-only filter after expansion. Do that, or document "annotate it"?
- [ ] **TS9602 noise.** Every `implicit()` call that uses a std/fp instance warns ("only visible as a declaration"), as does a direct call to an instance whose method uses a private helper. Info level, opt-in, or keep?
- [ ] **Nullable `===` without `strictNullChecks`.** The null-safe Eq/Ord expansion only applies when the checker sees a nullable type. Making non-strict projects safe would change every `p1 === p2` output.
- [ ] **Method syntax now requires `@typesugar/std/syntax/eq`.** `p.equals(q)` on a `@derive(Eq)` type without that import is now reported as TS2339 rather than hidden, where it used to throw at run time. That's stricter, and it may turn some builds red.
- [ ] **`typesugar init` still installs ts-patch** and adds a `prepare` script, although the docs now recommend the bundler plugin, `typesugar build` and `node --import typesugar/register`.
- [ ] **The CLI ignores the tsconfig `transform` entry's options.** `build`/`check`/`run` never read them (cli.ts passes only `{verbose, onDiagnostic}`).
- [ ] **Per-instantiation derives for generic types.** Should `@derive(Eq)` on `Box<T>` derive per instantiation, so that `Box<number> === Box<number>` works? Today it is TS9106 at the declaration, and TS9001 at the operator.
- [ ] **TypeGuard's `is`** returns `boolean`, not `value is T`, although docs/guides/derive.md says it narrows. Emit a type predicate, or change the docs? (packages/macros/src/auto-derive.ts ~2285.)
- [ ] **Generated top-level names before expansion.** Names a macro creates (e.g. `UserMeta` from `@derive(Meta)`, docs/guides/sql.md:611) are TS2304 in check and in the IDE. Add a suppression rule, or use a different pattern?
- [ ] **Dead code with no callers.** It is the transitive-derivation planner (`parseTransitiveOptions`, `buildTransitiveDerivationPlan`, `executeTransitiveDerivation`, packages/macros/src/typeclass.ts ~284/511/631) plus `TransitiveOptions`, `findTypeInSourceFile`, `normalizeTypeNameForLookup`, `hasPrimitiveOrInstance`, `extractFieldsFromAST`, `tryExtractSumTypeFromAST`, `buildGenericFactorySignature` and `getFieldInstanceRef`. Delete?
- [ ] **Turf case study.** Report Turf's nested-GeometryCollection crash (`flattenEach`/`segmentEach`/`lineEach`, v7.4.0) upstream. Continue with Stage 6 (operators) and the write-up. Close issue #19.
- [ ] **PEP-062:** decide between structural and nominal instance matching. Also `npm deprecate @typesugar/lsp-server`.

### Unfinished work

- [ ] **`origin/wip-a22`** (08d18065, untested). It holds:
  - `satisfies TC<T> & { readonly [member: string]: unknown }` for every unannotated, non-HKT `@impl` instance whose typeclass name is in scope;
  - a fix for the `/** @impl */` comment printed inside the HKT expanded type;
  - placement in the editor of diagnostics that fall in generated code;
  - a real-path `isDependencyProject`.

  Still to do:
  - Add a CLAUDE.md exception entry for the new tag-text parse in typeclass.ts.
  - Update the docs (docs/reference/cli.md:141, packages/vscode/README.md:24, docs/guides/typeclasses.md:631): the check applies only when the typeclass name is in scope. Until then, those lines overclaim.
  - Add a changeset.
  - Re-run the test sweep. Vitest-2 packages need `--minWorkers=1 --maxWorkers=1`.
  - Make the real-path rule shared, because `pipeline.ts:1843` `shouldTransform` and `macro-loader.ts` `isScannedFile` still test the literal path.

- [ ] **Inlined `@impl` bodies lose contextual literal types.** With `make: (n) => ({ kind: "p", x: n })` for `P { kind: "p" }`, `takesP(mkP.make(1))` is TS2345 ("kind: string") in the editor and under `--strict`. Plan: in specialization.ts `tryInlineDerivedInstanceCall`, assert a literal-shaped inlined body to the call's return type via `typeToPortableTypeNode`, and don't inline when the type can't be written. Fixture: review9/c1.
- [ ] **The editor shows 7 false errors on docs/examples/fp/option-either.ts** (e.g. `const user: Option<string> = Some("Alice")` → TS2322), while `check` and `check --strict` are clean. The likely cause is that strict-check.ts serves `opaqueTypesAsUnderlying` and the language service doesn't. Fixtures: review9/ls1, ls1b, ls1c.
- [ ] **TS7006 on generated parameter names** (`__typesugar_v_s40_0__`, `__typesugar_x_s1_0__`) in the editor for the type-system and typesugar showcases, and under `check --strict` for docs/examples/core/pipe-compose.ts (20:17, plus TS2451 at 20:7).

### Known gaps (documented, lower priority)

- [ ] `typesugar watch` ignores `--strict`.
- [ ] The macro registry (`globalRegistry`) and the comptime-in-editor flag are process-wide, so macros one project loaded stay registered for another in the same editor process. Approval is re-checked per project.
- [ ] `(a * b).num`, and other uses of an unannotated `const p = a * b`, are still typed `number` at source level. `f(a * b).num` with overloads is the same class of gap.
- [ ] Long object operator chains: around 800+ terms, the rewrite's own recursion overflows (it reports a clear "split into consts" error). Deep `&&`/`||` chains hit tsc's own binder limit.
- [ ] `@impl` with a user's own annotation still replaces it with the expanded type, so a user alias with extra members would lose them.
- [ ] Nested anonymous object fields can't be derived (`@derive(Eq) interface H { p: { x: number } }` is TS9106), and neither can a `Readonly<Point>` field.
- [ ] `typeAssert` runs before expansion, so it can't see macro-generated declarations.
- [ ] std `deepMerge` types its sources as shallow `Partial<T>` (packages/std/src/extensions/object.ts:127). contracts/fp law sets need `as unknown as LawSet` (packages/contracts/src/laws/types.ts:136).
- [ ] With multiple overloads, `getContextualType` reflects the `number` overload TypeScript chose for the source.
- [ ] Operator-chain hoisting with an effectful operand falls back to an inner IIFE where all arguments could have been hoisted in order. This is an optimization, not a correctness issue.
- [ ] `specialization.ts` `methodFreeNameMismatch` accepts every name for a synthetic call with no original node.
- [ ] `@adt` type rewrites register only during the transform, so the TypeRewriteAssignment rule may not apply to them under `check`. This is unverified.
- [ ] Name-based lookups are left for PEP-062 Wave 11 (resolving by type identity):
  - `getTypeclassDef(program, name)` (typeclass.ts:2233; fp's `@impl FlatMap` bridges get fp's FlatMap, not std's);
  - `typeclass.ts:1863` `tcName` via `getText()`;
  - `hkt.ts:184` walking files for a type-constructor name;
  - `getGenericMeta(typeName)`;
  - `findTypeSymbol`'s name fallback in `implicit()`;
  - `implicits.ts` `findEmittableInstanceByName`;
  - `tryReturnTypeDrivenSpecialize`'s `returnTypeName !== "Either"`.
- [ ] `generateHKTExpandedType` parses `fullSignatureText` without checking for parse errors.
