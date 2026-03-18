# PEP-017: Playground Architecture Consolidation

**Status:** Active
**Date:** 2026-03-18
**Updated:** 2026-03-18 (revised after PEP-018 removed OXC backend)
**Author:** Claude (with Dean Povey)

## Context

The playground currently maintains **5 parallel systems** that duplicate knowledge about typesugar packages:

| System              | Location                                         | What it duplicates                                                   |
| ------------------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| Real transformer    | `@typesugar/transformer`                         | Nothing — auto-discovers everything                                  |
| Browser bundle      | `packages/playground/src/browser.ts` (188 lines) | Opaque rewrites, extension methods, `stateMachine` macro             |
| Server endpoint     | `api/compile.ts` (688 lines)                     | Opaque rewrites, extension methods, `stateMachine` macro, type stubs |
| Test file           | `tests/playground-examples.test.ts` (595 lines)  | All of the above plus compiler host                                  |
| Monaco declarations | `Playground.vue` (~600 lines of addExtraLib)     | Type declarations for IDE completions                                |

The `stateMachine` tagged template macro has **4 separate `expand()` implementations**. Type stubs for `@typesugar/std` appear in **3 places** with different contents. Every time a package adds a new export, up to 4 files need manual updates.

### Root Cause

`@typesugar/transformer-core` is a browser-compatible single-file transformer. It cannot auto-discover extension methods, `@opaque` interfaces, or package-specific macros. The real `@typesugar/transformer` does all this automatically, but it's Node-only.

The browser fallback was added as a safety net, but the playground is a web app — if users can load it, they have internet. The fallback is pure complexity with no user benefit.

## Solution

**Server-only architecture. No browser fallback. No backward compatibility.**

1. **Delete browser transformer bundle entirely.** No more `browser.ts`, no `transformer-core` in the playground.
2. **`api/compile.ts` uses `@typesugar/transformer`** with auto-discovery. Zero manual registrations, zero type stubs.
3. **Tests use `@typesugar/transformer`** directly. No stubs, no custom compiler host.
4. **Monaco declarations remain** (separate concern — editor completions, not compilation).

```
┌─────────────────┐  POST /api/compile  ┌─────────────────────────┐
│ Monaco Editor   │ ──────────────────► │ api/compile.ts          │
│ (Playground.vue)│ ◄────────────────── │ @typesugar/transformer  │
│                 │                     │ (TypeScript transformer)│
└─────────────────┘                     │ Zero manual registrations│
                                        └─────────────────────────┘
```

**What gets deleted:**

- `packages/playground/src/browser.ts` — all 188 lines of duplicated registrations
- `api/compile.ts` — rewritten from 688 lines to ~120 lines
- `tests/playground-examples.test.ts` — rewritten from 595 lines to ~80 lines
- `Playground.vue` browser fallback path (~60 lines)

**What stays:**

- Monaco `addExtraLib()` declarations in `Playground.vue` (editor completions are separate from compilation)
- LRU cache, rate limiting, content hashing in `api/compile.ts`
- Runtime IIFE bundle for the sandbox iframe (`runtime.global.js`)

## Waves

### Wave 1: Switch Server to Real Transformer

**Goal:** `api/compile.ts` uses `@typesugar/transformer` with auto-discovery. All duplication deleted.

**Tasks:**

- [ ] Rewrite `api/compile.ts`:
  - Replace `import { transformCode } from "@typesugar/transformer-core"` with `import { transformCode } from "@typesugar/transformer"`
  - Delete ALL manual registrations (opaque rewrites, extension methods, stateMachine macro)
  - Delete `TYPESUGAR_STUBS` and `createServerCompilerHost()`
  - Simplify `compile()` to just call `transformCode(code, { fileName })`
  - Keep: LRU cache, rate limiting, content hashing, keep-warm ping
- [ ] Update `vercel.json` if needed (memory/duration for real transformer)
- [ ] Test locally: all 33 playground examples compile via server endpoint

**Gate:**

- [ ] `api/compile.ts` has ZERO manual registrations, ZERO type stubs
- [ ] `api/compile.ts` is under 200 lines (was 688)
- [ ] Local test with `node -e` confirms: staticAssert, comptime, match, extension, opaque, and stateMachine all transform correctly
- [ ] `pnpm test` passes (ALL tests — no exceptions)
- [ ] **Deep code review:** Verify the server uses ONLY `@typesugar/transformer`, check that extension method examples produce function-call rewrites, check that @opaque examples produce null-check rewrites, check that stateMachine produces object literal expansion

### Wave 2: Rewrite Tests to Use Real Transformer

**Goal:** `tests/playground-examples.test.ts` uses the real transformer directly. No stubs, no custom host.

**Tasks:**

- [ ] Rewrite `tests/playground-examples.test.ts`:
  - Replace `import { transformCode } from "@typesugar/transformer-core"` with `import { transformCode } from "@typesugar/transformer"`
  - Delete ALL manual registrations (opaque, extensions, stateMachine macro)
  - Delete `TYPESUGAR_STUBS` and `createServerHost()`
  - Each test: `transformCode(code, { fileName: examplePath })` — real file path so transformer resolves imports from `node_modules`
  - Keep: example discovery, per-example assertions, `.sts` preprocessing
- [ ] Verify all 33 examples pass with `pnpm vitest run playground-examples`

**Gate:**

- [ ] Test file is under 150 lines (was 595)
- [ ] ZERO type stubs, ZERO manual registrations in test file
- [ ] All 33 examples pass (including the 1 `.sts` preprocessor example)
- [ ] `pnpm test` passes (ALL tests — no "pre-existing" excuses)
- [ ] **Deep code review:** Verify every test assertion still checks `result.changed === true`, verify no stubs or manual registrations leaked back in, verify `.sts` preprocessing still works

### Wave 3: Remove Browser Transformer Bundle

**Goal:** Delete the browser fallback code path entirely.

**Tasks:**

- [ ] Delete browser transformer registration code from `packages/playground/src/browser.ts`:
  - Remove all opaque rewrite registrations
  - Remove all extension method registrations
  - Remove inline `stateMachine` macro and DSL parser
  - Keep ONLY: re-exports from `index.js`, `ts` re-export, `VERSION`, `isReady()`
- [ ] Update `Playground.vue`:
  - Remove `playground.value` (browser transformer instance) — no longer needed
  - Remove `loadPlayground()` function's transformer loading
  - Remove browser fallback path in `doTransform()` (lines ~1395-1430)
  - Keep: Monaco editor setup, `addExtraLib()` declarations, server compilation, runtime IIFE
  - Keep `loadPlayground()` for runtime IIFE loading (sandbox needs it)
  - If server is unavailable, show a clear error message instead of silently degrading
- [ ] Update `packages/playground/tsup.config.ts` — check if browser bundle entry point can be simplified
- [ ] Delete `api/test-transformer.ts` (created during investigation, no longer needed)

**Gate:**

- [ ] `browser.ts` is under 20 lines (just re-exports + version)
- [ ] `Playground.vue` has no reference to `transformer-core`
- [ ] `doTransform()` has exactly one code path: server compilation
- [ ] `pnpm --filter @typesugar/playground build` succeeds
- [ ] `pnpm test` passes (ALL tests)
- [ ] **Deep code review:** Verify `Playground.vue` has no dead code from removed browser fallback (variables, functions, imports), verify `browser.ts` has no macro-specific imports, verify the error UX for server-unavailable is reasonable

### Wave 4: Final Cleanup and Verification

**Goal:** End-to-end verification, cleanup stale code, ensure all tests pass.

**Tasks:**

- [ ] Remove unused imports across all modified files
- [ ] Check `package.json` dependencies — can `@typesugar/transformer-core` be removed from playground's dependencies?
- [ ] Verify the playground works end-to-end by running the docs dev server
- [ ] Run full test suite: `pnpm test`
- [ ] Run lint: `pnpm lint`
- [ ] Run typecheck: `pnpm typecheck`
- [ ] Run format: `pnpm format:check`

**Gate:**

- [ ] `pnpm test` passes (ALL 6000+ tests)
- [ ] `pnpm lint` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm format:check` passes
- [ ] No references to `transformer-core` remain in `api/compile.ts`, `tests/playground-examples.test.ts`, or `Playground.vue` (except possibly as a peer dep)
- [ ] **Deep code review:** Full audit of all files changed in this PEP — verify no accidental functionality loss, verify Monaco declarations are still complete, verify runtime IIFE sandbox still works

## Files Changed

| File                                        | Change                                               |
| ------------------------------------------- | ---------------------------------------------------- |
| `api/compile.ts`                            | Rewrite: 688 → ~120 lines, use real transformer      |
| `api/test-transformer.ts`                   | DELETE                                               |
| `tests/playground-examples.test.ts`         | Rewrite: 595 → ~80 lines, use real transformer       |
| `packages/playground/src/browser.ts`        | Gut: 188 → ~15 lines, remove all registrations       |
| `docs/.vitepress/components/Playground.vue` | Remove browser fallback path                         |
| `vercel.json`                               | Possibly update memory/duration for real transformer |

## Consequences

1. **Benefits:**
   - **1 source of truth** — the real transformer auto-discovers everything
   - **Zero maintenance** — new packages/exports/macros work automatically
   - **~1200 lines deleted** across 4 files
   - **No more drift** — impossible for stubs to fall out of sync

2. **Trade-offs:**
   - Playground requires server connectivity (acceptable — it's a website)
   - Slightly slower cold starts on Vercel (real transformer is heavier than transformer-core)
   - Monaco declarations still need manual updates (separate concern, could auto-generate later)

3. **Future work:**
   - Auto-generate Monaco `addExtraLib()` from real `.d.ts` files (build script)
   - Server-side LSP over WebSocket for real diagnostics in editor
   - `@typesugar/transformer-core` could be removed from the repo entirely if no other consumers
