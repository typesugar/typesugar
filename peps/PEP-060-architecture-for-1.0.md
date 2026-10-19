# PEP-060: Architecture for 1.0 — What to Settle Before the Freeze

**Status:** Draft (2026-10-19) — proposals and decisions. Implemented on branch
`decisions-1.0`: item 1's packaging part (see its status note), D5 (editor engine), and
item 8's module-qualified macro identity (see its status note). The rest is not.
**Date:** 2026-10-19
**Author:** Claude (with Dean Povey)
**Depends on:** [PEP-059](PEP-059-1.0-readiness.md) (deep review outcome, 1.0 task list),
[PEP-056](PEP-056-transformer-pipeline-unification.md) (dispatcher unification),
[PEP-052](PEP-052-import-scoped-macro-activation.md) (import-scoped activation),
[PEP-050](PEP-050-shipping-typesugar-libraries.md) (runtime/compile-time split),
[PEP-048](PEP-048-package-triage.md) (package triage)

## Context

PEP-059's review hunted defects line by line and deliberately excluded design. This PEP
is the design review that followed it: two read-only reviewers, one on the engine and
every host that drives it, one on package structure and the public surface that 1.0
would freeze. Their full reports, with file:line evidence, are in
[`peps/reviews/2026-10-docs-arch-review/`](reviews/2026-10-docs-arch-review/):
`arch-engine.md` and `arch-surface.md`. The same directory holds the documentation
review (`docs-*.md`), whose examples-run-through-the-real-pipeline method exposed a
further set of code bugs; those are being fixed on branch `docs-arch-1.0` and are not
this PEP's subject.

The question each recommendation answers: **would shipping today's shape as 1.0 force a
breaking change later?** If yes, it must be settled before 1.0. Internal refactors that
users and macro authors cannot observe can follow in 1.x.

## The headline: TypeScript 7 has shipped

`typescript@latest` is **7.0.2** (verified on the registry, 2026-10-19). Its root entry
exports only `version`; the compiler lives under `./unstable/*` as an IPC API with no
transformer hook, no `createProgram`, and no plugin surface. TypeScript 6.0.x (the last
JS-API line) is `6.0.3`.

Every typesugar package, including pure-runtime ones such as `@typesugar/collections`,
peers `typescript ">=5.0.0 <6.0.0"`. So today a new project that runs
`npm i -D typescript` gets 7, and installing typesugar conflicts; 6.0 is excluded although
it still has the JS API (PEP-059's "TS 7 has no JS API" reason conflated 6 and 7); and
under TS 7 `import * as ts from "typescript"` yields only the version object, so the
first `ts.factory` access throws something opaque.

This changes several answers below, most importantly the editor engine (D5), and makes
the compiler strategy the first 1.0 decision.

## Recommendations

Tags: **BLOCKS 1.0** (shape users or macro authors would depend on) or **POST-1.0**
(internal). Sizes S/M/L/XL. "E" refers to `arch-engine.md`, "S" to `arch-surface.md`.

### Compiler and hosts

1. **TypeScript strategy** — BLOCKS 1.0 (decision; packaging S). Widen compiler
   packages to `>=5.0.0 <7` once CI passes on 5.0, 5.9 and 6.0.3; drop the `typescript`
   peer from runtime-only packages; add a startup guard that rejects TS ≥ 7 with an
   actionable message; fix the init templates. Record the post-1.0 direction:
   **typesugar owns a pinned JS TypeScript (6.x) and expands source-to-source**, handing
   expanded TS to whatever compiler the user runs, including tsgo. (S R1)

   _Status (2026-10-19, packaging part landed on `ts-range-1.0`):_
   - Peer range is **`>=5.9.0 <7.0.0`**, not `>=5.0.0 <7`. Measured per version
     (build, `pnpm typecheck`, core/transformer-core/macros/transformer/std/fp suites):
     5.0.4 fails to build (no `checker.isTypeAssignableTo` before 5.4, no
     `Scanner.getTokenStart`/`ImportDeclaration.attributes` before 5.1/5.3, and many
     inference errors in fp/std); 5.4.5 builds partly but every ESM entry dies on
     `ts.ScriptTarget` because TypeScript only ships Node-ESM named exports from 5.5;
     5.5.4 and 5.8.3 build and type-check but `@impl X<unknown>` / `X<object>` never
     resolve (`getUnknownType` arrives in 5.8, `getNonPrimitiveType` in 5.9). 5.9.3
     and 6.0.3 pass, apart from failures that also occur on 5.9.3 and come from
     unrelated work in progress. Supporting 5.0–5.8 would mean replacing those checker
     calls and the `import * as ts` ESM entries; not worth it for 1.0.
   - TypeScript 6 needed only test-harness and repo-config fixes: `types: ["node"]`
     (TS 6 defaults `types` to `[]`), `ignoreDeprecations: "6.0"` for tsup's
     hard-coded `baseUrl` in the repo's own declaration build (CI adds it in the 6.x
     cell only, since 5.x rejects the value), and two tests that evaluated
     `transpileModule` output with `return ${js}` (TS 6 prefixes `"use strict";`).
   - `typescript` is an optional peer of the 13 packages whose `.` entry never loads it
     (codec, collections, contracts, erased, fp, fusion, mapper, parser, strings,
     testing, units, validate, typesugar); `check:runtime-purity` enforces it. effect
     was on the review's list but its root loads `@typesugar/core`, so it stays
     required (item 10).
   - Guard: `assertSupportedTypeScript` in `@typesugar/core`, run first at
     `@typesugar/macros` load and by every host before its first compiler-API access;
     TS 7 (and < 5.9, or a module without `ts.factory`/`ts.createProgram`) gets one
     message linking to `getting-started/troubleshooting#typescript-7`.
   - CI: `typescript-compat` job in `ci.yml` (matrix 5.9.2 / 6.0.3, pnpm override,
     build + typecheck + the suites above), gating nothing.
   - Not done here: the post-1.0 "typesugar owns its TS" direction (b) and the
     MacroContext tiering (c).

2. **One engine, thin hosts** — BLOCKS 1.0 for host parity and for which transformer
   exports are public; L. PEP-056 unified the dispatcher, not the pipeline: there are
   **12 paths** from `.ts` to output, with HKT preprocessing implemented 5×, diagnostic
   conversion 5×, source maps 3×, output type-checking 5×, and two public
   `transformCode`s with different semantics. CLI build/watch and ts-patch have drifted
   (no comprehension preprocessing, unmapped diagnostics). Introduce an `Engine` in
   transformer-core with injected FS/resolver; move all text preprocessing (HKT, then
   comprehension) into the host layer (`VirtualCompilerHost`); make every CLI command,
   unplugin, ESLint, the tsserver plugin and the playground adapters over it. Rebuild
   ts-patch as a program transformer through the Engine host, or drop it (D3). This
   supersedes PEP-059 P0 #8 ("CLI preprocessing parity"), which as a patch would add a
   sixth preprocessing call site. (E R2)
3. **One type-checking and emit model: check the expanded program** — BLOCKS 1.0; L.
   `typesugar build`/`check` check the pre-expansion program and hide errors with
   suppression heuristics; the editor checks the expanded program. They report different
   errors for the same file by construction, `.d.ts` never contains generated members
   (no `afterDeclarations` anywhere), and the `"start < 0"` synthetic-position crash
   class exists because the checker is queried on transformed files. Make every host
   build user-visible diagnostics, JS and `.d.ts` from a second program over the
   expanded text, mapped back through one composed map. Suppression shrinks to the
   `MacroGenerated` rule; `strict` becomes what `check` means. Cost about 1.5–2× check
   time, which the editor already pays. Supersedes PEP-059 P0 #4. Under TS 7 this is
   also the only type-check that can work (D1). (E R1)
4. **Editor engine** — BLOCKS 1.0 as a decision; M. VS Code runs the LSP server and the
   tsserver plugin together, so every feature is served twice and the two have drifted.
   The reviewers split (see D5). (E R6, S D6)
5. **One diagnostics and position model** — BLOCKS 1.0 for user-visible positions; M.
   The Engine is the only producer, emitting diagnostics in original coordinates plus
   one composed map; one `PositionMapper` with one documented unmappable-position policy;
   one source-map generator. (E R7)

### State and cross-file semantics

6. **A file's expansion is a pure function of (Program, file, config, macro set)** —
   BLOCKS 1.0 (documented semantics and registration API); M–L. Type rewrites
   (`@opaque`/`@adt`), `@extension`, kind params, generic registries, effect
   layers/services and match extractors are filled while the _defining_ file expands
   and read by later files, so output depends on bundler request order, worker
   assignment and watch history. PHILOSOPHY.md documents this as intended ("global after
   registration … available to all subsequent files"); that sentence is PEP-059 P0 #3.
   Replace each with a lazily built per-Program declaration index (the pattern the
   instance/op/do-instance indexes already use correctly), add `ctx.addFileDependency`,
   keep the permuted-transform-order test as the invariant's regression test, and
   rewrite the CLAUDE.md "Resolving things a macro just generated" rule, which today
   blesses the cross-file registry shape. (E R3)
7. **Session → ProgramState → FilePass lifetimes** — BLOCKS 1.0 for the API shape and
   `@internal` marking (M); the internal migration can trail (L). One Session per
   tsconfig (config, cfg, approved macro set resolved from the _project_ root,
   suppression rules, caches), a `WeakMap<Program, ProgramState>` for indexes, and
   per-file state for hygiene/diagnostics/expansion records. Nothing else mutable at
   module scope. Add `ctx.programState(key, init)` for third-party authors. This is the
   concrete design for PEP-059 P0 #2. (E R4)

### Contracts users and authors depend on

8. **Macro-author contract v1** — BLOCKS 1.0; M. Today the contract is "all ~289 core
   exports plus raw TS plus unversioned `globalThis` singletons". Remove `hygiene` and
   `expansionCache` from `MacroContext`; promote what authors need (`printer`,
   `valueToExpression`, `programState`, `addFileDependency`, read-only `config`);
   declarative registration keyed `module::exportName`; an `apiVersion` field; core as a
   `peerDependency` of macro packages with a versioned `globalThis` key that fails loudly
   on a second core; one dispatcher re-visit rule. Name the portable, typesugar-owned
   part of the context (`getTypeOf`, `isAssignableTo`, `reportError`, `ensureImport`, …)
   as the stable tier and document raw `ts.*` handles as bound to the engine's TS
   version, which is safe once item 1's "typesugar owns its TS" holds. (E R5, S R1c)

   _Status (2026-10-19, Dean's decision):_ module-qualified identity is implemented —
   the registry keys module-qualified macros by (kind, module, exportName ?? name), so
   same-named macros from different packages coexist and the user's import decides which
   expands (motivating bug: `@typesugar/validate` and `@typesugar/testing` both register
   `assert`; validate also gained `assertType<T>()`). Declarative registration,
   `apiVersion`, the peer dependency and the context cleanup are not done.

9. **Curate and freeze the public surface** — BLOCKS 1.0; L (mechanical). `.` = stable,
   `./internal` = cross-package engine API documented unstable, api-extractor reports in
   CI (extends PEP-059 P0 #5). Delete dead modules (`prelude`, core `manifest`,
   `ResolutionTracer`, `MacroPipeline`, the opt-in expansion cache nobody opts into and
   its CLAUDE.md exception). Give fp an explicit subpath list instead of `"./*"`, and
   record each companion's public module in metadata rather than deriving it from file
   layout. Drop `typesugar/core`. (S R3, E R8)
10. **The runtime/compile-time split leaks** — BLOCKS 1.0 for emitted imports; M. The
    root entries of std, sql, type-system, graph, math, contracts-refined and the three
    facades load `typescript` and the macro engine at runtime (std: 138 MB / 161 ms on
    import), and every `@derive` app imports `@typesugar/macros` at runtime. The purity
    gate greps one file and cannot see it. Build a TS-free runtime kernel, require every
    module named in emitted code to be runtime-pure (tested), and make the gate
    transitive. (S R2)
11. **Register the emitted-code contract** — BLOCKS 1.0; M. Code compiled by 1.0
    references `__typesugar_registerExtension`, `__typesugar_companions`, helper globals
    in strings and graph, and specific module paths forever. Check in one list of emitted
    runtime symbols and modules with a test; choose `.d.ts` metadata for compiled-library
    discovery and stop emitting runtime self-registration. (S R8)
12. **Runtime fallback contract** — BLOCKS 1.0 for the classification; S–M. Without the
    transformer, placeholders throw, no-op, work, or are _silently wrong_ (`let:` runs as
    a label with `<<` as a bit shift; `requires:` checks nothing; operators concatenate
    `"[object Object]"`). Classify every placeholder; one `TypesugarTransformRequiredError`;
    no value-returning stub may return a wrong value. Turning a no-op into a throw after
    1.0 is breaking. (S R7)
13. **One typeclass vocabulary, module-qualified identity** — BLOCKS 1.0 (breaking for
    fp); L. std's `Eq` (`equals`, a `@typeclass`) and fp's `Eq` (`eqv`, not one) coexist,
    derive markers are a third `Eq`, and identity is the bare name in the registry, the
    runtime companions global and the `typesugar` family wildcard. std becomes canonical,
    fp re-exports it; the derive marker becomes the typeclass's companion value; identity
    is (module, name); drop the family wildcard and the `typemacro`/`ttfx`/`macrots`
    aliases. (S R4)
14. **One config schema, one reader, closed** — BLOCKS 1.0; M. Four surfaces exist
    (config file + `TYPESUGAR_*`, tsconfig plugin entry read only by ts-patch, unplugin
    options, `TYPESUGAR_CFG_*`), so `cfg()` evaluates differently per host. Make
    `typesugar.config.*` the only project config with a closed schema extended by
    declaration merging; put cfg conditions in it; package.json `"typesugar"` = library
    manifest only; the tsconfig entry carries only the transformer name. (S R5, E R9)

### Packaging and release

15. **Lockstep versions and explicit tiers** — BLOCKS 1.0; S. Internal deps are already
    exact pins while changesets `fixed` is empty, so every core patch forces dependents
    to republish and mixed installs duplicate core. One `fixed` group for stable +
    experimental packages; frozen packages stay 0.x outside it; the tier recorded in each
    `package.json` and README banner (the tier table is in `arch-surface.md` §3). (S R6)
16. **Package boundaries** — BLOCKS 1.0 where they are removals; M. Retire the derive,
    reflect and typeclass facades (they load TS and duplicate the umbrella); fold
    contracts-refined into `@typesugar/contracts/refined`; move fp's law re-exports to
    `@typesugar/fp/laws`; one language-service plugin name; one owner for the
    `typesugar` bin; rename fp's runtime `syntax` subpath, which clashes with the
    activation-marker meaning elsewhere. (S R9)
17. **Node floor** — BLOCKS 1.0 as a decision; S. Config loading needs
    `process.getBuiltinModule` (≥ 20.16); propose `>=22.12`, which also brings unflagged
    `require(esm)`. (S R10)
18. **Release candidate soak** — process. The review branches changed about 46k / 16k
    lines in `packages/`. Ship 0.2/0.3 with the API reports as the release candidate
    rather than freezing the first release after that churn. (S R11)

### After 1.0

19. Performance: `invalidate()` marks dirty instead of rebuilding (today a cold unplugin
    build rebuilds the Program once per file — fix that one before 1.0, S); one factory
    per Session; cached dependency hashes; tsserver plugin rebuilds once per sync, not
    once per dependent. (E R10)
20. Layering: move typeclass resolution, instance scanning, specialization and
    suppression rules from `@typesugar/macros` into the engine, so macros contains only
    macro definitions (mark the involved exports `@internal` at 1.0). (E R11)
21. Hygiene from the checker (`resolveName` at the use site) instead of a top-level
    binding scan; one root cause behind six review findings. (E R12)
22. TypeScript 7 host prototype: prototype one host against the TS 7.1 API when its beta
    ships (overlay + `createProgram` + checker over IPC); measure per-call checker cost —
    the key risk, since macros make many checker calls per file. Feeds the separate TS 7
    PEP that D4 calls for.

## Decisions for Dean

- **D1. Type-checking model.** (a) Check the expanded program everywhere (≈2× check
  cost; honest errors; correct `.d.ts`; suppression mostly retired) or (b) keep
  pre-expansion checking with suppression (fast; unsound; `.d.ts` wrong).
  _Recommended: (a)._ PHILOSOPHY.md's "Safety Guarantee 1" already promises it, and under
  TS 7 (b) cannot work at all because suppression can't run inside tsgo.
- **D2. Scoping of `@extension` and `@opaque`.** (a) keep "no import needed" via a
  Program-wide declaration index, or (b) make user `@extension` import-scoped like
  PEP-052 typeclasses. _Recommended: (b) for `@extension`, (a) for `@opaque`._
- **D3. ts-patch at 1.0.** Rebuild as a program transformer through the Engine (full
  parity), support as "no HKT, no comprehensions", or drop from `init` and the docs.
  _Recommended: rebuild if item 2 lands in 1.0, otherwise drop._
- **D4. TypeScript strategy.** _Recommended:_ typesugar owns a pinned JS TS 6.x and
  expands source-to-source; widen to `<7` now with a TS 7 guard; freeze MacroContext v1 on
  the 5.x/6.x API; open a separate PEP for TS 7.
- **D5. Editor engine — the reviewers disagree.** The engine reviewer recommends the
  **tsserver plugin** (workspace TS version, project references, multi-project, works in
  every tsserver-based editor; the LSP is single-project with no references or file
  watching). The surface reviewer recommends the **LSP server** as the long-term engine,
  because tsserver plugins do not exist in TS 7 while an LSP that bundles its own TS
  keeps working. Both agree the double-engine setup must end. _Synthesis:_ pick the
  plugin for 1.0 only if D4 keeps users on TS ≤ 6 for the 1.x line; if 1.x must support
  TS 7 projects, the LSP is the only engine that can, and it needs multi-project and
  project references before 1.0.
  **Decided (Dean, 2026-10-19): the tsserver plugin is the single editor engine for
  1.0; TS 7 via TypeScript 7.1's content mappers; the LSP server is deprecated.**
  Implemented on `decisions-1.0`: the VS Code extension no longer starts
  `@typesugar/lsp-server` and keeps only UI (Expand Macro / Show Transformed, answered
  by the plugin through the custom tsserver requests `_typesugar.expandMacro` and
  `_typesugar.showTransformed`); the plugin gained macro-expansion inlay hints, the
  trusted `comptimeInEditor` setting via `configurePlugin`, and a guard against loading
  twice per project. CodeLens, macro semantic tokens, the status bar and the
  manifest commands were dropped. `@typesugar/lsp-server` stays in the repo, marked
  unsupported (README banner, one-time warning on start). Editor docs are plugin-first
  for every editor (`docs/getting-started/editor-setup.md`). TS 7 has no tsserver
  plugins; the TS 7 editor path is a follow-up PEP on 7.1 content mappers, not the
  LSP.
- **D6. Is the Engine/Session refactor (items 2, 7) in 1.0 or 1.1?** _Recommended:_ in
  1.0 ship the `@internal` marking, one public entry-point name (so
  `TransformationPipeline` doesn't freeze), and build/watch routed through the existing
  pipeline for parity; the full Session in 1.1.
- **D7. The umbrella.** (a) slim one-install `typesugar` (TS-free root, bundler
  subpaths, CLI; facades and `./core` dropped) or (b) split runtime and toolchain
  packages. _Recommended: (a)._
- **D8. Typeclass vocabulary.** _Recommended:_ std canonical; fp breaks now while it has
  no external users.
- **D9. Lockstep versioning and tiers.** _Recommended:_ yes to a `fixed` group; frozen =
  published 0.x outside it; remove the facades before 1.0.
- **D10. Node floor.** _Recommended:_ `>=22.12`.
- **D11. package.json `"typesugar"`.** _Recommended:_ library manifest only.
- **D12. Release-candidate soak before 1.0.** _Recommended:_ yes.

## Design documents that describe something else

`docs/architecture.md` is stale in most sections (legacy `src/` paths, a nonexistent
`load` hook, the expansion cache as the working model, no mention of the comprehension
preprocessor, the runtime/compile-time split, PEP-055 discovery or the two type-checking
models). PHILOSOPHY.md's resolution modes, always-in-scope prelude, "type-checked after
expansion" guarantee, "no I/O" sandbox and ts-patch-first diagram are all false today.
Both reports list the specifics (E §5, S §5). Rewriting `docs/architecture.md` belongs
after D1–D6 are decided, since it should describe the target, not today's drift.

## Relationship to PEP-059's 1.0 task list

| PEP-059 P0 item                       | This PEP                                           |
| ------------------------------------- | -------------------------------------------------- |
| #2 isolate per-program state          | item 7 (concrete design)                           |
| #3 cross-file ordering                | item 6 (removes the cause instead of pre-scanning) |
| #4 `.d.ts` includes generated members | item 3 (falls out of expanded-program emit)        |
| #5 freeze the public API              | items 8, 9, 11                                     |
| #6 stability tiers                    | item 15 and the tier table                         |
| #7 Windows/macOS/multi-TS CI          | item 1 adds the 5.0 / 5.9 / 6.0.3 matrix           |
| #8 CLI preprocessing parity           | item 2 (one engine instead of a parity patch)      |

## Proposed order

1. Decisions D1–D12.
2. The cheap blockers: TS range and guard (1), lockstep and tiers (15), Node floor (17),
   unplugin cold-build rebuild (19), dead-surface deletion (9, part).
3. Contracts: author contract v1 (8), surface curation and API reports (9), emitted-code
   registry (11), runtime fallback classification (12), config schema (14), runtime
   kernel (10).
4. Engine: one engine (2), expanded-program checking (3), diagnostics model (5), per-file
   purity (6), Session API (7).
5. Release candidate (18), then 1.0.
