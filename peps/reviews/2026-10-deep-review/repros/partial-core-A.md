# Partial findings: core-A (packages/core config/safety/registry/cache/weak-cache/manifest/coherence/capabilities/pipeline/prelude/profiling/index)

Repro scripts are in `/private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/review/coreA/`. All of them ran against the built `packages/*/dist` with Node 26.3.1 and cosmiconfig 9.0.0.

### 1. The macro expansion cache key is only the macro name plus the call-site text, so files and builds get each other's output
- Severity: critical
- Confidence: confirmed (repro'd)
- Location: packages/core/src/cache.ts:86-89 (`computeKey`), :78-81 (on-disk default). Consumed at packages/transformer-core/src/transformer.ts:131-147 and :1311-1361. The cache is on by default at packages/transformer/src/pipeline.ts:123 and :216-218.
- Problem: `computeKey(macroName, sourceText, argTexts)` hashes only the printed call text. Several things the expansion depends on are left out: the file path, the types the checker resolves, the contents of files the macro reads, config and env values, and the typesugar/macro package version (`CACHE_VERSION` is a hard-coded `"2"`). Every expression macro is cacheable unless it sets `cacheable: false` (`isMacroCacheable` returns `macro.cacheable !== false`). Macros that do NOT opt out include `includeJson`, `includeStr`, `includeText`, `includeBytes`, `typeInfo`, `fieldNames`, `validator`, `summon`, `summonAll`, `collectTypes`, `moduleIndex`, `cfg`, `config.when`, `requires`, `ensures`, `transformInto`, `registerExtension` and `registerExtensions`. The cache is persisted to `<cwd>/.typesugar-cache/expansions.json` and reloaded on the next build. One cache instance is shared by every file in a program, so collisions also happen inside a single build. On a cache hit `expand()` is skipped entirely, which also drops the macro's side effects and diagnostics.
- Failure scenario (all four repro'd):
  - (a) `x/a/__g.ts` declares `interface Props {title; count}` and `x/b/__g.ts` declares `interface Props {userId}`. Both contain `fieldNames<Props>()`. Run alone, b gives `["userId"]`. Run after a, b gives `["title","count"]` (`cache-y.mjs`).
  - (b) `includeJson("./data.json")` in two directories with different data.json files: b gets `{who:"A"}` (`cache-x.mjs`).
  - (c) Edit data.json from `{v:1}` to `{v:2}` and rebuild: the output is still `{ v: 1 }` until `.typesugar-cache` is deleted (`cache-json.mjs`).
  - (d) `cfg("debug","DEBUG-BUILD","PROD-BUILD")` built once with `TYPESUGAR_CFG_DEBUG=1`, then rebuilt with `=0`: the output is still `"DEBUG-BUILD"`, so a debug branch ships in the production build (`cache-cfg.mjs`).
  - (e) `registerExtension("string", shout); s.shout()`: the first build rewrites the call to `shout(s)`. On a warm cache the second build emits `s.shout()` unchanged (TypeError at runtime), because the hit skips the registration side effect (`cache-ext.mjs`).
- Suggested fix: make caching opt-in (`cacheable === true`) and mark only purely syntactic macros cacheable. Put `sourceFile.fileName` and the typesugar/macro package versions into the key. Never cache macros that read the checker, the filesystem, config/env or the module graph, or that register anything. Until that is done, default `cacheDir` to `false`.
- Fix size: M

### 2. The standalone-extension registry is process-global with no file or program scope, so `@extension` functions leak into files that never imported them
- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/core/src/registry.ts:615-653 (`standaloneExtensionRegistry` on `globalThis`, `registerStandaloneExtensionEntry`, `findStandaloneExtension`). Consumed at packages/transformer-core/src/rewriting.ts:293-301.
- Problem: `@extension` / `registerExtension` push `{methodName, forType, qualifier}` into one array on `globalThis`. Nothing in production code ever clears it; only tests do `standaloneExtensionRegistry.length = 0`. `findStandaloneExtension(method, type)` ignores which file is asking. Any later file, any later program in the same process (watch mode, LSP, vite dev server) and any later edit of the same file will rewrite `recv.method()` to the registered callee. The callee may not be in scope there, or may resolve to an unrelated local with the same name (a hygiene problem). Entries for deleted or renamed extensions are never removed, and the result depends on file processing order.
- Failure scenario: `transformCode(a.ts)` contains a non-exported `@extension function clamp(n: number, lo, hi)`. A separate `transformCode(b.ts)` with no import contains `const x: number = 5; x.clamp(0, 1)`. b's output is `clamp(x, 0, 1)`, a ReferenceError at runtime (`ext-leak.mjs`).
- Suggested fix: key entries by the declaring module or file and only rewrite when that module is imported into the current file (or it is the same file). Reset or partition the registry per `ts.Program` with `getOrCreateWeak`, as weak-cache.ts already suggests. Comment which CLAUDE.md shape it uses, since this registry is cited there as the "correct" one but has no scoping.
- Fix size: M

### 3. `cosmiconfig` is not a dependency of any published package, so config files are silently ignored in real installs (including the PEP-055 allowlist)
- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/core/src/config.ts:272-277 (`nodeRequire("cosmiconfig")`); packages/core/package.json (no cosmiconfig in dependencies or peerDependencies); packages/core/tsup.config.ts (`external: ["cosmiconfig"]`). The only declaration is in the private workspace root package.json:98.
- Problem: `@typesugar/core` resolves `cosmiconfig` from its own install location, but neither core nor transformer/typesugar/unplugin declares it. In this monorepo it only works because the root package.json hoists it. In a user's pnpm install it can never resolve. In npm/yarn it resolves only if some unrelated tool happens to hoist it. The `catch {}` at :315 turns the failure into "no config file", with no output.
- Failure scenario: I copied `@typesugar/core` dist and its declared deps into an isolated `node_modules` with a `typesugar.config.ts` next to it. `config.getConfigFilePath()` returned `undefined` and `security` was `undefined` (`iso/`). Consequences: `security.allowedMacroPackages` written by `typesugar approve-macros` is never read, so approved third-party macro packages stay blocked. `contracts.mode` and other file settings are ignored without notice.
- Suggested fix: add `cosmiconfig` (^9) to `@typesugar/core` `dependencies`, or to peerDependencies with a loud warning when it is missing. Test the published-tarball layout.
- Fix size: S

### 4. Every config-load failure is swallowed silently; `approve-macros` then overwrites the user's existing config file
- Severity: high
- Confidence: high (the swallow is repro'd; the overwrite is clear from code)
- Location: packages/core/src/config.ts:315-318 (`catch {}`) and :387-390 (`getConfigFilePath`). Consumer: packages/transformer/src/approve-macros.ts:88-92 and packages/transformer/src/config-writer.ts:57-60.
- Problem: a config file that throws, fails to transpile, cannot be written as a temp `.cjs` (see #5), or cannot be found because cosmiconfig is missing (#3) or cwd is wrong (#6) all look the same: an empty config and `getConfigFilePath() === undefined`. There is no warning, which breaks CLAUDE.md's "a caught failure must leave a visible trace" rule. `writeApprovedMacroPackages` treats `existingConfigPath === undefined` as "no config exists" and runs `fs.writeFileSync(path.join(projectRoot, "typesugar.config.ts"), fresh)` without checking `existsSync`.
- Failure scenario: `typesugar.config.ts` contains `throw new Error("boom")` (or reads an unset env var, imports a missing module, and so on). Then `config.getConfigFilePath()` is `undefined` and all settings are dropped silently (`err2/`). Running `typesugar approve-macros --yes` in that project replaces the hand-written config, comments included, with a fresh file containing only `security.allowedMacroPackages`.
- Suggested fix: in `loadConfigFromFiles`, tell "cosmiconfig not available" apart from "config file found but failed", and `console.warn` (or throw) the second with the filepath and error. Expose the failure (for example `config.getLoadError()`). In config-writer, refuse to create a file when `typesugar.config.ts` already exists at the target.
- Fix size: S

### 5. `.ts` config loading writes a temp `.cjs` next to the config and deletes it afterwards, which races between concurrent processes and fails on read-only trees
- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/core/src/config.ts:296-310 (the `.ts` search places use cosmiconfig's default `loadTsSync`, node_modules/cosmiconfig/dist/loaders.js:77-101).
- Problem: cosmiconfig's sync TS loader writes `<config>.cjs` beside the source, `require`s it, then `rmSync`s it in `finally`. Two processes starting at the same time in the same project race: one deletes the file while the other is about to require it, and the error is swallowed (#4). Read-only checkouts (Nix store, Bazel sandbox, read-only Docker mounts) always fail. A crash between write and delete leaves `typesugar.config.cjs` behind. That file comes before `.ts` in `searchPlaces`, so it then shadows later edits to the `.ts` file permanently.
- Failure scenario: 12 rounds of 3 concurrent `node` processes loading `ts1/typesugar.config.ts` gave 27 OK and 9 MISS. A quarter of the processes saw no `allowedMacroPackages`. Real-world triggers are parallel jest/vitest workers, tsserver plus a build starting together, or `turbo` tasks sharing a cwd. The result is flaky "macro package not approved" errors or non-deterministic `contracts.mode` output.
- Suggested fix: pass a custom `loaders: { ".ts": ... }` that transpiles with `ts.transpileModule` and evaluates in memory (`module._compile` on a `Module` instance), or writes to a unique `os.tmpdir()` path.
- Fix size: S

### 6. The config is a process-wide singleton, searched once in `process.cwd()` only (no parent lookup), never reloaded, and not per project
- Severity: medium
- Confidence: high (parent-dir miss is repro'd; IDE cwd behavior is not verified)
- Location: packages/core/src/config.ts:99-101, :285-310 (`cosmiconfigSync(...).search()` with no `searchFrom`/`stopDir`, and cosmiconfig 9 defaults `searchStrategy: 'none'`), :328-347 (`configLoaded` latch). Consumers: approve-macros.ts:89-90 (`projectRoot = dirname(--project)` versus lookup in cwd).
- Problem: (1) Running from a subdirectory finds nothing (`ts1/sub` gives `undefined`), because the default strategy only looks in the start directory. (2) The first `config.get()` decides the config for the whole process: one tsserver or vite process serving several projects (monorepo, multi-root workspace) applies one project's config to all of them. (3) Nothing outside tests calls `config.reset()`, so editing `typesugar.config.ts` (including via `approve-macros` in another terminal) has no effect in the LSP, `tsc --watch` or the vite dev server until restart. (4) `approve-macros -p packages/app/tsconfig.json`, run from the repo root, reads config from the root and writes or creates it under `packages/app`. The created file is then only found when the build runs with cwd `packages/app`.
- Suggested fix: add `config.load({ searchFrom: projectRoot })`, keyed per root (Map<root, config>) or keyed off the `ts.Program`'s tsconfig directory. Use `searchStrategy: "project"`. Have the transformer, LSP and approve-macros pass the tsconfig directory. Invalidate on config-file mtime in watch/LSP hosts.
- Fix size: M

### 7. A `typesugar.config.js` written as ESM in a `"type": "module"` project yields the module namespace as the config, so every setting is dropped
- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/core/src/config.ts:302, :305 (`.js` in sync searchPlaces), :311-313 (no `.default` unwrap).
- Problem: cosmiconfig's `loadJsSync` uses `require()`. On Node ≥20.19/22.12 `require(esm)` returns the namespace object `{ __esModule, default }`, which is used as the config unchanged. On older Node it throws `ERR_REQUIRE_ESM` and is swallowed (#4). Either way an ESM `.js` config, the natural choice in a `type: module` project, does nothing.
- Failure scenario: `js1/` contains `package.json {"type":"module"}` and `typesugar.config.js: export default { security: { allowedMacroPackages: ["foo-macros"] } }`. `getConfigFilePath()` points at the file, `getAll()` keys are `[debug, contracts, features, __esModule, default]`, and `security` is `undefined` (ESM and CJS dist alike).
- Suggested fix: after `search()`, unwrap `result.config.default` when `__esModule` or `Symbol.toStringTag === "Module"` is present, or use the async explorer.
- Fix size: S

### 8. A package's own `package.json` `"typesugar"` field (the PEP-055 macros manifest) shadows its `typesugar.config.ts`
- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/core/src/config.ts:296-297 (`"package.json"` is the first search place, with key `typesugar`).
- Problem: the `typesugar` key in package.json is used both for a library's macro manifest (`{"typesugar": {"macros": "./dist/macros.js"}}`, read by macro-loader.ts:207) and for project config. cosmiconfig stops at the first hit, so any package that declares macros (a macro library, or a monorepo package that ships local macros and also consumes third-party ones) never reads its `typesugar.config.ts`.
- Failure scenario: `pj/` has `package.json {"name":"my-macro-lib","typesugar":{"macros":"./dist/macros.js"}}` and a `typesugar.config.ts` with `allowedMacroPackages`. `getConfigFilePath()` returns `.../package.json`, `security` is `undefined`, and `config.get("macros")` is `"./dist/macros.js"`. `approve-macros` then returns `manual` because it can't patch package.json.
- Suggested fix: use a distinct package.json key for project config (for example `typesugarConfig`) or drop `package.json` from searchPlaces. At minimum, prefer `typesugar.config.*` over package.json.
- Fix size: S

### 9. Typeclass coherence is documented as enforced, but nothing checks it; duplicate instances compile silently
- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/core/src/coherence.ts (whole file; `globalCoherenceChecker` has no callers outside index.ts:130-138). Diagnostics TS9050/TS9051 (diagnostics.ts:424) and TS9006 are defined but never emitted. Docs: docs/guides/typeclasses.md:593-612 ("Defining multiple instances for the same type is a compile error", comparison table "Coherence: Enforced").
- Problem: `CoherenceChecker` is never instantiated or called by the instance macros. Its logic also has dead branches: :159 can never fire because nothing has priority < `explicit` (1), and :174-181 is redundant. Two `@instance const S1/S2: Showy<number>` in one file transform with `diagnostics: []` (`coh.mjs`), and which instance wins at resolution is unspecified.
- Suggested fix: wire `registerInstance` into `@instance`/`@derive` registration, reset per program, and emit TS9050. Otherwise remove the docs claim for 1.0 and mark coherence.ts experimental.
- Fix size: M

### 10. The capability system is not wired anywhere, yet the security docs say it partially mitigates file access
- Severity: medium
- Confidence: high
- Location: packages/core/src/capabilities.ts:36-129; docs/SECURITY-REVIEW.md:220-231; docs/architecture.md:650-665.
- Problem: `createRestrictedContext` and `resolveCapabilities` have no callers. `MacroDefinitionBase` (types.ts) has no `capabilities` field, so the JSDoc example `defineExpressionMacro({ capabilities: {...} })` doesn't even type-check. The proxy does not handle `needsFileSystem` at all. SECURITY-REVIEW F4 says "`DEFAULT_CAPABILITIES` now defaults `needsFileSystem: false` ... so file access is opt-in", which is false: nothing reads that flag. The advisory label in SECURITY.md understates it, because the feature is absent rather than advisory.
- Failure scenario: a third-party macro package approved by a user who read SECURITY-REVIEW F4 can read any file via `fs` regardless of declared capabilities. The documented mitigation does not exist.
- Suggested fix: correct SECURITY-REVIEW F4 and architecture.md to say capabilities are not enforced (and not attached to macro definitions), and mark capabilities.ts `@experimental`. Alternatively, add `capabilities` to `MacroDefinitionBase` and wrap `ctx` in `createRestrictedContext` in transformer-core's expand calls.
- Fix size: S (docs) / M (wire it)

### 11. Name-keyed global macro maps make same-name macros from different packages mutually exclusive, and the loader hides the resulting throw
- Severity: medium
- Confidence: high (code path; no current in-repo collision)
- Location: packages/core/src/registry.ts:292-396 (maps keyed by `macro.name` / exportName / label), :270-290 (`isSameMacro`); packages/transformer/src/macro-loader.ts:368-401 (`catch { return false }`).
- Problem: although macros carry `module` and a `module::exportName` index exists, `register()` first checks the name-only map. A second package exporting an expression macro with a common name (`sql`, `match`, `assert`, `when`) throws "already registered". `tryLoadModule` catches every error as "module not resolvable" and returns false silently. `loadedPackages.add(pkg)` already ran, and with the `__typesugar_macros__` convention any macros before the colliding one stay registered. In the other direction, `isSameMacro` treats any two `@typesugar/*` macros with the same kind and name as identical and silently drops the second, without indexing its `module::exportName`. A labeled-block macro whose first label already exists returns early (:368) and skips the remaining labels, the module index and the `syntaxModule` registration. exportName aliases (:305-307) overwrite another macro registered under that name without any check.
- Failure scenario: an approved `acme-sql` package registers expression macro `sql`, and `@typesugar/sql` is also installed. Whichever loads second fails to load with no message (unless verbose), and calls into it are left unexpanded.
- Suggested fix: key the primary maps by `module::exportName` (keep the name maps only for module-less legacy macros). Make the loader report register errors separately from resolution failures. Check for conflicts before mutating anything in `register()`.
- Fix size: M

### 12. `config.evaluate` / `config.when` silently evaluates unparseable conditions as false
- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/core/src/config.ts:409-448.
- Problem: anything not matching `path == 'str'`, `path != 'str'` or a bare path falls through to `!!get(<whole expression>)`, which is false. There is no diagnostic. Also, `||` and `&&` are split before quoted strings are considered.
- Failure scenario: `contracts.mode === "full"` gives false, as do `debug == true` and `level == 2`, all with TYPESUGAR_DEBUG=1 and LEVEL=2. Meanwhile `nonexistent == 'undefined'` gives true. A `config.when("contracts.mode === 'full'", A, B)` silently always emits B.
- Suggested fix: have the bare-path branch accept only `/^[\w.]+$/`. Throw on anything else, so config-when.ts reports it through `ctx.reportError`. Accept `===`/`!==` and unquoted literals.
- Fix size: S

### 13. Env-var mapping turns `_` and `__` both into `.`, so camelCase keys are unreachable and the "double underscore" contract is false
- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/core/src/config.ts:107-146.
- Problem: `.toLowerCase().replace(/__/g,".").replace(/_/g,".")`: every underscore becomes a separator and case is lost. `TYPESUGAR_CONTRACTS_PROVEATCOMPILETIME=1` produces `contracts.proveatcompiletime` (ignored), and `..._PROVE_AT_COMPILE_TIME` produces `contracts.prove.at.compile.time`. Every unrelated `TYPESUGAR_*` var (`TYPESUGAR_PROFILE`, `TYPESUGAR_NO_COLOR`, ...) is merged into config. Results also depend on environment order: with `TYPESUGAR_CONTRACTS=0` and `TYPESUGAR_CONTRACTS_MODE=none` set, the earlier keys are wiped. `"0"` becomes `false`, not `0`.
- Failure scenario: a user sets `TYPESUGAR_CONTRACTS_PROVE_AT_COMPILE_TIME=1` (the name documented in contracts/src/config.ts) and expects `config.get("contracts.proveAtCompileTime")` to be true. It stays false. contracts reads `process.env` directly, which masks this for that one key.
- Suggested fix: use only `__` as the nesting separator, map single-`_` segments to camelCase, and allowlist known top-level keys.
- Fix size: S

### 14. Config file loading silently does nothing on Node 20.0-20.15, although `engines` allows `>=20`
- Severity: low
- Confidence: high
- Location: packages/core/src/config.ts:261-270 (`process.getBuiltinModule`, added in v20.16.0/v22.3.0); packages/core/package.json `"engines": {"node": ">=20"}`.
- Problem: on an older Node 20, `getNodeRequire()` returns undefined and the code falls back to "no config" with no warning.
- Suggested fix: bump engines to `>=20.16`, or warn once when `getBuiltinModule` is missing under a real Node (`process.versions.node` present).
- Fix size: S

### 15. `debugOnly` / `invariant` JSDoc promise production stripping that doesn't exist
- Severity: low
- Confidence: high
- Location: packages/core/src/safety.ts:8-10, :30, :46, :70-76, :164-186.
- Problem: `debugOnly` "Completely erased in production" always expands to `fn()` (the comment at :183 says "For now, we always inline"), and the runtime function always calls `fn`. `invariant` is "Stripped in production builds", but nothing reads any production flag (for example `contracts.mode`). Users who put expensive validation in `debugOnly` ship it.
- Suggested fix: honor a config flag (for example `config.get("debug")` or a `safety.strip` key) in the macros to emit `void 0`, or fix the JSDoc.
- Fix size: S

### 16. `MacroExpansionCache` never evicts and writes non-atomically
- Severity: low
- Confidence: high
- Location: packages/core/src/cache.ts:116-124, :160-179.
- Problem: there is no age or size eviction. Every edit to a cached call site adds an entry forever, and the whole JSON is loaded into memory and pretty-printed on every save. `writeFileSync` without temp-file-plus-rename means concurrent builds can tear the file. That is only silently recovered as an empty cache, and the write failure is swallowed (:176).
- Suggested fix: write to a temp file and rename. Drop entries not hit during the current run, or cap the size with LRU on `timestamp`.
- Fix size: S

## Cross-scope notes (outside my files; for the transformer reviewer)
- packages/transformer/src/pipeline.ts:1040-1044, :1774-1777: `TransformationPipeline` (used by `transformCode`, probably unplugin/LSP) never passes `options.cacheDir` into `macroTransformerFactory`. So `cacheDir: false` still creates `<cwd>/.typesugar-cache` with the expansion cache, and the #1 collisions happen anyway (repro'd: `cache-y.mjs` with `cacheDir: false` still collided and created the directory).
- packages/transformer/src/macro-loader.ts:37-38, :108-122: package.json resolution for manifest discovery uses the transformer's own `createRequire`, not the project root. A macro package that exists only in the project's `node_modules` was not discovered by `approve-macros` (my scratch repro: "No new macro packages need approval"). Under pnpm's strict layout this likely hides every third-party macro package. Medium confidence; I only tried it with a scratch project outside the repo.

## 1.0 gaps
- `resolution.mode` / `resolution.fileOverrides` (config.ts:48-62, :511-538) are documented (docs/guides/opt-out.md:190-210 shows them as tsconfig plugin options; docs/errors/TS9702.md says "switch to automatic mode"), but `FileResolutionScope.mode` is computed and never read anywhere, and the plugin options are not fed into `config`. The glob matcher also anchors against absolute paths (`*` crosses `/`, Windows `\` is unhandled).
- `config.isInPrelude` / `config.isTracingEnabled` are exported but unused.
- prelude.ts as a whole is dead (no callers) and contradicts PEP-052: `getPreludeTypeclasses()` returns 11 default typeclasses when unconfigured, while `config.isInPrelude` says nothing is in the prelude by default. `OPERATOR_TO_TYPECLASS` maps `/` to Integral (last write wins). `generatePreludeDeclaration()` emits only comments. Remove it or mark it internal/experimental.
- manifest.ts (`typesugar.manifest.json` discovery, `getManifestRegistry`) is exported but has no callers, and it overlaps or conflicts with PEP-055's `typesugar.macros` package.json field. Remove it or mark it experimental.
- coherence.ts and capabilities.ts are unwired public APIs (see #9 and #10). They need an `@experimental` marking or removal before 1.0.
- pipeline.ts `MacroPipeline` has no users. It wraps expression macros with a synthetic `CallExpression` that has no `typeArguments`, so any wrapped macro that reads type args or calls the checker on the call or args will throw or misbehave (CLAUDE.md synthetic-node rule). `build()` registers globally by default. Mark it experimental.
- core index.ts exports mutable internals with no stability marking (`standaloneExtensionRegistry` array, `globalCoherenceChecker`, `globalHygiene`, `MacroExpansionCache`, `profiler`). Decide which are public API and tag the rest `@internal`.
- There are no user docs listing the supported config filenames. `.mjs`, `.mts`, `.cts` and the `.config/` directory forms are unsupported (cosmiconfig's sync defaults include `.config/*`), nothing says cosmiconfig must be installed (#3), and nothing says config is read from cwd only (#6).
- Config-file loading tests (tests/config.test.ts:506-540) cover only the `.ts` happy path. There is nothing for ESM `.js`, a throwing config, parent-dir or cwd mismatch, or the published-package layout. Each of these hid a bug above.
