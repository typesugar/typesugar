# PEP-050: Authoring & Shipping Standalone typesugar Libraries

**Status:** Implemented (Waves 1–3 done; optional getting-started/README cross-links remain)
**Date:** 2026-06-28
**Author:** Claude (with Dean Povey)

## Context

typesugar packages mix two fundamentally different kinds of artifact, and shipping
them correctly requires treating them differently. This was surfaced during the
PEP-033 reconciliation (N3b: `Option.map()` dot-syntax never worked for consumers
because fp's companion functions were not importable; 4D: macro code leaks
`typescript` into runtime bundles). This PEP defines the canonical model for
authoring and publishing a typesugar library and makes fp the reference example.

A typesugar package can ship up to three things:

| Part                 | When it runs                                    | Build deps                      | In the app's runtime bundle? | Entry                            |
| -------------------- | ----------------------------------------------- | ------------------------------- | ---------------------------- | -------------------------------- |
| **Macros**           | consumer **build** time, inside the transformer | `typescript`, `@typesugar/core` | **No**                       | `./macros` (`sideEffects: true`) |
| **Runtime**          | app **run** time                                | none                            | Yes                          | `.` (and per-module subpaths)    |
| **`.d.ts` metadata** | consumer build time (read, not executed)        | —                               | n/a                          | alongside `.` types              |

A package may ship any subset:

- **Macro-only** (a compiler plugin): e.g. a custom `@derive` strategy. Pure macros.
- **Runtime-only**: e.g. `@typesugar/fp` — companion functions + zero-cost types +
  `@opaque`/`@derive` annotations. No executable macro; consumer-side `.d.ts`
  discovery does the rewriting.
- **Both**: e.g. `@typesugar/std` — ships the `match` macro (build-time) _and_ the
  `MatchError` runtime class + companions; the macro emits an import back to the
  runtime via `ctx.ensureImport`.

## The two cases

### Case 1 — Macros (build-time compiler extensions)

Macro definitions (`defineExpressionMacro`/`defineAttributeMacro`, `@typeclass`/`@impl`
handlers, `@derive` strategies) run **inside the consumer's transformer**. They:

- register into `globalRegistry` (pinned to `globalThis`, per PEP-033 1C, so the
  ESM/CJS dual-instance hazard can't split the registry);
- are loaded by the transformer's **macro-loader**, which `require`s the package for
  its side-effect registrations (facade packages resolve via `FACADE_TO_PROVIDER` →
  `@typesugar/macros`);
- depend on `typescript` + `@typesugar/core` — **build-time only**.

**Hard rule: macros must never reach the app's runtime bundle.** They import
`typescript` (multi-MB). They MUST live in a separate entry (`./macros`,
`"sideEffects": true`) so bundlers tree-shake them out of `.` (the runtime entry).
A macro that needs a runtime symbol emits an import to the **runtime** entry — e.g.
the `match` macro emits `MatchError` via `ctx.ensureImport("MatchError",
"@typesugar/std")`, never bundling `MatchError`'s definition into build-time code.

### Case 2 — Runtime library code

Plain, **post-transform** TypeScript: companion functions (`map(opt, f)`,
`equals(a, b)`), zero-cost values, derived instances as plain objects
(`Point.Eq = {...}`). No `typescript` dependency; bundleable; works under plain
`tsc` with zero typesugar setup. The published `.d.ts` carries `@opaque`/`@derive`
annotations as **metadata** that an _optional_ consumer-side transformer reads to
enable dot-syntax sugar.

## Consumer tiers

A correctly-shipped library is usable at two levels with the **same artifact**:

1. **Standalone** (no typesugar in the consumer build): import and call companion
   functions directly — `map(opt, f)`, `Point.Eq.equals(a, b)`. Plain TS, no setup.
2. **With the transformer**: additionally get dot-syntax — `opt.map(f)`,
   `a.equals(b)` — rewritten to those same companions via the `.d.ts` annotations.

**Honest limit:** a _zero-cost_ type cannot offer dot-syntax standalone (`Some(42)`
is literally `42`; raw values have no methods). So the companion-function API is the
real standalone surface; dot-syntax is a typesugar-only enhancement. Libraries must
make the companion API first-class and document that dot-syntax requires the
transformer.

## Packaging requirements (the rules)

1. **Per-module emit, never bundled declarations.** rollup-plugin-dts (tsup
   `dts:true`) collapses modules into chunk files and renames colliding companions
   (`map` → `map$1`), destroying both consumer-side discovery and stable import
   names. Emit per-module `.d.ts` (via `tsc --emitDeclarationOnly`) and per-module
   JS, preserving each type's declaring module, its annotations, and stable export
   names.
2. **Companions must be importable and collision-free.** Same-named companions for
   different types (Option's `map` vs Either's `map`) cannot share one top-level
   export. Namespace them — **per-type subpath exports** (`@lib/data/option` exports
   `map`) is the chosen approach (consistent with per-module emit). The consumer's
   rewrite imports the companion from the type's own subpath.
3. **Preserve `.d.ts` annotations + the type↔companion relationship**, so
   consumer-side discovery can map `opt.map` → the right companion in the right module.
4. **Isolate macros** in a `./macros` entry (`sideEffects: true`) with `typescript`/
   `@typesugar/core` as peer/dev deps; keep the `.` runtime entry free of
   `typescript`.

## Waves

### Wave 1: fp as the Case-2 reference (unblocks PEP-033 N3b)

- [x] De-bundle fp's `.d.ts`: `tsup` `dts:false` + `tsconfig.build.json`
      (`tsc --emitDeclarationOnly`); build = `tsup && tsc -p tsconfig.build.json`.
      Per-module `.d.ts`, stable companion names (no `map$1`), 0 type errors.
- [x] Transformer: `dts-opaque-discovery` follows relative re-exports
      (`collectReExportedDtsFiles`) and scans `@opaque` **interfaces** (not just type
      aliases), so fp's `Option` (re-exported from the entry) is found.
- [x] Make Option's companions importable: `tsup` `bundle:false` (per-module JS
      mirroring `src`) + a `"./*"` wildcard subpath export, so
      `@typesugar/fp/data/option` exposes `map` etc.
- [x] Discovery: set `TypeRewriteEntry.sourceModule` to the companion's actual subpath
      (`subpathFor` computes it from the file path relative to the entry), so the
      injected `import { map } from "@typesugar/fp/data/option"` resolves. Also made
      re-export following resolve targets by **file path** (`resolveRelativeDts`, disk
      fallback) since dependency sub-modules aren't in the consumer's program.
- [x] Fixed two packaging bugs the de-bundle exposed: (1) fp source had 51
      extensionless relative imports → emitted `.d.ts` invalid under NodeNext (TS2835);
      added `.js` extensions. (2) `VirtualCompilerHost.resolveRelativeModule` resolved a
      `.js` specifier to the emitted `.js` (typeless → `any`) instead of the `.d.ts`;
      now prefers the declaration (regression test `virtual-host-resolution.test.ts`).
- [x] Verified the full matrix end-to-end: (a) plain-`tsc` consumer calling
      `map(o, f)` from `@typesugar/fp/data/option` — 0 errors; (b) typesugar consumer
      using `o.map(f)` → `map(o, …)` imported from the subpath — `expand` + `check`
      clean, `run` prints `142`. All suites green (core 134, macros 825, transformer
      396, fp 99, std 350).

### Wave 2: Case-1 macro/runtime split (finishes PEP-033 4D)

- [x] **CI gate added** — `scripts/check-runtime-purity.mjs` (`pnpm check:runtime-purity`)
      flags any runtime library whose built `.` entry imports `typescript`, with an
      ALLOWLIST for build-time infra (core/macros/transformer/plugins/etc.). NOT yet
      wired into the blocking CI aggregate — it stays a tracking tool until the
      worklist below is cleared, then becomes blocking.
- [x] **Loader enabler** — `macro-loader.ts` now prefers a package's `./macros` entry
      and falls back to the package root (backward compatible). This is what lets a
      split package keep working: the transformer loads `pkg/macros` (typescript-side)
      while the app bundles only `.`.
- [x] **Reference split: `@typesugar/strings`** — macros moved to `src/macros.ts`
      (`./macros` export), `.` runtime entry (stubs + `__typesugar_escapeHtml`) is now
      `typescript`-free. Verified: purity check clean, `regex\`…\``still expands via
the`/macros` entry, tests pass (incl. a new test asserting the split).
- [x] **Worklist done (2026-06-28, parallel subagents):** split all 13 remaining
      leakers — `codec, contracts, effect, erased, fusion, graph, mapper, parser, sql,
std, type-system, units, validate` — each macros → `./macros`, runtime `.` entry
      now `typescript`-free, tests updated. `node scripts/check-runtime-purity.mjs` now
      **passes** (no runtime library leaks `typescript`). Full monorepo build green; all
      package test suites green (only the umbrella `typesugar` package's pre-existing
      "no test files" quirk remains, unrelated).
- [x] **Wired `check:runtime-purity` into the blocking CI gate** (`.github/workflows/ci.yml`,
      Lint & Typecheck job).
- [x] Fixed a build fallout: fp's de-bundled per-module JS exposed `Console`'s lazy
      `require("readline")` to the playground's browser bundler — added a `readline`
      browser-shim (alongside the existing fs/path/crypto/process/vm/os shims).

### Wave 3: Documentation

- [x] `docs/guides/authoring-libraries.md` — the full model, both cases, consumer
      tiers, packaging rules, checklist, with **strings** (Case 1) and **fp** (Case 2)
      as worked examples.
- [x] Cross-linked from `docs/guides/index.md`.
- [ ] (Optional) cross-link from getting-started and package READMEs.

## Consequences

1. **Benefits** — typesugar libraries become real, shippable npm packages usable
   standalone _and_ enhanced by the transformer; the `typescript` dependency stops
   leaking into app bundles; dot-syntax sugar works for consumers for the first time.
2. **Trade-offs** — per-module emit produces more files than a bundled `.d.ts`;
   per-type subpath exports are more `exports` entries. Acceptable (and there are no
   external consumers yet — see the prerelease note).
3. **Future work** — a general consumer-side discovery that resolves companions via
   the type checker (not file scanning) would remove the per-type-subpath constraint.
