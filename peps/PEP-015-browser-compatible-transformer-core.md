# PEP-015: Browser-Compatible Transformer Core

**Status:** Done
**Date:** 2026-03-16
**Author:** Dean Povey

## Context

The interactive playground (PEP-013) required a separate `browser-transform.ts` that duplicates transformation logic from `@typesugar/transformer`. This creates a maintenance burden: every new macro type must be manually ported to the browser transformer.

Current architecture:

```
@typesugar/transformer          @typesugar/playground
├── index.ts (MacroTransformer) ├── browser-transform.ts (DUPLICATE)
├── macro-loader.ts (Node)      ├── browser-shims/
├── cache.ts (Node fs)          └── ...
├── pipeline.ts (Node path)
└── ...
```

The browser transformer currently only handles:

- ✅ Expression macros (`staticAssert()`, `comptime()`, `pipe()`)
- ✅ Attribute macros (`@tailrec`, `@derive`) — just added
- ❌ JSDoc macros (`@typeclass`, `@impl`, `@deriving`)
- ❌ Derive macros (derive trait generation)
- ❌ Tagged template macros
- ❌ Type macros

Every new macro type requires manual porting. This is unsustainable.

### Node.js Dependencies Analysis

| File              | Dependency       | Purpose                       | Required for Browser?                       |
| ----------------- | ---------------- | ----------------------------- | ------------------------------------------- |
| `macro-loader.ts` | `createRequire`  | Dynamic macro package loading | ❌ No — macros pre-registered via imports   |
| `cache.ts`        | `fs`, `crypto`   | Disk caching                  | ❌ No — optional, in-memory fallback        |
| `pipeline.ts`     | `path`, `ts.sys` | File resolution               | ⚠️ Partial — can shim `path`, mock `ts.sys` |
| `index.ts`        | `path`           | Path normalization            | ✅ Yes — already shimmed                    |

The core `MacroTransformer` class in `index.ts` has minimal Node dependencies. The problem is it's entangled with pipeline/caching infrastructure.

## Approach

Extract a browser-compatible transformation core that both environments use:

```
@typesugar/transformer-core (NEW)   <- Pure transformation logic
├── transformer.ts                   <- MacroTransformer class (thin delegating methods)
├── transformer-utils.ts             <- Pure utilities (safeGetNodeText, error helpers, etc.)
├── import-resolution.ts             <- Import tracking, macro resolution, extension checks
├── specialization.ts               <- Auto-specialization pipeline
├── macro-helpers.ts                <- JSDoc macros, decorator parsing, derive expansion
├── rewriting.ts                    <- Extension methods, operators, HKT, tagged templates, type macros
├── transform.ts                    <- transformCode() entry point
├── types.ts                         <- Shared types
└── ...                             <- Source maps, position mapping, etc.

      ↑                    ↑
      │                    │
@typesugar/transformer    @typesugar/playground
├── pipeline.ts           ├── browser.ts
├── cache.ts              └── (uses transformer-core directly)
├── macro-loader.ts
└── cli.ts
```

### Design Principles

1. **Zero Node.js dependencies** in `transformer-core`
2. **Dependency injection** for optional features (caching, file reading)
3. **Same API** used by CLI and browser
4. **Tree-shakeable** — browser bundle excludes unused code

## Waves

### Wave 1: Extract Core Types and Utilities

**Tasks:**

- [x] Create `packages/transformer-core/` with package.json, tsconfig
- [x] Move `ExpansionTracker` and source map generation to core
- [x] Move diagnostic formatting utilities to core
- [x] Move AST visitor utilities (decorator detection, etc.) to core
- [x] Export types: `TransformResult`, `TransformDiagnostic`, `TransformOptions`

**Gate:**

- [x] `pnpm build` passes
- [x] `pnpm test` passes (pre-existing failures in unrelated tests)
- [x] No Node.js imports in `transformer-core`

### Wave 2: Extract MacroTransformer Class

**Tasks:**

- [x] Move `MacroTransformer` class to `transformer-core/transformer.ts`
- [x] Remove `macro-loader` dependency (macros registered via imports)
- [x] Make profiler optional (no-op in browser) — deferred, profiler not used in core
- [x] Inject `path` module via options (use shim in browser) — deferred, `path` not directly used in core
- [x] Update `@typesugar/transformer` to import from core
- [x] Mark `@typesugar/macros` and `@typesugar/core` as external in tsup config (ensures shared singleton registries)

**Gate:**

- [x] `pnpm build` passes
- [x] `pnpm test` passes (pre-existing failures in unrelated tests)
- [x] CLI `tsugar expand` works unchanged
- [x] No Node.js imports in `transformer-core`

### Wave 3: Create Browser-Compatible Transform Function

**Tasks:**

- [x] Add `transformCode(code, options)` function to core
- [x] Options: `{ fileName, program?, compilerHost?, verbose? }`
- [x] Default program creation uses in-memory virtual files
- [x] Return `{ code, sourceMap, diagnostics, changed }`

**Gate:**

- [x] Unit tests pass with in-memory programs
- [x] No file system access in core transform path

### Wave 4: Migrate Playground to Use Core

**Tasks:**

- [x] Remove `browser-transform.ts` from playground
- [x] Import `transformCode` from `@typesugar/transformer-core`
- [x] Update `Playground.vue` to use new API (no changes needed — uses `@typesugar/playground` exports)
- [x] Update `PlaygroundEmbed.vue` to use new API (no changes needed — uses `@typesugar/playground` exports)
- [x] Verify all example presets work

**Gate:**

- [x] Playground transforms all macro types correctly
- [x] `@tailrec`, `@derive`, `@typeclass` examples work
- [x] Bundle size not significantly increased (~878 KB browser bundle)

### Wave 5: Add JSDoc and Derive Macro Support to Playground

**Tasks:**

- [x] Verify JSDoc macros (`@typeclass`, `@impl`) work in playground
- [x] Verify derive macros (`@derive(Eq, Ord)`) work in playground
- [x] Add example presets demonstrating each macro type
- [x] Fix any browser-specific issues discovered (none needed)

**Gate:**

- [x] All macro types work in playground
- [x] Manual testing of each example preset
- [x] Console shows no transformation errors

### Wave 6: Documentation and Cleanup

**Tasks:**

- [x] Update AGENTS.md with new package structure
- [x] Add README to `transformer-core` package
- [x] Remove deprecated `browser-transform.ts`
- [x] Update playground package.json dependencies

**Gate:**

- [x] `pnpm docs:build` passes
- [x] No unused exports warnings
- [x] Package dependency graph is clean

## Files Changed

| File                                           | Change               |
| ---------------------------------------------- | -------------------- |
| `packages/transformer-core/`                   | New package          |
| `packages/transformer/src/index.ts`            | Import from core     |
| `packages/playground/src/browser-transform.ts` | Delete               |
| `packages/playground/src/browser.ts`           | Use transformer-core |
| `docs/.vitepress/components/Playground.vue`    | Update imports       |

## Consequences

### Benefits

1. **Single source of truth** — macro expansion logic in one place
2. **Automatic feature parity** — new macros work everywhere
3. **Reduced maintenance** — no manual porting
4. **Better testing** — core can be unit tested in isolation
5. **Smaller browser bundle** — tree-shaking removes CLI/caching code

### Trade-offs

1. **Additional package** — more packages to maintain
2. **Refactoring risk** — touching core transformer code
3. **API design** — need to get dependency injection right

### Future Work

1. **WASM transformer** — core could compile to WASM for even faster browser execution
2. **Worker thread** — run transformation in Web Worker for better UI responsiveness
3. **Incremental transformation** — reuse work when only part of code changes
