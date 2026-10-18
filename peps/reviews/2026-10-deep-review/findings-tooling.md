# Findings: tooling (lsp-server, lsp-common, vscode, eslint-plugin, playground, testing, packaging, CI, scripts, docs)

(Transcribed from reviewer report. Repros in review/: eslint/repro.mjs, eslint/full.mjs, eslint/hkt2.mjs, testing-repro.mjs, testing-repro2.mjs, testing-repro3.mjs, pkgcheck.mjs, cjs/, vercel/.)

1. CRITICAL confirmed — api/run.ts:96-185 (sandboxRequire, vm.createContext) and api/compile.ts:388 -> macros comptime.ts:551-585: host-realm constructors in context (`Error.constructor("return process")()`), /api/run module blocklist exact-string (node:child_process, fs/promises, node:fs, v8 pass). RCE + env leak; live once #4 fixed. Fix: never run untrusted code in-process (isolated-vm / microVM) or reject comptime+run on public endpoint; allowlist; no host constructors.
2. CRITICAL confirmed — eslint-plugin/src/processor.ts:169,207-244; full-processor.ts:143,173-210: supportsAutofix true but postprocess only remaps line/col; fix.range/suggestion ranges in transformed offsets applied to original -> corrupts files. Fix: map fix.range through mapper, drop unmappable; meanwhile supportsAutofix false.
3. HIGH confirmed — typesugar.org is a Squarespace "Coming Soon" page (all paths 200 placeholder; /llms.txt 404). Real site typesugar.vercel.app. README.md:8,148,328; every diagnostic help URL; scripts/release-smoke.mjs:107-118 checks status only. Fix: DNS (Dean) + smoke asserts content.
4. HIGH confirmed — scripts/build-vercel-output.mjs:60-68 format "cjs" empties import.meta; createRequire(import.meta.url) in api/run.ts:19 and transformer/core ESM dist -> all Vercel API functions crash (prod /api/compile, /api/run 500). Fix: bundle ESM or shim import.meta.url; CI step importing each built function. Fix #1 first.
5. HIGH confirmed — full-processor.ts:152-163 p.transform(filename) lints disk not buffer text. Fix: feed text.
6. HIGH — vscode/src/extension.ts:45-58,127-137 disables TS validation in workspace settings before server start, never restores. Fix: only after client.start() succeeds; restore in deactivate; or don't touch.
7. HIGH — vscode package.json typescriptServerPlugins + extension.ts:77-81: LSP and tsserver plugin both serve completion/hover/defs/refs/rename -> duplicated. lsp-server README says LSP frozen, ts-plugin supported. Fix: pick one engine or LSP diagnostics-only. (DESIGN DECISION)
8. HIGH — .github/workflows/ci.yml test-pr step `pnpm --filter "...[$BASE]" test || true` swallows failures; full test job skipped on PRs; some packages lack test script. Fix: remove || true; root vitest --changed or full suite.
9. HIGH confirmed — testing/src/macro.ts:1180-1224,1290-1327 mock<T>()/@mock emit createMockFn/MockOf without import.
10. HIGH confirmed — macro.ts:893-950 assertType<T> splices typeToString raw into string literal (`{ tag: "x" }` breaks). Fix: ts.factory + createStringLiteral.
11. HIGH confirmed — transformer/src/pipeline.ts:1632-1645 shouldTransform regex excludes packages/{core,macros,transformer,preprocessor,ts-plugin}/src for USER projects and .mts/.cts; used by lsp-server/src/server.ts:231,258,948 and language-service.ts:224. Fix: drop/anchor regex; accept /\.[cm]?[tj]sx?$/.
12. MEDIUM confirmed — macro.ts:348-359 @derive(Arbitrary) emits top-level function \_seededRandom per derived type (TS2393 / SyntaxError). Fix: once per file, unique name.
13. MEDIUM — macro.ts:524-536 assertSnapshot key has absolute path + line. Fix: relative path/expression text, no line.
14. MEDIUM — lsp-server/src/server.ts:619-638 debounced diagnostics setTimeout without try/catch, no uncaughtException handler -> crash loop.
15. MEDIUM — server.ts:940-952,213-246 file outside tsconfig recreates pipeline + sync re-transform whole project; Windows path normalisation mismatch (C:/ vs c:\) triggers rebuild every open; pre-transform cache keys never match. Fix: one normalise fn; add files without recreating.
16. MEDIUM confirmed — processor.ts:218,226 lineColToOffset(state.originalSource, …) with transformed line/col -> wrong locations; 125-137 regex edits after source map taken; lazy `\n\s*\}` stops at first inner brace (nested requires:, key named ensures:). Fix: convert using transformed text; AST/MagicString pass.
17. MEDIUM confirmed — macro.ts:139-152,241-250 power assert() re-evaluates sub-expressions on failure (n++ three times). Fix: capture into temps in place.
18. MEDIUM confirmed — macro.ts:479-490 @testCases print+parseStatements round-trip: macros in body never expanded; labels with newlines -> unterminated string. Fix: ts.factory, reuse original statements.
19. MEDIUM confirmed — 7 unlisted parseStatements/parseExpression sites in testing/src/macro.ts:210,359,490,709,948,1224,1327 (root of #10,#12,#18); field names (328) and mock method names spliced raw. Fix: migrate to ts.factory.
20. MEDIUM confirmed — every packages/\*/package.json exports map: `require` condition resolves to ESM .d.ts; tsup emits .d.cts -> TS1479 for node16 CJS consumers. Fix: require: {types: .d.cts, default: .cjs}; attw in publish dry run. (pkgcheck.mjs lists all 30)
21. MEDIUM confirmed — fp/package.json:54-58 ./effect export but fp/tsup.config.ts:11 excludes src/effect. (dup of fp #9)
22. MEDIUM confirmed — eslint-plugin ESM-only (no require condition, types after import) but peer eslint >=8 (eslintrc require()s plugins). Fix: ship CJS or peer eslint >=9.
23. LOW — server.ts:1568-1574,895-901 "Add @derive" code action calls unimplemented typesugar.addDerive; expandMacro returns data nothing displays.
24. LOW — server.ts:456-506 mapTsDiagnostic line-text fallback pins errors to unrelated lines (matching "}"); col 0 with transformed length. Fix: require non-trivial unique match or drop.
25. LOW confirmed — testing/src/index.ts:497-534 createMockFn precedence differs from Vitest/Jest; 345-356 assertType fallback rejects primitives (assertType<number>(5) throws).
26. LOW — vscode extension.ts:62-65 spawns `node` from PATH (use module: + ipc); 6 declared settings only read by 8 dead modules; activation `workspaceContains:**/node_modules/typesugar` names a directory (medium).
27. LOW — processor.ts:157, full-processor.ts:131 fileStates Map never cleared; index.ts meta.version hard-coded "0.1.0".
28. LOW — scripts/publish-remaining.sh:22-30 hard-coded other checkout path, npm publish w/o workspace:\* rewrite. Delete.
29. LOW — README.md:12 and docs/index.md hero example imports `derive` from @typesugar/std which doesn't export it; strictOutput reports "'Eq' only refers to a type" x6.

## 1.0 gaps

- release.yml publishes on every push to main without depending on CI.
- No Windows/macOS CI, no TS-version matrix; peer typescript >=5.0.0 admits TS 7 (native, no JS API) — cap to tested.
- lsp-server README "Frozen … excluded from release" but published (npm 0.1.1 depends on deleted @typesugar/preprocessor) and is VS Code's main engine — decide.
- 8 dead modules in vscode/src + their unit tests.
- LSP: only root tsconfig; no workspaceFolders/project refs/file watching; bundled TS not workspace TS; pre-transforms whole project in initialize.
- lsp-server "." export opens stdio connection on import while sideEffects:false — should be bin-only.
- @typesugar/testing/macros and @typesugar/mapper/macros register on import but sideEffects:false; api/compile.ts bare runtime imports register nothing.
- Playground: worker-entry.ts unused and loads floating typescript@5.8 from CDN; browser.ts re-exports typescript as external.
- @typesugar/testing has no test script; no test executes mock/@mock/two Arbitrary derives/assertType literal types/@testCases nested macros.
- "Wrap in comptime" code action offered for any single-line selection; broken output for partial tokens.
- semanticTokenScopes only for typescript, not typescriptreact.
- Inconsistent runtime fallbacks: staticAssert/typeAssert silent no-ops vs typeInfo/mock throw.
