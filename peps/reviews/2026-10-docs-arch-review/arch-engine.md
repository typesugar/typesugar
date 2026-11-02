# Architecture review: GROUP engine (core, transformer-core, transformer, unplugin, ts-plugin, LSP, VS Code, playground, ESLint)

Read-only review. I edited nothing and ran nothing heavy. Evidence comes from the code on `deep-review-1.0`, plus three Explore sub-reports (editor hosts, build hosts, macro contract), whose load-bearing claims I spot-checked. Paths are relative to `packages/` unless stated otherwise.

---

## 1. Current architecture

### 1.1 Components and data flow

```
                    ┌──────────────── @typesugar/core (one "." export, ~287 symbols) ────────────────┐
                    │ MacroContext/Impl · define*Macro · globalRegistry(globalThis) · hygiene ·      │
                    │ resolution-scope · type-rewrite registry · standalone-extension registry ·     │
                    │ diagnostic-suppression rules · config singleton · ExpansionTracker · caches    │
                    └───────────────▲───────────────────────────────▲───────────────────────────────┘
                                    │                               │ (register at import time)
   @typesugar/macros  ── built-in macros AND engine services (resolveInstance, InstanceScanner,
   (+std/effect/fp macros)          specialize registries, suppression rules, cfg global, kindParamRegistry)
                                    ▲
   @typesugar/transformer-core ── MacroTransformer (the ONE dispatcher since PEP-056) · rewriting ·
                                    method-sugar · specialization · import-resolution · position-mapping-core
                                    · transformCode() + private createTransformerFactory   (browser-safe)
                                    ▲
   @typesugar/transformer (Node) ── macroTransformerFactory (pipeline.ts:319) · TransformationPipeline
                                    (pipeline.ts:1000) · VirtualCompilerHost (HKT) · arrow-comprehension
                                    preprocess · macro-loader · DiskTransformCache · cli.ts · language-service.ts
       ▲            ▲             ▲              ▲               ▲               ▲
   cli build/   ts-patch      unplugin       tsserver plugin   lsp-server     eslint full / playground
   check/watch  (tsc's own    (Pipeline)     (Pipeline +        (Pipeline +    (Pipeline / core
   (own hosts)  Program)                     tsserver Program)  own LS)        transformCode)
```

The layering is circular in practice:

- `transformer-core` depends on `@typesugar/macros` (`transformer-core/package.json`; imports in `specialization.ts:31,92`, `method-sugar.ts:15`, `rewriting.ts:18`, `transformer.ts:23`, `extension-registration.ts:16`).
- `@typesugar/macros` writes into core's engine state (`globalResolutionScope.registerDefinedTypeclass`, `typeclass.ts:1504,2826`; `registerTypeRewrite`, `opaque.ts:354`, `adt.ts:769`; suppression-rule registration).
- So the "built-in macro library" is part of the engine, not a plugin.

### 1.2 The paths from `.ts` to output (question 1)

There are 12 distinct paths. One dispatcher is shared, but the pipeline around it is not:

| Path                                                                                  | Program built over                                               | HKT                       | Expression-comprehension rewrite                                              | Diagnostics                                  | Maps                                               |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------- |
| `build`/`check` (`cli.ts:414`)                                                        | own `createCompilerHost` + readFile map (`cli.ts:492-505`)       | ad hoc (`cli.ts:355`)     | **no**                                                                        | side channel, **not mapped back**            | TS emit only, HKT map not composed                 |
| `watch` (`cli.ts:781`)                                                                | `createWatchCompilerHost` on a `ts.sys` clone (`cli.ts:810-819`) | ad hoc                    | **no**                                                                        | `TransformerState.takeDiagnostics`, unmapped | TS emit                                            |
| ts-patch (`transformer/src/index.ts:41`)                                              | tsc's own Program, original text                                 | **no** (`F<A>` is TS2315) | **no**                                                                        | `extras.addDiagnostic`                       | tsc                                                |
| `expand`, `run`, unplugin, tsserver plugin, LSP, ESLint full, VS Code, `/api/compile` | `TransformationPipeline` + `VirtualCompilerHost`                 | in host                   | yes, ad hoc in `transform()` with a Program rebuild (`pipeline.ts:1204-1249`) | returned, mapped (`pipeline.ts:1317,2290`)   | AST-walk generator (`pipeline.ts:630`) + remapping |
| `expand --ast`, dead `transformFile` (`cli.ts:931,1024`)                              | VirtualCompilerHost                                              | yes                       | **no**                                                                        | ignored                                      | none                                               |
| core `transformCode` (playground browser, `transformer-core/src/transform.ts:201`)    | in-memory, empty libs                                            | **no**                    | **no**                                                                        | own conversion (`transform.ts:426-478`)      | printer `SourceMapGenerator` (`transform.ts:356`)  |
| ESLint light (`eslint-plugin/src/processor.ts`)                                       | none                                                             | ad hoc                    | no                                                                            | n/a                                          | MagicString + hand composition                     |

Responsibilities implemented more than once:

- **HKT preprocessing: 5 places.** `virtual-host.ts:119`, `cli.ts:355`, `cli.ts:1175`, `processor.ts:111`, `cli.ts:1358`.
- **Comprehension preprocessing: only inside `TransformationPipeline.transform`.** Hence the PEP-059 P0-8 symptoms and transformer #9 and #13.
- **Diagnostic conversion: 5 places.** `pipeline.ts:425-484`, two copy-pasted blocks at `pipeline.ts:1955-1980` and `1986-2009`, `transform.ts:426-478`, and `transform.ts:489`. Display formatting exists in 4 more places.
- **Source-map generation: 3 methods.** The pipeline's AST walk, core's printer generator, and TS emit.
- **Two public `transformCode` functions with different semantics.** `transformer/src/pipeline.ts:2354` (Program-backed) and `transformer-core/src/transform.ts:201` (in-memory, no preprocessing).
- **Typechecking of expanded output: 5 places.** `cli.ts:570-663`, `pipeline.ts:1568` and `1618`, `pipeline.ts:2429`, `transform.ts:545`, and `/api/compile.ts`.
- **Two transformer-factory lifecycles.** Watch reuses `TransformerState`. The Pipeline builds a fresh factory, a fresh `HygieneContext` and a new `MacroExpansionCache` after every `resetProgram()` (`pipeline.ts:1850-1863`, `359-374`).

### 1.3 Two type-checking models

| Host                | What the user's TS errors come from                                                                                                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI `build`/`check` | Checks the **pre-expansion** (HKT-rewritten) Program, then hides the errors macros will fix using suppression rules (`cli.ts:666-690`, `filterTsDiagnostics`). `--strict` type-checks output produced by transforming **detached, type-less** re-parses (`cli.ts:578-611`). |
| tsserver plugin     | Feeds the **expanded** text into tsserver's own Program (`language-service.ts:359-387`, wrapped `getScriptSnapshot`), then _also_ runs suppression on it (`language-service.ts:461-490`).                                                                                   |
| LSP                 | Its own LanguageService over expanded text (`lsp-server/src/server.ts:382-406, 866`).                                                                                                                                                                                       |
| ts-patch            | tsc's Program over original text.                                                                                                                                                                                                                                           |

So `typesugar build` and the editor report different error sets for the same file, by construction. `.d.ts` comes from the pre-expansion AST in every host: there is no `afterDeclarations` anywhere in the repo (grep confirmed).

### 1.4 Process-wide state inventory (question 2)

"Order-dep." means the result depends on which files were transformed earlier in the process.

| State                                                                                              | Location                                                 | Key                                                                          | Cleared by (production)                                                        | Watch                                     | Several Programs in one process (tsserver, LSP)                                                                                      | Parallel workers                      |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| Macro definitions                                                                                  | `core/registry.ts:513`, on `globalThis`, unversioned key | bare name; `module::export` is secondary                                     | never                                                                          | ok (code)                                 | Packages approved/loaded for project A are live for B; loaded relative to the transformer, not the project (`macro-loader.ts:20,46`) | per worker, ok                        |
| `loadedPackages`                                                                                   | `macro-loader.ts:46`                                     | package name                                                                 | tests only                                                                     | ok                                        | one version per process                                                                                                              | ok                                    |
| Standalone extensions                                                                              | `registry.ts:644`, `globalThis`                          | (method, type, qualifier, declaringFile)                                     | per file on re-transform (`withStandaloneExtensionFile`, `transformer.ts:371`) | deleted files linger                      | other projects' entries are candidates                                                                                               | **order-dep.**                        |
| Type rewrites (`@opaque`/`@adt`)                                                                   | `type-rewrite-registry.ts:180-181`                       | name + declarationFile                                                       | never (`clearTypeRewrites` is test-only)                                       | stale until the definer is re-transformed | cross-project                                                                                                                        | **order-dep.**                        |
| `scannedDtsFiles`                                                                                  | `dts-opaque-discovery.ts:33`                             | .d.ts path                                                                   | never                                                                          | node_modules updates ignored              | shared                                                                                                                               | ok                                    |
| `globalResolutionScope`                                                                            | `resolution-scope.ts:227`                                | fileName                                                                     | per file at scan (`resolution-scope.ts:321`)                                   | ok                                        | same path in two projects shares an entry                                                                                            | ok                                    |
| Syntax-marker fallback                                                                             | `syntax-marker-fallback.ts:63`                           | specifier                                                                    | never                                                                          | ok                                        | leaks providers across projects                                                                                                      | order of package load                 |
| Suppression rules                                                                                  | `diagnostic-suppression.ts:102`                          | rule name                                                                    | replace-on-register                                                            | ok                                        | last project's `MacroGenerated` closure (mitigated by the per-call `positionMapFn`, `language-service.ts:484`)                       | ok                                    |
| Config                                                                                             | `core/config.ts:130-135`                                 | one per process; last `load()` wins (the comment at 124-129 admits it)       | `load()`                                                                       | config edits never picked up              | **wrong project's config**                                                                                                           | each loads                            |
| `cfgConfig`                                                                                        | `macros/cfg.ts:48`                                       | —                                                                            | never; set only when the factory receives a cfg (`pipeline.ts:338`)            | stale                                     | inherited by the next project                                                                                                        | ok                                    |
| `activeExpansionCache`                                                                             | `pipeline.ts:154`                                        | —                                                                            | overwritten by the newest factory (including the side pipeline)                | saves only the last one                   | wrong                                                                                                                                | —                                     |
| `globalHygiene`                                                                                    | `hygiene.ts:837`                                         | —                                                                            | fallback only (`context.ts:54`); hosts pass their own                          | —                                         | —                                                                                                                                    | —                                     |
| `globalExpansionTracker`                                                                           | `source-map.ts:221`                                      | —                                                                            | cleared per transform (`pipeline.ts:1924,2046`)                                | ok while single-threaded                  | shared                                                                                                                               | ok                                    |
| `kindParamRegistry`                                                                                | `macros/hkt.ts:281`                                      | `Type.param`                                                                 | never                                                                          | stale                                     | name collisions                                                                                                                      | **order-dep.**                        |
| `genericRegistry` / `genericMetaRegistry`                                                          | `macros/generic.ts:108,273`                              | name                                                                         | never                                                                          | stale                                     | collisions                                                                                                                           | **order-dep.**                        |
| effect `layerRegistry` / `serviceRegistry`                                                         | `effect/src/macros/layer.ts:78`, `service.ts:80`         | name                                                                         | never                                                                          | "overwriting" logs                        | collisions                                                                                                                           | **order-dep.** (effect-contracts #28) |
| match extractors                                                                                   | `std/src/macros/match.ts:164`                            | name                                                                         | never                                                                          | stale                                     | collisions                                                                                                                           | order-dep.                            |
| `include` file deps                                                                                | `macros/include.ts:42`                                   | path                                                                         | never; unbounded; no consumer                                                  | —                                         | —                                                                                                                                    | —                                     |
| Instance-method registry                                                                           | `macros/specialize.ts:313-314`                           | WeakMap<Program> plus a shared "legacy" bucket for callers without a program | WeakMap                                                                        | ok                                        | legacy bucket shared                                                                                                                 | ok                                    |
| Index caches (InstanceScanner, typeclass-index, do-instance-index, markerCache, derivation caches) | `macros/*`, `resolution-scope.ts:256`                    | WeakMap<Program> or <SourceFile>                                             | automatic                                                                      | **correct**                               | **correct**                                                                                                                          | **correct**                           |
| LSP server                                                                                         | `lsp-server/src/server.ts:111-148`                       | one tsconfig per process                                                     | —                                                                              | —                                         | single project only                                                                                                                  | —                                     |
| ESLint full processor                                                                              | `full-processor.ts:43,50,80`                             | module-level pipeline                                                        | never                                                                          | —                                         | one project                                                                                                                          | —                                     |

The last-but-two row is the pattern to standardize on. Everything above it with "never" in the clearing column is the PEP-059 P0 #2 list.

---

## 2. Assessment: what is sound and can be frozen

- **One dispatcher (`MacroTransformer` in transformer-core, PEP-056).** The rewriting logic is no longer duplicated. Keep it.
- **`VirtualCompilerHost` as the preprocessing seam.** Rewriting text _before_ Program creation, so the checker never sees invalid syntax, is the right design. It just isn't used by every host.
- **Scope-based, declaration-derived resolution (PEP-052).** Instances, op-index, do-instances and syntax markers are resolved by asking the Program, and cached in `WeakMap<ts.Program | ts.SourceFile>` (`instance-resolver.ts:87`, `typeclass-index.ts:55`, `do-instance-index.ts:33`, `resolution-scope.ts:256`). This is order-independent, per-program and worker-safe by construction. It is the model everything else should move to.
- **Macro kinds and their `expand` signatures** (`core/types.ts:297-679`): six kinds with clear inputs and outputs. Freezable with small cleanups (see R5).
- **`ensureImport`/`safeRef` as the only way generated code references symbols.** The concept is right. Its implementation (top-level binding scan) is not; that can be fixed internally after 1.0.
- **The TS9xxx diagnostic code catalogue** (`core/diagnostics.ts:1319`). Freeze the codes.
- **PEP-055 discovery plus approval allowlist.** Right policy. The loader resolves from the wrong root (R4).
- **The macro-diagnostic side channel** (`TransformerState.recordDiagnostic`, `pipeline.ts:235`) instead of `context.addDiagnostic`. Correct given TS drops `before`-transformer diagnostics.

---

## 3. Recommendations (most important first)

### R1. Settle one type-checking and emit model: the "expanded Program" (two-Program) model, for every host. **BLOCKS 1.0**

**Problem.** Hosts type-check different programs (§1.3), so errors and exit codes differ between the editor and `typesugar build`. `.d.ts` omits generated members (PEP-059 P0 #4). The CLI's correctness depends on suppression rules guessing which errors macros will fix.

**Evidence.**

- This model produced a whole cluster of review findings:
  - "suppression rules hid every Newtype brand mismatch and every `money + 1`" (PEP-059 table);
  - core #50 (a throwing rule silently stops suppressing);
  - the three `"start < 0"` catch blocks in `cli.ts` (around lines 610-690) and `clampSyntheticPositions` (`pipeline.ts:265`). These exist because the checker is queried on a Program whose SourceFiles have been transformed.
- `--strict` transforms type-less detached copies (`cli.ts:578-611`), so it checks output macros produced _without_ type info. That is not what ships.
- PHILOSOPHY.md contradicts itself: its "Safety Guarantees #1: all macro expansions are type-checked by tsc after expansion" versus "Diagnostic Suppression Rules: the type checker runs on the original source".

**Design.** Every host does the same two steps:

1. Macros run against Program A, built over _preprocessed_ source. This is what the pipeline already does.
2. User-visible type errors, JS emit and **`.d.ts` emit** come from Program B, built over the _expanded_ text (a second VirtualCompilerHost serving printed output). Its diagnostics are mapped back through the composed map.

This is what the tsserver plugin already does (tsserver's Program is B). Consequences:

- Suppression rules shrink to the one rule that is about mapping: `MacroGenerated`, meaning a diagnostic inside generated code with no original position. The rest become unnecessary or debug-only.
- `.d.ts` includes companions and generated members.
- The synthetic-position crash class disappears, because Program B is parsed from text and has no synthetic nodes.
- `strict` stops being an option: it _is_ `check`.

**Alternatives rejected.**

- (a) Keep "check pre-expansion + suppress" and add `afterDeclarations`. It keeps one checker (cheaper), but suppression is unsound by design: each rule is a heuristic that will keep both hiding real errors and missing phantom ones. `afterDeclarations` also can't add declarations for code the checker never saw typed.
- (b) Make ts-patch the primary model. It can't preprocess HKT or comprehensions inside tsc's single Program.

**Cost.** Two checkers per build, about 1.5–2× check time. The editor already pays this.

**Blast radius.**

- Users see a different, more honest error set from `build`/`check`. Some errors previously suppressed appear; this is already on the PEP-059 breaking list in spirit.
- `DiagnosticSuppressionRule` public API shrinks.
- `strict`/`strictOutput` options are deprecated.
- `.d.ts` output changes (adds members).

**Size.** L. **Blocks 1.0** because it decides the emitted `.d.ts` contract, CLI exit-code semantics and whether the suppression-rule API is public.

### R2. One engine, thin hosts: finish PEP-056 at the pipeline level. **BLOCKS 1.0** (parity and API); internal clean-up can continue after

**Problem.** PEP-056 unified the dispatcher, but its stated goal ("used identically by the CLI, the language service, and the browser playground") is unmet at the pipeline level: there are 12 paths (§1.2). PEP-059 P0 #8 (CLI parity) is a symptom, not the disease. Fixing build/watch separately adds a seventh preprocessing call site.

**Evidence.**

- transformer #9 (comprehensions mangled), #12 (positions not mapped), #13 (watch TS2315), #8 (`run` expanded only the entry), #4 (stale Program), #17 (language service never re-transformed on dependency change).
- tooling #5 (ESLint lints disk, not the buffer) and #15 (LSP rebuilds).
- PEP-056's own Wave 4 retrospective: "two further gaps surfaced only once the cutover ran real code".
- The two `transformCode`s.

**Design.**

- An `Engine` (or `Session`, see R4) in transformer-core takes an injected `FileSystem` and `ModuleResolver`, so it stays browser-safe.
- **Preprocessing moves entirely into the host layer:** `preprocess(fileName, text, resolver) → {text, map, diagnostics}` = HKT, then comprehension. The comprehension activation gate needs only a syntactic import scan, `ts.resolveModuleName`, and reading the marker module's first JSDoc. It does not need a checker, so it can run inside `VirtualCompilerHost.getSourceFile`. That removes the per-file Program rebuild at `pipeline.ts:1238-1249`.
- The Engine API:
  - `transform(file) → EngineResult {code, map: original→expanded (composed), diagnostics in ORIGINAL coordinates, dependencies}`
  - `emit()` (R1)
  - `invalidate(files[])`
  - `dispose()`
- Hosts become adapters:
  - CLI `build`/`check`/`watch`/`run`/`expand` all use the Engine. Watch uses the Engine plus a file watcher, not `createWatchCompilerHost` with a hand-patched `readFile`.
  - unplugin and the ESLint full processor keep their overlay.
  - The tsserver plugin uses `getScriptSnapshot` → `engine.transform`.
  - The playground uses the Engine with an in-memory FS. Delete the private `createTransformerFactory` (`transform.ts:398`) and the core `transformCode`, or make it a 10-line wrapper over the Engine.
- **ts-patch:** switch to a ts-patch _program transformer_ (`transformProgram: true`, which returns a replacement Program built through the Engine's host). That gives HKT and comprehension preprocessing inside `tsc`. Otherwise drop ts-patch from `init` and the docs for 1.0 (see Decision D3).

**Alternatives rejected.**

- Patch each host to call the same helpers (the P0 #8 approach). It closes today's gaps and guarantees the next drift.
- Make the CLI call `ts.transform` per file without emit. That loses `tsc`-compatible emit.

**Blast radius.**

- Exported `TransformationPipeline`, `createPipeline`, `macroTransformerFactory`, `TransformerState`, `PipelineOptions`, `VirtualCompilerHost`, both `transformCode`s, and the `./pipeline`/`./virtual-host`/`./cache` subpath exports. Collapse them to the Engine plus a deprecated alias.
- unplugin options (`strict`, `diskCache`).
- `init`'s ts-patch config.

**Size.** L. Blocks 1.0 for: build/watch/check/ts-patch parity, and the decision on which transformer exports are public (whatever ships at 1.0 is frozen). Deleting the dead paths can trail.

### R3. Cross-file knowledge must be derivable from the Program, not from side effects of other files' expansions. **BLOCKS 1.0**

**Problem (question 3).** Today there are four dependency mechanisms:

- (a) Checker queries on the whole Program. Order-independent.
- (b) Declaration scans of imported modules (InstanceScanner, markers). Order-independent.
- (c) **Mutable registries filled while the _defining_ file is expanded:**
  - type rewrites (`opaque.ts:354`, `adt.ts:769`), with no discovery path for same-project `.ts` because `dts-opaque-discovery.ts:96-107` skips relative imports and non-`.d.ts` files. That also hits monorepo workspace packages resolved to `.ts`.
  - `@extension` (`registry.ts:644`)
  - `kindParamRegistry`
  - the generic registries
  - effect layers and services
  - match extractors
- (d) An import graph used only for cache invalidation (`pipeline.ts:2179`). The LSP doesn't even use it (`server.ts:316`).

Mechanism (c) is order-dependent and worker-nondeterministic **by construction**. PHILOSOPHY.md documents it as intended: "Type rewrites: global after registration ... available to all _subsequent_ files" (PHILOSOPHY.md:508-523). That sentence _is_ the PEP-059 P0 #3 bug. **I think this recorded decision is wrong:**

- It makes output depend on Vite's on-demand request order, on webpack worker assignment, and on watch history.
- Its benefit ("no import needed") is achievable without order dependence.

**Evidence.**

- core #3, #18; macros-other "global registries never cleared"; effect-contracts #28; PEP-059 P0 #3.
- The CLAUDE.md "Resolving things a macro just generated" rule only addresses _same-pass_ visibility. It blesses (c) as the "correct" shape, even though (c) is wrong across files.

**Design.**

- Adopt the invariant: **a file's expansion is a pure function of (Program, file, project config, macro set).** Macros may not pass information between files through mutable state.
- Each registry in (c) becomes a lazily built, per-Program **declaration index** (the R4 ProgramState):
  - `@opaque`/`@adt`: the registration is already a pure function of the declaring SourceFile plus the checker (`opaque.ts:290-354`). Run the same extraction on demand, given the declaration the checker resolves for a receiver or callee. Use one code path for `.ts` and `.d.ts`, which merges `dts-opaque-discovery`.
  - `@extension`: index by declaration. If "available without import" is kept, build a Program-wide syntactic index of `@extension` declarations (one pass over `program.getSourceFiles()`); see Decision D2.
  - layers/services, kind params, generics: key by declaration, resolve through imports.
- Invalidation dependencies are then exactly the import graph, plus explicit `ctx.addFileDependency(path)` for `include`/`comptime` reads (the unused `getFileDependencies`, PEP-059 P1 #11).
- Keep PEP-059's proposed test that permutes transform order for every registry-backed macro. It becomes a regression test for the invariant.
- Rewrite the CLAUDE.md rule accordingly.

**Alternative rejected:** a pipeline pre-scan that transforms or registers definers first (PEP-059's suggestion). It needs a project-wide pass before any file in Vite dev and the editor, which is exactly where on-demand order matters. It still couples files through mutable state, and it doesn't help parallel workers.

**Blast radius.**

- `registerTypeRewrite`, `registerStandaloneExtensionEntry`, `standaloneExtensionRegistry`, `kindParamRegistry` and the effect registries leave the public API.
- PHILOSOPHY's scoping table changes.
- No user-code change unless D2 makes `@extension` import-scoped.

**Size.** M–L, one registry at a time. Type rewrites are M. Blocks 1.0 because the documented semantics and the public registration API are what changes.

### R4. Concrete per-Program state model (PEP-059 P0 #2). **Partly BLOCKS 1.0**: the API shape and `@internal` marking block; the internal migration can trail

**Design: three lifetimes, nothing else is mutable at module scope.**

```
Session      — one per project (tsconfig). Created by the host; dispose() on project close.
               config (load({searchFrom: tsconfigDir}), cfg), approved macro set resolved from the
               PROJECT root (createRequire(tsconfigDir) instead of macro-loader.ts:20), suppression
               rules instantiated per session (closures bind this session), disk caches,
               programState: WeakMap<ts.Program, ProgramState>
ProgramState — one per ts.Program; garbage-collected with it.
               declaration indexes (type rewrites, extensions, instances, op-index, markers,
               kind params, layers/services, .d.ts discovery), derivation caches,
               instance-method registry, macro-author storage
FilePass     — one per file transform.
               HygieneContext scope, FileBindingCache + pending imports, the file's ResolutionScope,
               diagnostics, expansion records (replaces globalExpansionTracker)
```

- **Plumbing.** `MacroContextImpl` gets `session` and `programState` (internal). Engine modules take `ctx`, not module globals.
- **Author API.** Add `ctx.programState<T>(key: symbol, init: () => T)`, so third-party authors stop copying the in-repo pattern of 10 module-level `WeakMap<ts.Program>` caches.
- **What stays process-global:** immutable tables, macro _definitions_ (they are code), and `primitiveIntrinsicRegistry`.
- **Host reset contract.** One Session per tsconfig; `session.invalidate(files)`; `session.dispose()`. Hosts reset nothing else.
- **Tests** construct a Session instead of clearing globals. That removes `test-helpers.ts`'s "clear everything" behaviour.
- **Parallel workers** need nothing: with R3, every worker derives the same ProgramState from the same Program.

**Evidence.** The §1.4 table. Specific failures:

- core #33 and #35 (multi-project tsserver uses the wrong mapper and wrong config);
- `cfgConfig` inherited across projects (`macros/cfg.ts:48`, `pipeline.ts:338`);
- `activeExpansionCache` last-writer (`pipeline.ts:154`);
- macro packages resolved from the transformer's install (`macro-loader.ts:20`; core cross-scope lead about pnpm).

**Alternative rejected:** a documented `resetAll()` for hosts. It cannot be correct for two projects alive at once in one tsserver.

**Blocks 1.0:**

- (i) Mark every mutable-state export `@internal` or move it out of `@typesugar/core`'s root: `globalRegistry` mutation, `globalHygiene`, `globalResolutionScope`, `globalExpansionTracker`, `standaloneExtensionRegistry`, the type-rewrite API, the suppression registry, `getOrCreateWeak`, and `globalCoherenceChecker`/`globalResolutionTracer`.
- (ii) Add `ctx.programState`.
- (iii) Make config per Session.

Moving each registry is internal and can land in 1.x.

**Size.** L total. The blocking part is M.

### R5. Make the macro-author contract freezable. **BLOCKS 1.0**

**Problem (question 4).** The real contract today is "all of `@typesugar/core` (~287 exports through one `.` entry) plus the raw TS API, plus unversioned `globalThis` singletons".

**Evidence (macro-contract sub-report):**

- `MacroContext` leaks internals: the concrete `hygiene: HygieneContext` class, `expansionCache?: MacroExpansionCache` (`types.ts:43,46`), and the pending-import machinery behind `safeRef`/`ensureImport`.
- In-repo macros bypass the interface. Comptime downcasts `ctx as MacroContextImpl` 4 times to reach `comptimeValueToExpression` (`comptime.ts:719-740`). 24 files touch `globalRegistry` directly. `registerTypeRewrite`, `globalResolutionScope` and suppression registration come from inside macros.
- Registry primary maps are keyed by bare name (`registry.ts:292-396`). Two packages' `match` collide and throw. `isSameMacro` silently drops same-named first-party macros. The loader swallows the throw (`macro-loader.ts:399-403`; core #40).
- No API version anywhere. `globalThis` keys are unversioned (`registry.ts:513,641,697`). Other singletons split across duplicate installs of core, so with mixed versions macros register but their rewrites and suppression rules vanish. Macro packages depend on core as a `dependency`, not a `peerDependency`. `createMacroContext`'s `instanceof HygieneContext` check (`context.ts:1058`) breaks under dual installs.
- Re-visit semantics are unspecified. Each handler decides whether a macro's output is re-visited. That caused core #7, #8, #12 and #13 (unexpanded nested macros, a stack-overflow loop).
- `defineSyntaxMacro` registers itself while the `define*Macro` helpers don't. 15 doc snippets show a non-existent two-argument `defineExpressionMacro("name", {...})`.
- No macro sets `cacheable: true` (grep: 0), so the `cacheable` field is dead API.

**Design for "MacroContext v1":**

- Keep raw `ts.*` objects (`program`, `typeChecker`, `factory`, `sourceFile`). Wrapping the TS API is not worth it; see D4.
- Replace `transformContext` with `ctx.visitChildren(node, fn)`.
- Remove `hygiene` and `expansionCache` from the interface.
- Promote what authors actually need: `printer`, `valueToExpression` (the comptime one), `programState` (R4), `addFileDependency` (R3), and a read-only `config`.
- **Declarative registration.** The package's `typesugar.macros` entry exports `macros: MacroDefinition[]` (the existing `__typesugar_macros__` convention, `macro-loader.ts:378-390`). The Session registers them, keyed `module::exportName`. Keep `globalRegistry.register` working as `@deprecated`.
- Add `apiVersion: 1` to the definition, checked by the loader with a loud error.
- Make `@typesugar/core` a **peerDependency** of macro packages, and version the `globalThis` key, failing loudly on a second core instance.
- Specify one re-visit rule in the dispatcher: an expansion result is visited again (with a fixpoint guard); cache hits and opt-outs are not. Then make handlers return raw results.
- Split exports: `@typesugar/core` (author API), `@typesugar/core/host` (engine and host), everything else `@internal`. Then run api-extractor, as PEP-059 P0 #5 proposes.

**Alternatives rejected.**

- Freeze as-is: every internal becomes a semver liability.
- An abstract AST/checker facade: XL, and it duplicates TS for little gain while TS 5.x is the only target.

**Blast radius.** Third-party macro authors (few today, which is why now is the time), in-repo macro packages (mechanical), docs.

**Size.** M.

### R6. One editor engine: the tsserver plugin. **BLOCKS 1.0** as a decision; implementation is M

**Problem (question 6).** VS Code runs both engines: `typescriptServerPlugins` plus an LSP over IPC (`vscode/src/extension.ts:53-73`). Diagnostics, completion, hover, definition, references, signature help, rename and code actions are each served twice. A session builds at least 4 `ts.Program`s per project across two processes. The two engines have already drifted:

- the LSP cache ignores dependencies (`server.ts:316-318`), while the plugin tracks `depVersions`;
- the LSP has a line-content fallback for diagnostics (tooling #24);
- the plugin doesn't map positions for code fixes (`language-service.ts:553`).

The LSP handles one tsconfig, has no project references and no file watching. 8 vscode modules are dead. 4 of 6 settings do nothing.

**Recommendation.** The tsserver plugin is the engine:

- It gets the workspace TS version, project references, multi-project, and every TS feature it doesn't intercept.
- It works in every editor whose TS support is tsserver-based (VS Code, and Neovim/Zed/Sublime through typescript-language-server or vtsls, which load tsserver plugins).

Then:

- Freeze or deprecate `lsp-server` (its README already says frozen). Mark it unsupported at 1.0, or delete it.
- The VS Code extension keeps only UI: the expansion peek and diff, through a tsserver plugin custom request or by running `typesugar expand`.
- CodeLens, inlay hints and macro semantic tokens move to plugin-provided `provideInlayHints`/`getEncodedSemanticClassifications` overrides, or are dropped for 1.0.

**What each side gives up.**

- Dropping the LSP loses non-tsserver editors (rare for TS) and LSP-only CodeLens and inlay hints until they are ported.
- Dropping the plugin instead would lose TS-version fidelity, project references, multi-project support and all the unintercepted TS features, and would require reimplementing them.
- "LSP diagnostics-only" (PEP-059's other option) still double-reports diagnostics alongside tsserver's, unless TS validation is disabled, which tooling #6 showed is fragile.

**Side benefit.** `typesugar.manifest.json` (`transformer/src/manifest.ts`, `lsp-server/src/manifest.ts`, `vscode/src/manifest.ts`, a different schema in each) exists to feed the LSP and vscode modules. The plugin can read the live registry, so the manifest and `build --manifest` can go.

**Blast radius.** VS Code users (transparent), anyone using `typesugar-lsp` directly, lsp-common consumers.

**Size.** M.

### R7. One diagnostics and position model end to end. **BLOCKS 1.0** for user-visible positions; the mapper consolidation can trail

**Problem (question 5).** There are several models:

- 5 diagnostic conversions;
- 8 position-mapping wrappers with three different policies for an unmappable position: B keeps it, E drops it, F guesses by line content (editor sub-report §4);
- 3 source-map generators;
- build and watch diagnostics not mapped through the HKT map, so line numbers are off after the injected `import type { Kind }` (`hkt-rewriter.ts:298-313`);
- `.js.map` points into preprocessed text;
- `expand` prints raw offsets (`cli.ts:1001`);
- the ESLint full processor ignores macro diagnostics.

Findings in this cluster: core #21, #22, #41; transformer #12, #13; tooling #2, #16, #24; P1 #17.

**Design.**

- The Engine (R2) is the only producer. It emits `EngineDiagnostic {file, start, length, code, severity, message, suggestion?}` in **original** coordinates, plus one composed `original→expanded` map.
- There is exactly one `PositionMapper` (`position-mapping-core.ts`), with one documented policy: unmappable means attach to the macro call site's span if known, else drop with a count in verbose logs.
- Pick **one** map generator: the printer `SourceMapGenerator` (exact, behind feature detection), falling back to the AST walk only when the TS internals are missing. Delete the other path.
- Hosts only render. One CLI formatter. unplugin uses `this.error`/`this.warn` with locations.
- With R1, JS maps compose `[TS emit of Program B] ∘ [engine map]`.

**Size.** M. Blocks 1.0 because CLI positions and `.js.map` are user-visible contracts and `TransformDiagnostic`/`PositionMapper` are exported types.

### R8. Remove the dead expansion-cache surface and fix the transform disk cache. **BLOCKS 1.0** (API removal, S)

**Evidence.**

- The expansion cache is opt-in (`transformer.ts:162-168`) and no macro opts in. Yet it is still constructed and loaded from disk for every new factory (`pipeline.ts:364-371`), exposed as `ctx.expansionCache`, `MacroDefinition.cacheable`, `MacroExpansionCache`, `saveExpansionCache`, `cacheDir`, and given a CLAUDE.md exception (the `transformer.ts` cache).
- CLI `build --cache` is write-only, stores JS under kind "expanded-ts" with no config key, and shares the directory and `manifest.json` with the pipeline (`cli.ts:447-451,561`).
- unplugin's first-sight `invalidate()` (`unplugin.ts:219-222`) deletes the disk entry before reading it (`cache.ts:697-709`), so the unplugin `diskCache` option can never hit.

**Design.**

- Delete the expansion cache and its CLAUDE.md exception (that also removes a string round-trip site).
- Keep one file-level transform cache in the Engine, keyed (content, transitive import hashes, config key, typesugar version).
- Don't invalidate on first sight.

**Size.** S. Mostly deletion.

### R9. Config and manifest formats. **BLOCKS 1.0** (S–M)

**Problem.** Format decisions harden at 1.0:

- The `"typesugar"` key in `package.json` means both the PEP-055 macro manifest and project config, and the first hit wins (core #37).
- `typesugar.manifest.json` means two unrelated things: core's dead library manifest (`core/manifest.ts`) and the IDE macro manifest.
- `resolution.mode`/`fileOverrides` are documented but never read (core 1.0 gaps).
- Config is one per process (R4).

**Design.**

- `package.json` `"typesugar"` = the library manifest only. Project config lives only in `typesugar.config.*`.
- Delete core `manifest.ts`, and the IDE manifest if R6 lands.
- Delete or implement `resolution.mode`.

**Size.** S–M.

### R10. Performance architecture (question 7). **POST-1.0**, except the unplugin cold-build item (S, do before 1.0)

Repeated work found:

- **unplugin cold build:** every file's first `transform()` calls `invalidate()`, which calls `resetProgram()`. So N files means N Program rebuilds, each with a fresh TypeChecker, plus N factory, hygiene and expansion-cache reloads (`unplugin.ts:219`, `pipeline.ts:1403-1416`, `1850`).
- **tsserver plugin, one keystroke:** every transitive dependent calls `p.invalidate(dep)` again, so one Program reset and rebuild _per dependent_ in a single sync (`language-service.ts:257-270`). tsserver then rebuilds its own Program.
- **Comprehension files** pay an extra Program rebuild per cache-miss transform (`pipeline.ts:1180` compares against HKT text, not the override).
- Every in-memory cache hit re-reads and re-hashes all transitive dependencies (`pipeline.ts:2083-2085`).
- The LSP `fs.statSync`s every closed file per LS sync (`server.ts:230-243`). Semantic tokens, CodeLens and inlay hints re-parse per request.
- The activation scan runs twice per file (`pipeline.ts:1808` and in the factory, `pipeline.ts:405`).
- `offsetToLineColumn` is linear (P1 #17). `findGeneratedPosition` is O(segments) per lookup (core #21).

**Design.**

- `invalidate()` only marks the Program dirty. Rebuild once at the next `transform`, per generation.
- One factory per Session, not per Program. The factory takes the Program from the generation.
- Comprehension preprocessing in the host (R2) removes the override rebuild.
- Dependency hashes are cached per generation.

**Size.** M. The unplugin first-sight fix is S, and cold-build cost is user-visible.

### R11. Layering: the engine depends on the built-in macro library. **POST-1.0** (mark macros' engine exports `@internal` before 1.0)

**Evidence.**

- transformer-core imports `resolveInstance`, `getMethodCandidates`, specialization registries and `createRegistrationCall` from `@typesugar/macros` (§1.1).
- macros writes engine state.
- core's diagnostic texts hard-code `@typesugar/std` (`diagnostics.ts:501,541-543,1210`).

**Design.** Move typeclass resolution, instance scanning, specialization and suppression rules into the engine (transformer-core, or an internal `@typesugar/engine-typeclass`). `@typesugar/macros` then contains only macro definitions.

**Blast radius.** None if the macros exports involved (`kindParamRegistry`, `instanceScanner`, `registerAllDiagnosticSuppressionRules`, …) are `@internal` at 1.0.

**Size.** L.

### R12. Hygiene from the checker, not a top-level scan. **POST-1.0** (internal)

**Evidence.** The cluster core #14, #15, #26, #27, #28, #44 shares one root cause: `FileBindingCache` collects only top-level bindings and treats `KNOWN_GLOBALS` as unshadowable (`hygiene.ts:63-67,256-350`). Each was patched.

**Design.** `ensureImport`/`safeRef` resolve the name at the use site (`checker.resolveName`, or `getSymbolsInScope(callSite)`), and allocate an alias whenever the name resolves to anything other than the intended import. The API is unchanged.

**Size.** M.

---

## 4. Decisions for Dean

- **D1. Type-checking model (R1).**
  - (a) Expanded-Program checking everywhere: about 2× check cost; honest errors; correct `.d.ts`; suppression rules mostly retired.
  - (b) Keep pre-expansion checking plus suppression rules: fast, but unsound, and `.d.ts` stays wrong.
  - **Recommend (a).** PHILOSOPHY's "Safety Guarantees #1" already promises it.
- **D2. `@extension` / `@opaque` scoping (R3).** Today it is "global after registration" (PHILOSOPHY.md:460-523).
  - (a) Keep "no import needed", but derive it from a Program-wide declaration index. Order-independent, but every file then depends on every `@extension` file for invalidation.
  - (b) Make user `@extension` import-scoped, like PEP-052's typeclasses, keeping process-wide built-ins only for std's self-registering dist.
  - **Recommend (b) for user code and (a) for `@opaque`.** An opaque type is only reachable through its declaration, so its index is naturally import-driven.
- **D3. ts-patch at 1.0.**
  - (a) Rebuild it as a ts-patch program transformer through the Engine host: full parity.
  - (b) Support it as "transform-only, no HKT, no comprehensions".
  - (c) Drop it from `init` and the docs.
  - **Recommend (a) if R2 lands, else (c).** (b) is the drift that P0 #8 complains about.
- **D4. TypeScript future.** The macro contract exposes the TS 5.x JS API (`program`, `typeChecker`, `factory`), and the peer range is capped `<6.0.0`. TypeScript 7 (native) has no JS transformer or plugin API.
  - **Recommend:** freeze MacroContext v1 on the TS 5.x API (don't build an abstraction layer for 1.0), state the TS range in the contract, and open a separate PEP for a TS 7 strategy.
  - Also decide whether to admit TS 6.0, the last JS-API release. The current cap excludes it.
- **D5. Editor engine (R6, PEP-059 decision 2).** **Recommend:** tsserver plugin as the single engine; LSP unsupported or frozen at 1.0; VS Code extension reduced to UI.
- **D6. Is the Engine/Session refactor (R2 + R4) in 1.0 or 1.1?** If 1.1, 1.0 must still ship:
  - the `@internal` marking (R4 i–iii);
  - one public entry point name, so `TransformationPipeline` doesn't freeze;
  - build/watch routed through the existing `VirtualCompilerHost` and Pipeline (cheap parity).
  - **Recommend:** that minimal set in 1.0 and the full Session in 1.1. The internal migration is not observable once the state APIs are `@internal`.

---

## 5. Doc and code mismatches

**docs/architecture.md:**

- §2 "Location: `src/transforms/macro-transformer.ts` (legacy)" and §3 "`src/core/` — internal implementation (used by the legacy transformer)". There is no root `src/`. The parallel `context.ts`, `pipeline.ts` etc. described there don't exist.
- Overview and Summary: "two phases (HKT rewrite, AST transform)" and "Lexical preprocessing followed by AST transformation". This omits the expression-comprehension text preprocessor (`transformer/src/arrow-comprehension-preprocess.ts`), which runs between them, only in the Pipeline, and forces a Program rebuild.
- §3 Expansion Cache shows `computeKey(macroName, sourceText, argTexts)` as the working model. The cache is opt-in and no macro opts in.
- §9 unplugin: "`buildStart` creates the Program, `load` runs the preprocessor, `transform` runs the transformer", plus a "Known Limitation" that the checker sees `F<A>`, citing `docs/PLAN-implicit-operators.md`. That plan file doesn't exist. The Pipeline is created lazily, there is no `load` hook, and VirtualCompilerHost already serves preprocessed text.
- Future Improvements → AST Source Maps: "Only the lexical preprocessor generates source maps". False: `generateASTSourceMap` (`pipeline.ts:630`) and core's printer map exist. Its comment says "via MagicString" but no MagicString is used.
- §11 Typechecking Model: doesn't say that `build`/`check` check the pre-expansion Program plus suppression while the editor checks expanded code, or that `--strict` transforms type-less copies.
- §3 MacroContext omits `safeRef`, `ensureImport`, `tryShortName`, `diagnostic`, `markPure`, `isTypeReliable`/`assertTypeReliable`, `hygiene` and `expansionCache`. docs/reference/macro-context.md omits the same set.
- §2 Macro Resolution: "Name-based (legacy)" mode is presented as a supported mode.

**PHILOSOPHY.md:**

- Resolution modes `automatic` / `import-scoped` / `explicit`: `FileResolutionScope.mode` is never read (core 1.0 gaps).
- "Prelude: Eq/Ord/Show/Clone always in scope": `prelude.ts` is dead, and PEP-052 removed default activation.
- Safety Guarantee 1 ("type-checked by tsc after expansion") is false by default.
- Guarantee 2 and Limitation 1 ("vm sandbox has no I/O", "no fs, net, process") are contradicted by `ComptimePermissions.fs`/`env` (`comptime.ts:174-282`).
- Architecture diagram and Limitation 4 present ts-patch as the primary integration.
- "Type rewrites: global after registration" accurately describes the code, but it is the order-dependence bug (R3).

**docs/writing-macros, publishing-macros, extension-author, quasiquoting:**

- 15 snippets call `defineExpressionMacro("name", {...})`, which doesn't exist.
- The publishing-macros.md `package.json` example lacks the `typesugar.macros` field, so a package built from it is never discovered.
- publishing-macros.md:50-55 says depend on core; authoring-libraries.md rule 4 says peer/dev.

**CLAUDE.md:** "Resolving things a macro just generated" calls `standaloneExtensionRegistry` and `registerTypeRewrite` the "correct" shape. They are correct only within one pass and wrong across files (R3).

**Code comments:**

- `pipeline.ts:1471` `invalidateContent` says it "preserves the cached transformer factory", but it nulls it.
- `playground/src/index.ts:76` claims HKT preprocessing; core `transformCode` does none.
- The `vscode/src/extension.ts:13` header advertises the "add derive" action the server dropped.
- `core/package.json` declares `"sideEffects": false` while `registry.ts` writes `globalThis` at load.

---

## 6. Summary

1. PEP-056 unified the dispatcher but not the pipeline. 12 paths from `.ts` to output re-implement preprocessing (5×), diagnostic conversion (5×), source maps (3×) and output typechecking (5×). Build, watch and ts-patch have drifted from the bundler and editor path. The real fix for P0 #8 is one Engine with preprocessing in the host and thin adapters (R2), not parity patches.
2. Hosts check different programs: the CLI checks pre-expansion code plus suppression rules, the editor checks expanded code. Adopting the expanded-Program model everywhere (R1) fixes `.d.ts`, makes `build` and the editor agree, and retires most suppression heuristics and the synthetic-position crash class.
3. Every cross-file correctness bug in the state cluster comes from one shape: mutable registries filled while _other_ files are expanded, which PHILOSOPHY documents as intended. Replace them with per-Program declaration indexes (R3) inside a Session → ProgramState → FilePass lifetime model (R4). That fixes ordering, multi-project tsserver and parallel workers together.
4. The macro-author contract is not freezable as-is: internals leak, there is no versioning, keys are bare names, re-visit semantics are unspecified, and registration is by side effect. A small v1 (R5) plus an `@internal` sweep is the 1.0 blocker. Moving the registries internally can follow in 1.1.
5. Make the tsserver plugin the single editor engine and retire the LSP and IDE manifest (R6). Delete the dead expansion cache (R8). Settle the config and manifest formats (R9). Fix the unplugin cold-build N-Program rebuild now and leave the rest of the performance work until after 1.0 (R10).
