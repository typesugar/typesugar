# Architecture review: SURFACE (packages, public API, runtime/compile-time split, tiers, versioning, config)

Scope: the 34 packages under `packages/` (32 published, plus `playground` and `vscode`, which are private). Everything was read-only. The heaviest job was one TypeScript program over all the built `.d.ts` files, at 456 MB RSS. My scratch scripts and outputs are in `/private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/docrev/arch-surface/`:

- `closure2.mjs`: transitive import closure of each export's runtime entry, using es-module-lexer over `dist`.
- `exports.cjs` / `exports.json`: every export of every entry, via the type checker.
- `dups.txt`: names defined in more than one package.
- `tsdl/`: the npm tarballs of typescript 5.0.4, 6.0.3 and 7.0.2. These were only read, never executed.

How I checked things:

- **Verified**: confirmed with a tool in this session. That includes loading built `dist` entries in Node 26 and running `npm view` / `npm pack` against the live registry.
- **Inferred**: read from the code but not run.

## 1. Current architecture

### Package graph

Built from every `package.json` plus the real imports in each `dist`. An arrow means a runtime import. (!) means that root entry loads `typescript` at runtime; I verified this by importing it in Node and finding `typescript` in `require.cache`.

```
COMPILE-TIME CORE (imports typescript; peer typescript ">=5.0.0 <6.0.0")
  core ............ [cosmiconfig, magic-string]   289 exports incl. engine globals
  macros ──► core   root = 293 exports: built-ins + engine + author helpers + stubs;  ./runtime is TS-free (15 KB)
  lsp-common ──► core
  transformer-core ──► core, macros
  transformer ──► core, macros, transformer-core, lsp-common  [+esbuild, xxhash-wasm, @ampproject/remapping]
     ⇢ dynamic: loads @typesugar/std for ANY @typesugar/* import (macro-loader.ts:271-275; std is not a declared dep)
     ⇢ emits into user code: import type { Kind } from "@typesugar/type-system" (hkt-rewriter.ts:299)
HOSTS
  unplugin-typesugar ──► transformer, core        ts-plugin (41 LoC) ──► transformer/language-service
  eslint-plugin ──► transformer{,/pipeline,/position-mapper}
  lsp-server ──► transformer/pipeline, macros, core, lsp-common   (bundles its own TS)
  vscode (private) ──► lsp-server, ts-plugin       playground (private) ──► transformer-core + 16 libs
UMBRELLA
  typesugar "." ──► @typesugar/macros/runtime only (TS-free, verified)
            ./core = export * from @typesugar/core;  ./transformer, ./vite|webpack|esbuild|rollup ──► toolchain
            declares derive, reflect, typeclass as deps; src imports none of them
FACADES (re-export from the macros ROOT, so they load TS: verified statically)
  derive, reflect, typeclass ──► macros
RUNTIME LIBRARIES ("." entry)
  std (!) ──► macros [registerInstanceWithMeta], macros/runtime
  type-system (!) ──► core [createGenericRegistry]        sql (!) ──► core [createGenericRegistry]
  graph (!) ──► std, collections                          math (!) ──► std, units
  contracts-refined (!, static) ──► contracts, type-system
  fp ──► contracts (re-exports law API at its root)        validate ──► fp
  effect ──► @typesugar/testing (runtime!), effect(peer)   effect/macros ──► graph, std, core
  TS-free roots (verified or static): typesugar, fp, validate, contracts, effect, collections, codec,
  fusion, mapper, parser, strings, units, erased, testing, macros/runtime
```

- **Cycles:** none at package level, in either the declared or the imported graph.
- **Hidden upward edges** (lower layers that know about higher ones):
  - The transformer loads std and emits a reference to type-system.
  - core's import-suggestion table hard-codes std and fp exports (`core/src/import-suggestions.ts:82-390`).
  - macros emits an import of itself into user code (`typeclass.ts:3201`).
- **Declared but not imported by src:**
  - `typesugar` → derive, reflect, typeclass
  - `std` → typeclass, type-system
  - `math` → core, macros

### How a macro placeholder works at runtime

1. The user writes `import { summon } from "typesugar"`. The type checker sees the stub's signature from `macros/runtime` (`runtime-stubs.ts`).
2. The transformer resolves the import alias to its declaration. It maps the declaring file's path to a package (`resolveModuleSpecifier`, `transformer-core/src/import-resolution.ts:264-290`), then checks it against `macro.module` (`moduleMatchesMacro`, :327-356).
3. The matching rule has a family wildcard: a macro whose module is `"typesugar"` matches an import from any `@typesugar/*` package, and the reverse. Legacy aliases `typemacro`, `ttfx` and `macrots` are still accepted. So `import { pipe } from "@typesugar/fp"` (fp's own runtime `pipe`) activates the `pipe` macro (`operators.ts:90-91`).
4. Macro definitions are loaded from the library's `package.json` `"typesugar": {"macros": "./macros"}` field. 18 packages are consistent on this. There is also a trust allowlist (PEP-055).

### State ownership visible to users

- `globalRegistry` and the standalone-extension array are pinned to `globalThis`, so ESM and CJS copies share them.
- Every other registry is a module-level singleton: cfg config (`macros/src/cfg.ts:48-67`), the config store (`config.load`), hygiene, the type-rewrite registry, and so on.
- Emitted code also creates runtime globals keyed by bare name:
  - `globalThis.__typesugar_companions[Name]` (`typeclass.ts:1544-1554`)
  - `globalThis.__typesugar_registerExtension?.(...)`, appended to every compiled `"use extension"` module (`extension-registration.ts:8,78`)

### Config surfaces: four of them, read by different hosts

| Surface                                                                                   | Read by                                                                | Keys                                                                                                                                                       |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typesugar.config.*`, `.typesugarrc*`, package.json `"typesugar"`, plus `TYPESUGAR_*` env | every host, via `config.load` in `createPipeline` (`pipeline.ts:2340`) | `TypesugarConfig` (`core/src/config.ts:92-105`), which has an open `[key: string]: unknown`                                                                |
| tsconfig plugin entry                                                                     | **ts-patch only**                                                      | `MacroTransformerConfig`: `verbose`, `macroModules`, `cfgConfig`, `trackExpansions`, `cacheDir` (`pipeline.ts:62-92`). unplugin, CLI and LS never read it. |
| unplugin options                                                                          | unplugin                                                               | `tsconfig`, `include`, `exclude`, `verbose`, `diskCache`, `strict` (`unplugin.ts:14-25`)                                                                   |
| `TYPESUGAR_CFG_*` env                                                                     | `cfg()` / `@cfgAttr`                                                   | a separate store from `config.when`                                                                                                                        |

## 2. Assessment: what is sound and should be frozen

- **The PEP-050 Case-1 / Case-2 model.** A runtime `.` entry, a build-time `./macros` entry, and the `"typesugar.macros"` manifest field with a trust allowlist (PEP-055). This is the right library contract and is applied consistently.
- **Activation by the declaring package, not by the name** (`resolveSymbolToMacro`). This is the principle to keep, once the family wildcard is tightened (R4).
- **The umbrella root and `@typesugar/macros/runtime` are TS-free** (verified: 17 KB / 15 KB closures). fp, validate, contracts, effect, codec, fusion, mapper, parser, strings, units, erased, testing and collections roots are TS-free too.
- **Dual ESM/CJS output** is now correct. Every export has `require.types` pointing at an existing `.d.cts` (verified). The only exception is eslint-plugin, which is ESM-only on purpose (ESLint ≥ 9).
- **The source-to-source engine** (`TransformationPipeline` + `VirtualCompilerHost`), shared by unplugin, CLI, LS, ESLint and LSP. This is the shape that survives TypeScript 7 (see R1). Keep it as the primary contract.
- **Every `ts.*` top-level API name used in `packages/*/src` (497 names) exists in the 5.0.4 and 6.0.3 `.d.ts` files** (static check). The 5.0 floor and TS 6 look plausible at the name level. Behaviour is not verified.

## 3. Recommendations (most important first)

### R1. TypeScript 7 has shipped as `typescript@latest`; decide the compiler strategy and fix the peer range (BLOCKS 1.0)

**Problem (verified on the registry):**

- `npm view typescript dist-tags` gives `latest: 7.0.2`, published 2026-07-08. The last JS-API releases were 6.0.2 (2026-03-23) and 6.0.3 (2026-04-16).
- In the 7.0.2 tarball, `"."` is `./lib/version.cjs`, which exports only `version` and `versionMajorMinor`. Everything else is under `./unstable/*`: an IPC `API` with `Program`/`Checker` queries, a JS AST factory and visitor, and `Emitter.printNode`. It has no transformer or emit hook, no `createProgram` and no plugin surface.
- All 32 published packages, including pure runtime ones like collections and fp, peer `typescript ">=5.0.0 <6.0.0"`.

**Consequences:**

- A new project that runs `npm i -D typescript` gets 7.0.2. Installing typesugar then hits a peer conflict (inferred: npm's ERESOLVE rules, not run).
- TS 6.0.x is excluded even though it still has the JS API. PEP-059's reason ("TS 7 has no JS API") conflates 6 and 7.
- There is no TS-major guard. Under TS 7, `import * as ts from "typescript"` returns only the version object, so the first `ts.factory` access throws an opaque error (inferred).
- The 1.0 macro-author contract hands out Strada objects directly: `MacroContext.program`, `typeChecker`, `factory`, `transformContext` (`core/src/types.ts:26-40`).
- PHILOSOPHY's diagnostic-suppression rules only run inside a TypeScript host that typesugar controls. Under tsgo, a user's own `tsc` will report `money + money` and similar sugar as errors.

**Proposed:**

- (a) Before 1.0:
  - Widen compiler packages to `>=5.0.0 <7` once a CI job passes on 5.0, 5.9 and 6.0.3.
  - Drop the `typescript` peer from runtime-only packages, or make it optional.
  - Add a startup guard that rejects TS ≥ 7 with an actionable message.
  - Fix the templates, which peer `>=5.0.0` (`transformer/templates/*/package.json`).
- (b) Record the post-1.0 direction now: **typesugar owns its compiler.**
  - The pipeline hosts (unplugin, CLI, LSP) depend on a pinned JS TypeScript 6.x as a regular dependency. They expand source-to-source and hand the expanded TS to whatever compiler the user runs (tsc 5/6 or tsgo 7).
  - `typesugar check` becomes the type-check story under TS 7, since suppression rules can't run in tsgo.
  - ts-patch and the tsserver plugin become TS ≤ 6 legacy hosts.
  - The LSP server, which already bundles its own TS, becomes the forward editor engine.
- (c) Name the portable, typesugar-owned part of `MacroContext` as the stable author tier: `getTypeOf`, `getTypeString`, `isAssignableTo`, `getPropertiesOfType`, `getSymbol`, `reportError`, `diagnostic`, `ensureImport`, `hygiene`. Document the raw `ts.*` handles as bound to the engine's own TS version. That stays safe once (b) holds, because macro authors then code against typesugar's TS, not the user's.

**Alternatives rejected:**

- Port to the TS 7 IPC API now. It is XL, explicitly unstable, has no transform hook, and costs an IPC round-trip per checker query in every macro.
- Freeze as-is with `<6`. 1.0 would be born incompatible with current TypeScript.
- Wrap the whole AST in typesugar-owned types. XL, and it contradicts CLAUDE.md's `ts.factory` mandate.

**Blast radius:** (a) is packaging only. (b) is invisible to ts-patch users on TS ≤ 6. (c) is docs plus tier tags.

**Size:** (a) S, (b) L (implementation post-1.0, decision pre-1.0), (c) S.

### R2. The runtime/compile-time split leaks, and the purity gate can't see it (BLOCKS 1.0 for the emitted-import part)

**Problem (verified):** these roots load `typescript`, `node:vm`/`fs` and the whole macro engine at runtime: **std**, sql, type-system, graph, math, contracts-refined, derive, reflect, typeclass. In Node, importing `@typesugar/std` costs 138 MB RSS and 161 ms; `@typesugar/fp` costs 55 MB and 13 ms. PEP-050 Wave 2 says these entries are TS-free. Root causes:

1. `std/src/typeclasses/index.ts:19,59…` calls `registerInstanceWithMeta` from the macros **root**. It is runtime code living in `macros/src/typeclass.ts:2998`.
2. `createGenericRegistry`, a runtime utility, lives in core, whose single bundle imports TS. Callers: `sql/src/infer-macro.ts:197`, `type-system/src/effects.ts:65`, `refined.ts:60`.
3. The facades re-export from the macros root instead of `macros/runtime` (`typeclass/src/index.ts:4`, derive, reflect).
4. Emitted code targets compile-time entries:
   - Derived instances get `ensureImport(deriveName, "@typesugar/macros")` (`typeclass.ts:3201`). Every `@derive(Eq)` app then imports the engine at runtime.
   - effect's root runtime-imports `@typesugar/testing` (`effect/src/testing.ts:28`, re-exported at `index.ts:251`). Its docs point to `@typesugar/effect/testing`, which is not exported.
5. `scripts/check-runtime-purity.mjs:43-50` only greps the text of `dist/index.js`. It is not transitive, so it passes.

**Proposed:**

- A TS-free runtime kernel. Either grow `@typesugar/macros/runtime` or add `@typesugar/runtime`. It holds the stubs, derive markers and primitive tables, the runtime half of `registerInstanceWithMeta`, and a TS-free `createGenericRegistry` (or a TS-free core subpath for it).
- A rule: any module named in emitted code must be a runtime-pure entry. Enforce it with a test that enumerates `ensureImport` targets.
- Replace the gate with a transitive one: load each runtime entry in Node and assert `typescript` is absent. `closure2.mjs` does this statically in about 60 lines.
- Move effect's testing helpers to `./testing`.

**Alternative rejected:** relying on `sideEffects:false` or bundler externals. That doesn't help when the bindings are used at module top level, as in std.

**Blast radius:** internal imports. Library code compiled by 1.0 would otherwise reference `@typesugar/macros` forever.

**Size:** M.

### R3. Curate the public surface and freeze it with API reports (BLOCKS 1.0; extends PEP-059 P0 #5)

**Problem (verified export counts):**

- core: 289 exports, mixing:
  - the author API;
  - engine internals (`globalHygiene`, `globalExpansionTracker`, `standaloneExtensionRegistry`, `MacroExpansionCache`, `profiler`);
  - dead features (`prelude`, `manifest`, `ResolutionTracer`, `MacroPipeline`);
  - runtime functions users call in app code (`invariant`, `unreachable`, `debugOnly`), which pull TS in without the transformer.
- macros root: 293 exports (244 values), including `setCfgConfig`, `clearDerivationCaches`, resolvers and specialization internals. The author API is split across core (`define*Macro`) and macros (`quote*`, `defineCustomDerive*`, `defineSyntaxMacro`, `defineRewrite`).
- transformer: 10 subpaths. `./cache`, `./profiling`, `./virtual-host`, `./source-map-utils` and `./dts-transform` have no consumers. With tsup `splitting:false` each subpath is a separate module instance.
- fp: a `"./*"` wildcard exposes all 54 `dist` modules, including `internal/acc`.
- `typesugar/core`: `export *` of core, which doubles the frozen surface.
- lsp-server `"."`: opens stdio on import.

**Proposed:**

- `.` = stable. An explicit `./internal` subpath holds cross-package engine APIs, documented as unstable.
- `@internal` tags plus api-extractor reports checked in CI.
- Promote one author entry, e.g. core plus a `./author` entry that re-exports the macros helpers.
- Delete the dead modules.
- Give fp an explicit subpath list. PEP-050 derives the companion import subpath from the file layout (`subpathFor`), so the layout is currently part of the emitted contract. Record each companion's public module in metadata instead (`.d.ts` tag or exports map).
- Drop `typesugar/core`.

**Alternative rejected:** freezing everything as-is. That makes every internal a semver promise.

**Blast radius:** internal consumers (eslint, lsp, playground) move to `./internal`.

**Size:** L (mechanical but wide).

### R4. One typeclass vocabulary and module-qualified identity (BLOCKS 1.0; breaking for fp)

**Problem:**

- std's `Eq` has `equals`/`notEquals` and is a `@typeclass`.
- fp's `Eq` has `eqv` and is **not** a `@typeclass`, although its docs claim `@op` (`fp/src/typeclasses/eq.ts:58`).
- fp's `Show`/`Functor`/`Monad` are `@typeclass`.
- macros exports the derive markers `Eq`/`Ord`/`Show`/… as **values**, and primitives in two sets (macros/primitives and std, PEP-059 P1 #10).
- Users meet two kinds of `Eq`. One is a symbol marker from `typesugar`, the other an interface from `@typesugar/std`. This is the README hero failure ("'Eq' only refers to a type", tooling #29).
- Identity is the bare name in three places: the registry (core #40), the runtime global `__typesugar_companions[Name]` (`typeclass.ts:1544-1554`), and the family-wildcard activation (`import-resolution.ts:337-343`). Related findings: core #2, #3, #4, #10, #18, #40.

**Proposed:**

- std owns Eq, Ord, Hash, Semigroup, Monoid, Show and the primitive instances. fp re-exports them and adds the HKT hierarchy.
- The derive marker becomes the typeclass's companion value, exported next to the interface, so `import { Eq } from "@typesugar/std"` serves both `@derive(Eq)` and `Eq<A>`. Keep `typesugar`'s markers as aliases.
- Key typeclass identity by (module, name). Drop the `typesugar` family wildcard and the legacy aliases.
- Drop `__typesugar_companions`, or key it by module.

**Alternative rejected:** documenting the two hierarchies. Bare-name keys make them collide anyway.

**Blast radius:** fp users (`eqv` → `equals`), which means zero external users today.

**Size:** L.

### R5. One config schema, one reader, closed (BLOCKS 1.0)

**Problem (verified in code):**

- `cfg()` reads `cfgConfig` (tsconfig plugin, ts-patch only: `pipeline.ts:335`) and `TYPESUGAR_CFG_*`. `config.when` reads the config file and `TYPESUGAR_*`. The two use the same grammar (`ast-utils.ts:556`) over different stores. So `cfg()` evaluates differently under Vite, tsc and the IDE.
- Documented keys that don't exist or aren't read:
  - unplugin and tsconfig `config:` key (`docs/reference/config.md:139-171`, `guides/conditional-compilation.md:40-70`): unplugin has no such option, and the transformer key is `cfgConfig`.
  - `comptimeTimeout` (`config.md:282-297`): not in the code.
  - `resolution` / `manifest` as tsconfig plugin options (`guides/opt-out.md:195-206`, `guides/library-manifest.md:205-218`): read only from the config file, or dead.
  - `configure({mode:"enabled"})` for contracts: the real API is `setContractConfig`, with modes `full|assertions|none`.
- package.json `"typesugar"` is both the library manifest and project config, told apart by shape (core #37).
- `TypesugarConfig` has an open index signature, so any new top-level key in 1.x can collide with a user's custom key. Package keys such as `contracts.decidabilityWarnings` ride on that index signature untyped.
- Nine of the deep-review config findings share this subsystem (core #19, #20, #34-37, #51-53).

**Proposed:**

- `typesugar.config.*` / `.typesugarrc` is the only project config, with a closed schema. Per-package sections are added by declaration merging.
- `cfg` conditions live in that store.
- One env prefix overrides it.
- The tsconfig plugin entry carries only `transform`/`name`. Warn on and migrate `cfgConfig`.
- unplugin options cover bundler concerns plus an optional inline override that feeds the same store.
- package.json `"typesugar"` is reserved for the library manifest.

**Blast radius:** tsconfig `cfgConfig` users (deprecation warning).

**Size:** M.

### R6. Lockstep versions and explicit tiers in the packages (BLOCKS 1.0)

**Problem:**

- Published internal deps are exact pins (verified: `npm view @typesugar/std dependencies` gives `@typesugar/core: 0.1.1` and so on).
- `.changeset/config.json` has `fixed: []`. Independent versions plus exact pins mean every core patch forces dependents to republish. Users who mix versions get duplicate core/macros copies, and only two registries survive that.
- READMEs say "Frozen … excluded from release", but these packages are published (PEP-058 retired the `ignore` mechanism). Every description starts with 🧊.

**Proposed:**

- One changesets `fixed` group for every stable and experimental package.
- Frozen packages sit outside the group and stay on 0.x.
- Put the tier in each `package.json` (e.g. a `typesugar.tier` field) and its README banner.
- Remove 🧊 from descriptions.
- Tier table below.

**Size:** S.

### R7. Make the runtime fallback contract explicit (BLOCKS 1.0 for the classification; detection can come after)

**Problem:** without the transformer, behaviour falls into four classes with no rule:

1. Throws: `summon`, `comptime`, `cfg`, `include*`, `staticAssert`, `typeInfo` (`runtime-stubs.ts:160-172`…). `implicit()`'s message names only the tsconfig form (:272-279).
2. Silent no-op: `derive`, `typeclass`, `deriving`, `registerExtension(s)` (:350-356).
3. Real implementation: `pipe`, `flow`, `compose`; contracts' `requires()` / `ensures()`.
4. Silently wrong:
   - a `let:` block runs as a JS label with `x << f()` evaluated as a bit shift;
   - a `requires:` block becomes an expression statement that never checks anything;
   - operator overloads turn into `"[object Object]"` concatenation;
   - `old(x)` is the identity.

**Proposed:**

- A per-placeholder classification table.
- A single `TypesugarTransformRequiredError` with a code and a docs URL.
- No value-returning stub may silently return a wrong value.
- Syntax-only features documented as "requires transformer", with a doctor/IDE check.

Changing a no-op into a throw after 1.0 is breaking, which is why the classification has to land first.

**Size:** S-M.

### R8. Register the emitted-code contract (BLOCKS 1.0)

**Problem:** code compiled by 1.0, including published libraries, will reference these forever:

- `globalThis.__typesugar_registerExtension?.()`. This is runtime self-registration, which only works if the library's JS is executed at compile time. It conflicts with PEP-050's ".d.ts metadata, not executed".
- `__typesugar_companions`
- `__typesugar_escapeHtml` (strings)
- `__typesugar_createStateMachineInstance` and `__typesugar_stateMachineRuntime` (graph)
- `import {Eq} from "@typesugar/macros"`
- `import type {Kind} from "@typesugar/type-system"`
- fp companion subpaths

The ensureImport / unbound-reference cluster (core #11, #15, #23, #24, #26, #27; transformer #14; std-strings #20; erased #21; tooling #9) comes from having no declared runtime contract per macro.

**Proposed:**

- One checked-in list of emitted runtime symbols and their modules, with a test.
- Choose `.d.ts` metadata for compiled-library discovery and stop emitting `__typesugar_registerExtension`.

**Size:** M.

### R9. Package boundary changes (BLOCKS 1.0 where they are removals)

- Remove or deprecate the derive, reflect and typeclass facades. PEP-048 Open Question 2 deferred this "to a publishing PEP"; this is that moment. They are 50-76 LoC, they load TS, and the umbrella already exports every stub. After 1.0, removal is a major release.
- Fold contracts-refined (507 LoC of glue) into `@typesugar/contracts/refined`.
- Move fp's law re-exports, which come from experimental contracts (`fp/src/laws/types.ts:31`), to `@typesugar/fp/laws`. Otherwise stable fp's root carries an experimental API.
- Mark lsp-common internal.
- Use one language-service plugin name. Docs use `@typesugar/transformer/language-service` 31 times and `@typesugar/ts-plugin` twice. Examples still use the broken `typesugar/language-service` (`examples/basic/tsconfig.json:15`, `examples/implicits/tsconfig.json:13`, `examples/standalone/hello-world/tsconfig.json:10`). Fold `ts-plugin` into the vscode bundle or keep it as an alias.
- Make the meaning of `syntax` consistent. It is an activation marker in std, contracts and effect, but runtime `pipe`/`flow` in `@typesugar/fp/syntax`. Rename fp's.
- Give the `typesugar` bin a single owner. Both `typesugar` and `@typesugar/transformer` declare it.

**Size:** M.

### R10. Platform floor (BLOCKS 1.0 as a decision)

- `engines` says `>=20`, but config loading needs `process.getBuiltinModule` (Node 20.16 / 22.3; core #53).
- Node 20 reached end of life on 2026-04-30 (from my knowledge, not verified this session).
- Proposal: `>=22.12`. That also brings unflagged `require(esm)`, which would allow `.mjs` configs.

**Size:** S.

### R11. Soak before freezing (process, POST-1.0-safe)

The review branch changed +45,819 / −16,362 lines across `packages/` (`git diff --numstat main...HEAD`). Ship 0.2 or 0.3 with the API reports from R3 and treat it as the 1.0 release candidate, rather than freezing from the first release after that churn.

### Tier proposal

LoC is non-test src; tests are test files; findings are approximate counts from `peps/reviews/2026-10-deep-review/`.

| Package                                                  | Tier at 1.0                                                                               | Evidence                                                                                               |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| typesugar                                                | Stable (root + bundler subpaths); drop `./core`                                           | 210 LoC; root TS-free                                                                                  |
| core                                                     | Stable author subset, plus an `./internal` subpath                                        | 12.4k LoC, 15 tests, 55 findings (with transformer-core)                                               |
| macros                                                   | `./runtime` Stable; root Internal; author helpers promoted                                | 23.3k LoC, 40 tests                                                                                    |
| transformer                                              | Stable: `.`, `./language-service`, CLI; other subpaths Internal                           | 11.6k LoC, 53 tests, 20 findings                                                                       |
| unplugin-typesugar                                       | Stable (`strict` option Experimental)                                                     | 403 LoC, 2 tests                                                                                       |
| std                                                      | Stable once R2 lands; `syntax/*` part of the activation contract                          | 13.9k LoC, 20 tests, about 17 std findings incl. 1 critical (match)                                    |
| fp                                                       | Stable for data types and typeclasses; `io/*` Experimental                                | 18.1k LoC, 9 tests, 26 findings (3 critical in IO); re-triage 2026-12-10                               |
| validate                                                 | Stable                                                                                    | 1.5k LoC, 3 tests, about 4 findings                                                                    |
| type-system                                              | HKT types (`Kind`, `_`, `TypeFunction`) Stable, since they are emitted; rest Experimental | 4.9k LoC, 2 tests, 10 findings                                                                         |
| contracts                                                | Experimental (prover explicitly)                                                          | 6.4k LoC, 6 tests, 3 critical findings                                                                 |
| contracts-refined                                        | Experimental → merge into contracts                                                       | 507 LoC, 1 test                                                                                        |
| effect                                                   | Experimental (Effect 3.x only)                                                            | 6.4k LoC, 12 tests, about 10 findings                                                                  |
| sql                                                      | Experimental                                                                              | 5.3k LoC, 4 tests, 18 findings; `@schema` is a no-op                                                   |
| testing                                                  | Experimental                                                                              | 2.6k LoC, 2 tests, no test script                                                                      |
| mapper, graph, fusion                                    | Experimental                                                                              | keep-conditions / draft PEPs; 4-7 tests each                                                           |
| eslint-plugin                                            | Experimental                                                                              | autofix corruption fixed just now; 5 tests                                                             |
| lsp-server                                               | Experimental, strategic (reverses the PEP-048 freeze because of TS 7)                     | 2.6k LoC, 3 tests                                                                                      |
| ts-plugin                                                | Stable for TS ≤ 6, or fold away                                                           | 41 LoC                                                                                                 |
| lsp-common, transformer-core                             | Internal                                                                                  | no user docs                                                                                           |
| derive, reflect, typeclass                               | Drop / deprecated aliases                                                                 | 55-76 LoC facades; load TS                                                                             |
| collections, math, units, parser, codec, erased, strings | Frozen: published on 0.x, outside the `fixed` group                                       | README banners; graph→collections and math→units are allowed (experimental/frozen depending on frozen) |
| playground, vscode                                       | Private                                                                                   | (unchanged)                                                                                            |

## 4. Decisions for Dean

1. **TS 7 strategy (R1).** Should typesugar own a pinned JS TypeScript and expand source-to-source, or follow the user's TS?
   - _Recommended:_ own it. Widen to `<7` now, add a TS 7 guard, and move to `typesugar check` and the LSP for TS 7 users after 1.0.
2. **What the umbrella is.**
   - (a) A slimmed one-install package: TS-free root, bundler subpaths, CLI; the facade deps and `./core` dropped; esbuild made optional or lazily loaded.
   - (b) A split into a runtime dependency (`@typesugar/runtime`) and a toolchain devDependency.
   - _Recommended:_ (a). It keeps onboarding to one name. Its cost is that the toolchain gets installed in production for Node apps.
3. **Typeclass vocabulary (R4).** _Recommended:_ std is canonical and fp breaks now, while there are zero users.
4. **Tiers and the frozen mechanism (R6).** _Recommended:_ frozen = published 0.x outside the `fixed` group. Remove the facades before 1.0.
5. **Lockstep versioning at 1.0.** _Recommended:_ yes. A `fixed` group covers all stable and experimental packages. PEP-058 deferred this to 1.0.
6. **Editor engine (PEP-059 decision 2).** TS 7 changes the answer. _Recommended:_ the LSP server is the long-term engine, and ts-plugin is maintained for TS ≤ 6. This reverses PEP-048's freeze of lsp-server.
7. **Node floor.** _Recommended:_ `>=22.12`.
8. **package.json `"typesugar"` field.** _Recommended:_ library manifest only, with no project config.
9. **Release candidate before 1.0 (R11).** _Recommended:_ yes.

Places where I disagree with recorded decisions:

- PEP-059's `<6.0.0` cap and its stated reason (R1).
- PEP-048 deferring the facade collapse and freezing lsp-server.
- PEP-050 deriving companion subpaths from file layout (R3).
- PEP-050 Wave 2's claim that std, type-system, sql and graph are TS-free (R2).

## 5. Doc/code mismatches

1. `docs/architecture.md` has gone stale in four places:
   - §3 (lines 207-241) describes a legacy `src/core/` and a 6-file core. There is no root `src/`, and core has about 30 files.
   - §2 names `src/transforms/macro-transformer.ts`, which doesn't exist. `MacroTransformer` lives in `transformer-core/src/transformer.ts`.
   - §4-7 use `src/macros/*` paths instead of `packages/macros/src/*`.
   - §9 documents a unplugin `load` hook that runs the preprocessor; there are only `buildStart` and `transform`. Its "Known Limitation" links `docs/PLAN-implicit-operators.md`, which is now under `docs/plans/` and is about `.sts`.
2. `docs/architecture.md` has nothing on the runtime/compile-time split, `macros/runtime`, PEP-055 discovery, config loading, or emitted runtime globals.
3. PHILOSOPHY.md "Architecture":
   - It shows a ts-patch/tsc-first pipeline, while the source-to-source pipeline is primary.
   - "All macro expansions are type-checked by tsc after expansion" is not true for unplugin, nor without strict mode.
   - "vm sandbox has no I/O" is not true: comptime has fs/env permissions and `include*` reads files.
4. PEP-050 Wave 2 says the std, type-system, sql and graph runtime entries are typescript-free. They are not, at runtime (verified).
5. PEP-059: "capped at `<6.0.0` (TS 7 has no JS API)". TS 6.0.3 has the JS API, and 7.0.2 is `latest`.
6. Package READMEs say "excluded from release"; the packages are published.
7. `peps/README.md` lists PEP-002 (oxc engine) as "Complete", but `Cargo.toml` says it was removed in PEP-018, which is not in the index.
8. `docs/reference/config.md` and the guides document things that don't exist or no longer apply:
   - the `config:` key for unplugin and tsconfig;
   - `comptimeTimeout`;
   - legacy `.eslintrc` config (the plugin is ESLint ≥ 9 only now);
   - contracts `configure({mode:"enabled"|"disabled"|"assume"})`;
   - `resolution` and `manifest` as tsconfig plugin options (opt-out.md, library-manifest.md).
9. Examples use the nonexistent `typesugar/language-service` plugin name (three tsconfigs, listed in R9). `docs/guides/library-manifest.md` documents `core/manifest.ts`, which nothing calls.
10. The root README says fp provides `Result`, and lists `@typesugar/vscode`, whose package is actually the private `typesugar-vscode`. `effect/src/testing.ts:9` documents `@typesugar/effect/testing`, which is not exported.

## 6. Five-line summary

- `typescript@latest` is 7.0.2: its root has no compiler API and nothing can hook into its emit. typesugar's peer range excludes 7 and also 6.0.x, which still has the JS API. That makes the compiler strategy, and how much of raw `ts.*` the macro contract freezes, the main 1.0 decision.
- The PEP-050 split is the right model but leaks: std, sql, type-system, graph, math and the three facades load `typescript` at runtime (verified). Derived code imports `@typesugar/macros`, and the purity gate can't see either because it isn't transitive.
- The public surface is too large to freeze as-is: core 289 and macros 293 exports, 10 transformer subpaths, fp's `./*` wildcard, and two typeclass hierarchies with the same names.
- Config is four uncoordinated surfaces. Documented options (`config:`, `comptimeTimeout`, tsconfig `resolution`) don't exist, and `cfg()` evaluates differently per host. One closed schema with one reader is needed before 1.0.
- Release changes are cheap: lockstep `fixed` versioning (internal deps are already exact pins), explicit tiers (frozen = 0.x outside the group), dropping the facades, Node ≥ 22.12, and a release candidate soak after the 45k-line review branch.
