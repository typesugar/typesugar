# Findings: transformer / unplugin / ts-plugin / umbrella

(Transcribed from reviewer report. Repros in review/: stale.mjs, strip.mjs, xfile.mjs, tspatch.mjs, emitdiag.mjs, diagpos.mjs, comp.mjs; fixture projects p1, p2, p3.)

1. CRITICAL confirmed — pipeline.ts:325-330 pushes via context.addDiagnostic; TS discards diagnostics from `before` script transformers, so emitResult.diagnostics never has macro errors; cli.ts:400-404 `check` sets noEmit so transformer never runs; 636-641 emit; 702 exit code. `comptime(() => { throw })`: expand shows TS9209 but check/build print nothing, exit 0. Fix: side-channel collector on state, merged into build/watch; check runs ts.transform like --strict block (cli.ts:527-560); ts-patch extras.addDiagnostic; test CLI exits non-zero on macro error.
2. CRITICAL confirmed — pipeline.ts:183-210 default export macroTransformerFactory(program, config?, state?); ts-patch calls factory(program, cfg, {ts, addDiagnostic,...}) (node_modules/ts-patch/resources/module-patch.js:157-166) -> `state.hasLoadedMacroPackages is not a function` on every patched tsc. init.ts:262/298 writes this config. Fix: default export ts-patch-shaped wrapper or instanceof TransformerState check; wire extras.addDiagnostic; test default export with ts-patch signature.
3. CRITICAL confirmed — expansion cache keyed by macro name+call text (pipeline.ts:121-124,216-219 default on, .typesugar-cache in cwd; 88-92,1398 persisted; transformer-core/src/transformer.ts:132-146,1311-1316; core/src/cache.ts:86-89). Only typeclass/adt/opaque/comptime/static-assert set cacheable:false. fieldNames<User>() in a.ts and b.ts with different User share output; stale across builds. Fix: default cacheable false, opt in pure-syntactic macros, or key on file+resolved types; add typesugar version + cfgConfig to disk key. (Same as macros-other #2.)
4. CRITICAL confirmed — pipeline.ts:1305-1326,1711-1736 invalidate() keeps old ts.Program; getSourceFile returns pre-edit SourceFile when fresh text equals readFile (always, w/o HKT). callers unplugin.ts:177-184, language-service.ts:237-239. Vite HMR/TS plugin serve old code. Tests tests/pipeline.test.ts:86-107, tests/red-team-ts-plugin.test.ts:212-228 only assert .original. Fix: invalidate() does oldProgram=program; program=null; cachedTransformerFactory=null; assert .code in tests.
5. CRITICAL confirmed — pipeline.ts:1887 call, 2130-2193 stripLeakedArrowComments line-regex rewrite of printed output corrupts string/template literals (template with blank lines joined; `"a = // b";\nexport const y = 1;` -> syntax error). CLAUDE.md violation. Fix: delete pass; fix comment leak at AST level (setEmitFlags NoComments / setCommentRange); any stopgap must be scanner-token-aware.
6. HIGH — unplugin.ts:122-139,145-174 ignores result.diagnostics (never this.error/this.warn); pipeline catch-all ("Transform failed", incl UnapprovedMacroPackagesError) returns changed:false -> raw macro source ships; buildStart failure only console.error'd; plugin catch logs only if verbose. Fix: this.error/this.warn with locations; fail on buildStart error.
7. HIGH confirmed(.js) — pipeline.ts:2021-2097 dep tracking: `./a.js` resolved as a.js.ts/a.js (NodeNext imports never recorded); export-from ignored; import() only in top-level expression stmts; disk cache direct deps only; unplugin never addWatchFile; LS keys on own version (language-service.ts:228-234); cli.ts:495-510. Fix: deps from program resolved modules incl re-exports/all import(); transitive hashes; addWatchFile + invalidate dependents.
8. HIGH confirmed — cli.ts:949-1095 `typesugar run`: onLoad 1021-1047 only entry expanded (imports only HKT+transpile); diagnostics 985-997 never printed; close handler 1081-1089 exit(code ?? 0) on signal; non-cache path ignores tsconfig. Fix: shared pipeline for each user .ts in onLoad (emitJs), report errors, exit(code ?? 1).
9. HIGH confirmed — pipeline.ts:1186-1191,1668-1684 expression-position let:/par: preprocessing gated on globalRegistry.getLabeledBlock("let"), which lives in @typesugar/std loaded lazily at 1772-1777 after the gate -> first file mangled (`=> let, { user }; << ...`). std tests hide it (packages/std/tests/arrow-let-yield.test.ts:19-21 import std/macros). CLI build/watch never preprocess. Fix: load macro packages before gate; move preprocessing into VirtualCompilerHost.
10. HIGH confirmed — dts-transform.ts:294-296 `require.main === module` in ESM -> ReferenceError; package.json:25 bin points at ESM file, no shebang; 73-76. Fix: separate CLI entry with shebang; drop check from library.
11. HIGH — init.ts:261,290-295; doctor.ts:205,214 write LS plugin name "typesugar/language-service" which the umbrella doesn't export -> IDE silently never activates. Fix: @typesugar/transformer/language-service (or @typesugar/ts-plugin), or add export.
12. MEDIUM confirmed — pipeline.ts:1197-1204,1218-1224,1841-1864; language-service.ts:147-151: macro diagnostic positions not mapped back through HKT/comprehension rewrites (+6 chars per F<A>, +~52 for injected import). Fix: map via composed preprocess maps (findOriginalPosition).
13. MEDIUM — cli.ts:730-751 watch uses raw ts.sys (no HKT preprocessing, unlike build's readFile at 419-463) -> TS2315 in watch; watch reporter calls checker after emit without "start < 0" guard. Fix: wrap ts.sys.readFile; add guard.
14. MEDIUM confirmed — hkt-rewriter.ts:260-316: namespace import `import * as fp` skips injection but emits bare Kind<>; Kind from @typesugar/std or ./hkt not recognized -> duplicate import TS2300; "@typesugar" in allowlist not a package; injected @typesugar/type-system import not a dep of umbrella. Fix: check any local Kind binding; namespace or hygienic alias.
15. MEDIUM — cache.ts:441,550-591,692-703; pipeline.ts:1126-1163; cli.ts:406-516: DISK_CACHE_VERSION="1" not tied to version/compilerOptions/cfgConfig; hit returns diagnostics: []; build --cache stores emitted JS under same dir/key that run --cache and unplugin read as TS; entries never deleted.
16. MEDIUM confirmed — packages/typesugar/src/index.ts:66,58: `import "@typesugar/macros"` (root imports typescript, sideEffects true) pulls TS compiler + node builtins into app bundles (10.3 MB; browser fails). @typesugar/type-system used but undeclared dep. Fix: runtime-safe re-exports, drop side-effect import, declare dep.
17. MEDIUM — language-service.ts:219-239 LS never re-transforms on dependency change (cache keyed on own script version).
18. LOW — pipeline.ts:2209-2215 createPipeline drops parsed.errors from tsconfig.
19. LOW — doctor.ts:155-229 JSON.parse of JSONC tsconfig fails, extends ignored; 483-509 registration check uses require in ESM bin (always skipped); 571-640 "macro expansion test" never runs transformer; ts-patch checks fail for bundler-only users.
20. LOW (S each):

- unplugin.ts:145-150 ignores `code` arg, re-reads disk (earlier plugins' output lost; Vue/query ids skip); process.cwd() vs Vite config.root (line 124).
- unplugin.ts:157-160 verbose writes .transformed.ts into user src tree.
- transformer package.json:101-104 @typesugar/macros only devDependency but imported at runtime.
- init.ts:686-687 runtime packages installed as devDependencies.
- macro-loader.ts:160-166 ".." guard bypassed by "./../x".
- language-service.ts:124 verbose:true hard-coded.
- pipeline.ts:936-968 fixCompanionConsts regex rewrite of generated code (remove or add to CLAUDE.md list).
- pipeline.ts:463-586 generateDiffSourceMap dead; preserveBlankLines no-op; restoreBlankLines exported unused.

## 1.0 gaps

- typesugar build: no project references / incremental / --build.
- .d.ts emitted from pre-expansion AST (no afterDeclarations) — @derive/companion members likely missing from published types (needs test).
- No CLI exit-code integration tests (build/check/watch/run/expand).
- unplugin has no HMR / dependency-registration story; undocumented.
- preserveBlankLines deprecated; restoreBlankLines/formatExpansions/transformCode public without stability marking.
- --strict / strict:"incremental" experimental but exposed as stable unplugin options.
- macroTransformerFactory signature must be settled (ts-patch conflict).
- tsup splitting:false with ~16 entries duplicates module state (activeExpansionCache, loadedPackages) across transformer, /pipeline, /cli, /language-service.
- init: no Next.js support; patchTsConfig drops comments; JSONC configs fail to parse.
- ts-plugin fallback (ts-plugin/src/index.ts:20-34) resolves relative to tsserver install (wrong under VS Code bundled TS).
