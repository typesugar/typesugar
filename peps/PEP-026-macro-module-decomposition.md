# PEP-026: Macro Module Decomposition — Split Large Files into Focused Modules

**Status:** Draft
**Date:** 2026-03-21
**Author:** Claude (with Dean Povey)

## Context

Two files in `packages/macros/src/` have grown well beyond manageable size:

- **`typeclass.ts`** — 5,019 lines. Contains: typeclass macro registration, `@impl` attribute handling, `@op` JSDoc operator registration, HKT boilerplate generation, auto-derivation logic, instance registry management, `parCombineBuilder` support, and numerous helper utilities.
- **`specialize.ts`** — 3,087 lines. Contains: `specialize<T>()` macro expansion, monomorphization logic, type argument resolution, call-site inlining, and specialization cache management.

These files work correctly and are well-tested. The problem is purely maintainability:

- Finding a specific function requires scrolling through thousands of lines
- Logically distinct concerns (e.g., registry management vs HKT generation vs derivation) are interleaved
- Code review diffs are hard to reason about when changes touch a 5K-line file
- IDE features (outline, go-to-symbol) become less useful with flat file structure

### Risk

This is a **refactoring-only** change — no API or behavioral changes. The risk is subtle breakage from:

- Module-level side effects that depend on initialization order
- Circular dependencies between extracted modules
- Internal state (module-scoped `Map`s, registries) that multiple concerns share
- re-exports changing the public API surface (even unintentionally)

### Approach

Extract logical concerns into focused files while keeping the public API identical. Use a barrel `index.ts` pattern so consumers see no change.

## Waves

### Wave 1: Map the Dependency Graph

**Tasks:**

- [ ] For `typeclass.ts`: identify every exported symbol and categorize by concern:
  - **Registry**: instance storage, lookup, registration (`registerInstanceWithMeta`, `findInstance`, `summon`, instance registry Map)
  - **Typeclass macro**: `@typeclass` attribute expansion, interface generation
  - **Impl macro**: `@impl` attribute expansion, instance validation
  - **Op macro**: `@op` JSDoc parsing, operator-to-typeclass mapping
  - **HKT**: higher-kinded type boilerplate generation
  - **Derivation**: auto-derive logic for Eq, Ord, Show, etc.
  - **Helpers**: shared utilities used across concerns
- [ ] For `specialize.ts`: identify concerns:
  - **Core expansion**: `specialize<T>()` call-site transformation
  - **Monomorphization**: type argument resolution and substitution
  - **Inlining**: call-site inlining decisions and code generation
  - **Cache**: specialization result caching
- [ ] Map internal dependencies between concerns (which functions call which)
- [ ] Identify module-scoped mutable state and which concerns read/write it
- [ ] Identify any initialization-order dependencies

**Gate:**

- [ ] Dependency graph documented (which concern depends on which)
- [ ] Shared mutable state inventory complete
- [ ] Proposed file split documented with no circular dependencies

### Wave 2: Extract typeclass.ts

**Tasks:**

- [ ] Create focused modules based on Wave 1 analysis (likely):
  - `typeclass-registry.ts` — instance storage, lookup, registration
  - `typeclass-macro.ts` — `@typeclass` attribute expansion
  - `impl-macro.ts` — `@impl` attribute expansion
  - `op-macro.ts` — `@op` JSDoc handling
  - `hkt-generation.ts` — HKT boilerplate
  - `derivation.ts` — auto-derive logic
  - `typeclass-helpers.ts` — shared utilities
- [ ] Move shared mutable state to `typeclass-registry.ts` and export accessors
- [ ] Update `typeclass.ts` to be a barrel re-export of all extracted modules (preserves exact public API)
- [ ] Verify no circular dependencies with `madge` or manual inspection
- [ ] Run full test suite

**Gate:**

- [ ] `typeclass.ts` is a barrel file (<50 lines of re-exports)
- [ ] Each extracted module is <1,000 lines
- [ ] Public API is byte-identical (same exports, same types)
- [ ] `pnpm build` succeeds
- [ ] `pnpm test` passes
- [ ] No circular dependencies

### Wave 3: Extract specialize.ts

**Tasks:**

- [ ] Create focused modules based on Wave 1 analysis (likely):
  - `specialize-core.ts` — main `specialize<T>()` expansion
  - `monomorphize.ts` — type argument resolution and substitution
  - `inline.ts` — call-site inlining
  - `specialize-cache.ts` — result caching
- [ ] Update `specialize.ts` to be a barrel re-export
- [ ] Verify no circular dependencies
- [ ] Run full test suite

**Gate:**

- [ ] `specialize.ts` is a barrel file (<50 lines of re-exports)
- [ ] Each extracted module is <1,000 lines
- [ ] Public API is byte-identical
- [ ] `pnpm build` succeeds
- [ ] `pnpm test` passes

### Wave 4: Cleanup

**Tasks:**

- [ ] Remove any `// region` / `// endregion` comments that were used as file-internal organization (now redundant)
- [ ] Update any internal documentation that references line numbers in the old monolithic files
- [ ] Verify IDE navigation (go-to-definition, find-references) works correctly through barrel re-exports
- [ ] Update `packages/macros/README.md` if it references internal file structure

**Gate:**

- [ ] `pnpm build && pnpm test` passes
- [ ] No references to old line numbers in documentation
