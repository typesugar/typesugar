# PEP-017: Unify @derive and @deriving into "Everything is a Typeclass"

**Status:** In Progress
**Date:** 2026-03-16
**Author:** Dean Povey

## Context

typesugar currently has two derive-related decorators with overlapping purposes:

| Decorator                           | Purpose                         | Output                                                  | Operator Overloading                          |
| ----------------------------------- | ------------------------------- | ------------------------------------------------------- | --------------------------------------------- |
| `@derive(Eq, Clone, Debug, ...)`    | Generate utility functions      | `pointEq(a, b)`, `clonePoint(p)`, `debugPoint(p)`       | Only for Eq, Ord, Hash (via instanceRegistry) |
| `@deriving(Show, Eq, Functor, ...)` | Auto-derive typeclass instances | `showPoint`, `eqPoint` instances registered with summon | Yes, all derived instances                    |

This split is confusing:

- Users don't know which decorator to use
- `Eq` appears in both, with different behavior (one generates `pointEq` function, one generates `eqPoint` instance)
- Documentation has to explain both systems
- `Clone`, `Debug`, `Json`, `Builder`, `TypeGuard` could easily be typeclasses but aren't

### Comparison with Other Languages

| Language   | Derive Syntax                     | Result                                     | Notes                         |
| ---------- | --------------------------------- | ------------------------------------------ | ----------------------------- |
| Rust       | `#[derive(Eq, Clone, Debug)]`     | Trait impls (always)                       | No function-only option       |
| Haskell    | `deriving (Eq, Show, Ord)`        | Typeclass instances                        | Native to the language        |
| Scala      | `case class` + derivation macros  | Typeclass instances via Magnolia/Shapeless | Everything is a typeclass     |
| PureScript | `derive instance eqFoo :: Eq Foo` | Typeclass instance                         | Explicit instance declaration |

Every mature FP ecosystem treats derivation as typeclass derivation. The utility-function approach (`pointEq` standalone) is an outlier that creates cognitive overhead.

### Decision: Unify Under "Everything is a Typeclass"

1. Make `Clone`, `Debug`, `Default`, `Json`, `Builder`, `TypeGuard` into proper typeclasses
2. Migrate all derivation to the `@deriving` system
3. Delete the old `@derive` macro
4. Rename `@deriving` → `@derive`

End state: `@derive(Eq, Clone, Debug, Json)` gives you typeclass instances for all four, with operator overloading where applicable.

## Waves

### Wave 1: Define New Typeclasses

Add typeclass definitions for derives that don't have them yet.

**Tasks:**

- [x] Define `Clone` typeclass with `clone(a: A): A` method
- [x] Define `Debug` typeclass with `debug(a: A): string` method — kept separate from `Show` (Show = user-facing display, Debug = developer-facing debug output, like Rust's Display vs Debug)
- [x] Define `Default` typeclass with `default(): A` method (zero-arg factory, no `A` parameter)
- [x] Define `Json` typeclass with `toJson(a: A): unknown` and `fromJson(json: unknown): A` methods
- [ ] ~~Define `Builder` typeclass~~ — **Skipped:** Builder doesn't fit the typeclass model cleanly. A builder accumulates partial state before producing a value, which is fundamentally stateful and doesn't map to a pure `A -> B` method signature. Revisit as a standalone pattern or macro in future work.
- [x] Define `TypeGuard` typeclass with `is(value: unknown): boolean` method (TS type predicates can't be expressed as typeclass method return types, so uses `boolean`)
- [ ] Add operator mappings where sensible (e.g., `structuredClone()` calls `Clone.clone`) — deferred to later waves

**Implementation Notes (Wave 1):**

- All new typeclasses added to `STANDARD_TYPECLASS_DEFS` in `packages/macros/src/typeclass.ts`
- Registered in `typeclassRegistry` via `registerStandardTypeclasses()`
- `Default.canDeriveSum = false` — a sum type has no single obvious default variant
- No operator syntax mappings added yet (empty `syntax` Maps)
- Build passes, all 180 test files pass (5315 tests, 0 new failures)

**Gate:**

- [ ] Each new typeclass can be manually implemented: `@instance Clone<Point> { ... }`
- [ ] `summon<Clone<Point>>()` works for manual instances

### Wave 2: Add Auto-Derivation to @deriving

Implement auto-derivation logic for the new typeclasses in the `@deriving` system.

**Tasks:**

- [x] Port `Clone` derivation from `derive.ts` to `typeclass.ts` deriving system
- [x] Port `Debug` derivation (kept separate from Show — Debug = developer-facing with JSON.stringify, Show = user-facing display)
- [x] Port `Default` derivation
- [x] Port `Json` derivation
- [ ] ~~Port `Builder` derivation~~ — **Skipped:** Builder was already excluded in Wave 1 as it doesn't fit the typeclass model
- [x] Port `TypeGuard` derivation
- [x] Ensure all derivations register with `instanceRegistry` for proper operator/summon support

**Implementation Notes (Wave 2):**

- All five derivations (Clone, Debug, Default, Json, TypeGuard) added to `builtinDerivations` in `packages/macros/src/typeclass.ts`
- Each derivation supports both `deriveProduct` and `deriveSum` (except Default which returns a comment for sum types since `canDeriveSum = false`)
- All derivations follow the existing pattern: generate `const varName: TC<T> = { methods }` + `TC.registerInstance<T>("T", varName)`
- Specialization methods added to `getSpecializationMethodsForDerivation` for all five new typeclasses
- Clone: shallow spread-copy for products, switch-on-discriminant for sums
- Debug: `TypeName { field: value }` format using JSON.stringify for field values
- Default: zero-values per type (0, "", false, {}) — no sum type support
- Json: toJson produces plain object, fromJson validates required fields and types
- TypeGuard: typeof checks per field for products, discriminant tag validation for sums
- Build passes, all 180 test files pass (5315 tests, 0 new failures)

**Gate:**

- [ ] `@deriving(Clone, Debug, Json)` on a class produces working instances
- [ ] `summon<Clone<Point>>().clone(p)` works
- [ ] Failure diagnostics show which field caused derivation to fail

### Wave 3: Migrate Existing Derives

Update existing `Eq`, `Ord`, `Hash` in `@derive` to delegate to `@deriving`.

**Tasks:**

- [x] `@derive(Eq)` internally becomes `@deriving(Eq)` — Eq already registered with instanceRegistry; Ord and Hash now also register
- [x] Deprecation warning: "Use @deriving instead of @derive" — all 9 derive macros emit deprecation via `ctx.reportWarning()`
- [x] Ensure backward compatibility: old code still works — all 5315 tests pass, 0 new failures
- [ ] Update all internal tests to use `@deriving` — deferred to Wave 4 (tests verify backward compat for now)

**Implementation Notes (Wave 3):**

- Added `emitDeriveDeprecation()` helper in `packages/macros/src/derive.ts` that all 9 derive macros (Eq, Ord, Clone, Debug, Hash, Default, Json, Builder, TypeGuard) now call
- Warning message: `@derive(X) is deprecated. Use @deriving(X) instead. @deriving produces typeclass instances with operator overloading and summon support.`
- Ord now registers `ordTypeName` instance in `instanceRegistry` with `compare` method (both product and sum types)
- Hash now registers `hashTypeName` instance in `instanceRegistry` with `hash` method (both product and sum types)
- Eq already had instanceRegistry registration from prior work
- Build passes, all 180 test files pass (5315 tests, 0 new failures)

**Gate:**

- [x] All existing `@derive` tests pass (backward compatible — old code still works, just emits warnings)
- [x] Deprecation warnings appear in compiler output (via `ctx.reportWarning()` on every `@derive` expansion)

### Wave 4: Remove @derive and Rename @deriving

**Tasks:**

- [ ] Delete `packages/macros/src/derive.ts` (or gut it to just export deprecation wrapper)
- [ ] Rename `@deriving` decorator to `@derive` in `typeclass.ts`
- [ ] Update all exports in `packages/macros/src/index.ts`
- [ ] Update `packages/typesugar/src/index.ts` re-exports

**Gate:**

- [ ] `@derive(Eq, Clone, Debug)` works as the unified decorator
- [ ] Old `@deriving` name still works with deprecation warning
- [ ] Build passes with no references to old derive system

### Wave 5: Documentation

**Tasks:**

- [ ] Update `docs/guides/derive.md` — single unified guide
- [ ] Remove any "derive vs deriving" explanations
- [ ] Update all code examples to use new `@derive` syntax
- [ ] Update `AGENTS.md` macro reference
- [ ] Update playground examples
- [ ] Add migration guide for users of old `@derive`

**Gate:**

- [ ] No documentation mentions `@deriving` as separate from `@derive`
- [ ] Search for "deriving" in docs returns only historical/migration content
- [ ] All playground examples work

## Files Changed

| File                               | Wave | Change                                                            |
| ---------------------------------- | ---- | ----------------------------------------------------------------- |
| `packages/macros/src/typeclass.ts` | 1-4  | Add new typeclass definitions, derivation logic, rename decorator |
| `packages/macros/src/derive.ts`    | 3-4  | Deprecate, then remove                                            |
| `packages/macros/src/index.ts`     | 4    | Update exports                                                    |
| `packages/typesugar/src/index.ts`  | 4    | Update re-exports                                                 |
| `docs/guides/derive.md`            | 5    | Rewrite as unified guide                                          |
| `docs/examples/core/derive.ts`     | 5    | Update examples                                                   |
| `AGENTS.md`                        | 5    | Update macro reference                                            |

## Consequences

### Benefits

1. **Simpler mental model** — one decorator, one system
2. **Consistent with FP ecosystem** — Rust/Haskell/Scala developers will find it familiar
3. **Everything supports operator overloading** — no more "only Eq gets operators"
4. **Everything supports summon** — no more "I derived it but can't summon it"
5. **Better diagnostics** — unified derivation system can share failure reporting

### Trade-offs

1. **Breaking change** — existing `@derive` users need to update imports (mitigated by deprecation period)
2. **Migration effort** — porting derivation logic takes time
3. **Typeclass overhead** — some derives (like `TypeGuard`) don't naturally fit the typeclass model

### Future Work

1. **Derive with options** — `@derive(Json({ camelCase: true }))`
2. **Custom derive hooks** — let users define their own derivable typeclasses
3. **Derive dependencies** — `Json` requires `Show` for error messages
