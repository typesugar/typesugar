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

- [ ] Port `Clone` derivation from `derive.ts` to `typeclass.ts` deriving system
- [ ] Port `Debug` derivation (or unify with `Show`)
- [ ] Port `Default` derivation
- [ ] Port `Json` derivation
- [ ] Port `Builder` derivation
- [ ] Port `TypeGuard` derivation
- [ ] Ensure all derivations register with `instanceRegistry` for proper operator/summon support

**Gate:**

- [ ] `@deriving(Clone, Debug, Json)` on a class produces working instances
- [ ] `summon<Clone<Point>>().clone(p)` works
- [ ] Failure diagnostics show which field caused derivation to fail

### Wave 3: Migrate Existing Derives

Update existing `Eq`, `Ord`, `Hash` in `@derive` to delegate to `@deriving`.

**Tasks:**

- [ ] `@derive(Eq)` internally becomes `@deriving(Eq)`
- [ ] Deprecation warning: "Use @deriving instead of @derive"
- [ ] Ensure backward compatibility: old code still works
- [ ] Update all internal tests to use `@deriving`

**Gate:**

- [ ] All existing `@derive` tests pass using `@deriving` internally
- [ ] Deprecation warnings appear in compiler output

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
