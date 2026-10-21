## Tooling group report

### Per finding

1. **C#13 (strict doesn't fail the build): fixed.** Test: `packages/unplugin-typesugar/src/__tests__/docs-review.test.ts`, "C#13: buildEnd reports through this.error and throws". It failed before the fix and passes now. `buildEnd` now collects the error-category diagnostics from `strictTypecheck()` and runs `pipeline.cleanup()` in a `finally`. It then calls `this.error(msg)` if the bundler context has one (Rollup/Vite) and also throws, which fails webpack's emit hook and esbuild's onEnd. I also fixed a bug where a diagnostic at position 0 lost its location (`diag.start ?` became `!== undefined`).
   - **What the docs should say:** `strict: true` (and `"incremental"`) fails the build when the expanded output has type errors.
2. **S#6 (include/exclude are substring matches): fixed.** Tests: 7 cases under "S#6" in the same file; 4 failed before the fix. It now uses `createFilter` from `@rollup/pluginutils@^5.3.0`. That is a new dependency of unplugin-typesugar, already in the workspace store, so I added it with `pnpm --filter ... add --offline`, which changed `pnpm-lock.yaml`.
   - Strings are picomatch globs matched against the absolute module path. A relative glob resolves against Vite's `root`, or `process.cwd()` for the other bundlers. A glob starting with `**` matches anywhere.
   - RegExps still work. Options now accept a single pattern or an array of strings and RegExps.
   - `node_modules` stays excluded even when you pass an `exclude`, unless an `include` pattern contains the text "node_modules".
   - **What the docs should say:** exactly the rules above; `["**/*.ts"]` and `["node_modules/**"]` now work as written.
3. **A#4 / S#7 (no way to pass cfg conditions): fixed.** Test: "S#7 / A#4: cfgConfig selects the debug branch", which got "release" before the fix. I added `cfgConfig?: Record<string, unknown>` to `TypesugarPluginOptions` and pass it to the pipeline as `transformerConfig.cfgConfig`.
   - **What the docs should say:** `typesugar({ cfgConfig: { debug: true } })`. The tsconfig plugin key is also `cfgConfig`.
4. **Macro packages resolved from the transformer's install: fixed.** Test: `packages/transformer/tests/docs-review-tooling.test.ts`, 3 tests, all failing before the fix.
   - **Why the test runs in a child process:** pnpm's bin shim puts `node_modules/.pnpm/node_modules` on NODE_PATH, which hides the bug inside vitest. So the test runs the src pipeline with `node --import tsx` and NODE_PATH cleared.
   - **Resolution now:** `macro-loader.ts` resolves from the importing file's directory first, falling back to the transformer's own install. That covers `loadMacroPackages`, `loadMacroPackagesFromFile`, the `@typesugar/std` preload and `approve-macros`, which now resolves from the tsconfig directory.
   - **Visible warnings:** two cases now produce a warning diagnostic on the import (code 9999, `[typesugar] macro package '...' ...`): an imported `@typesugar/*` or `typesugar` package that can't be resolved, and a package whose declared macros entry throws while loading. These reach `result.diagnostics`, the unplugin's `this.warn`, and the CLI.
   - **API change:** `loadMacroPackagesFromFile` now returns those warnings. `classifyManifestPackages` takes an optional `fromDir`.
   - **Doc example check:** `is<User>()` from validate now expands and runs correctly when validate is installed in the project.
5. **`macroModules` never read: fixed (removed).** It was declared on `MacroTransformerConfig` (pipeline.ts:67), not on `PipelineOptions`; I removed it from there. This is breaking at type level only, since nothing ever read it. `examples/showcase.ts` used it, so I switched that example to `cfgConfig`. There is no runtime test because it is a type-only removal; transformer `tsc --noEmit` is clean.
   - **What the docs should say:** remove `macroModules` from config.md and the transformer README. Macro packages are found through the `typesugar.macros` field in package.json.
6. **Dead editor settings: fixed.** No test file, since I don't own the vscode tests; I checked the manifest with `node -e` before and after.
   - I removed `typesugar.useLegacyPlugin` and `typesugar.enableVerboseLogging` from `packages/vscode/package.json`. Wiring verbose logging would need a `configurePlugin` call in vscode/src, which I don't own.
   - I contributed the `typesugar.addDerive` command ("typesugar: Add @derive(...)"). It is already registered in commands.ts and works from the command palette.
   - The ts-plugin options `extensions`/`legacyMode` exist only in `ts-plugin/README.md`; there is no code to remove. All remaining settings are read somewhere.
   - **What the docs should say:** the ts-plugin option is `verbose` only (or `TYPESUGAR_VERBOSE=1`). Drop `useLegacyPlugin`/`enableVerboseLogging` from the docs.
7. **About 35 never-emitted codes: fixed.** A grep recheck found exactly the 35 TS codes in S#29. It also found 7 effect codes that are only declared or re-exported: EFFECT002, 003, 010, 011, 021, 030 and 040. I included those, which is my decision.
   - **Generator:** `scripts/generate-error-docs.mjs` has a single `RESERVED_CODES` list. Those pages start with "> **Reserved: not currently emitted by the compiler.** …" and the index marks them _(reserved)_.
   - **Guard:** in both modes the generator re-derives the list by scanning the non-test sources in `packages/*/src`, excluding the catalogue and barrel files. It fails with an exact instruction if the list and the source disagree. I checked that the guard catches both directions.
   - **Generator bug fixed:** rewriting a page with no hand-written region used to leave two trailing blank lines, which failed prettier.
   - **Result:** regenerated 42 pages plus index.md; `--check` passes; prettier is clean on docs/errors.

### Extra change the coordinator asked for (macros agent)

`createPipeline` now passes `path.resolve(tsconfigPath)` as the 5th argument to `ts.parseJsonConfigFileContent`, so `compilerOptions.configFilePath` is set. Side effect: that path now feeds the expansion-cache key, which is harmless.

### Decisions Dean should know about

- New dependency `@rollup/pluginutils` in unplugin-typesugar, with a lockfile change.
- Relative globs resolve against the Vite root or `process.cwd()`, not the tsconfig directory, following the Rollup convention.
- "Explicitly includes node_modules" means an `include` pattern contains the text `node_modules`.
- Macro packages resolve from each importing file's directory, not one project root. Unresolvable non-`@typesugar` packages stay silent, because TypeScript already reports a missing module.
- Load warnings reuse code 9999 rather than a new catalogue code.
- `macroModules` was removed rather than implemented.
- Effect codes are included in the reserved marking.
- **Concurrency risk:** if another agent starts emitting a reserved code, `generate-error-docs --check` will fail until that code is taken out of `RESERVED_CODES` and the generator is rerun. The failure message names the exact change.

### Needs from other owners

- **vscode/src (optional):** to make verbose logging work from the editor, call the TypeScript extension API `configurePlugin("@typesugar/ts-plugin", { verbose })` from a setting. The setting declaration would then need to go back into package.json.
- **Docs agents:** update the pages for the behaviours listed above.

### Files changed

- packages/unplugin-typesugar/src/unplugin.ts
- packages/unplugin-typesugar/package.json
- pnpm-lock.yaml
- packages/unplugin-typesugar/src/**tests**/docs-review.test.ts (new)
- packages/transformer/src/macro-loader.ts
- packages/transformer/src/pipeline.ts
- packages/transformer/src/approve-macros.ts
- packages/transformer/examples/showcase.ts
- packages/transformer/tests/docs-review-tooling.test.ts (new)
- packages/vscode/package.json
- scripts/generate-error-docs.mjs
- docs/errors/index.md and 42 docs/errors/\*.md pages (all regenerated by the script)

### Verification

- Both dists are rebuilt: `@typesugar/transformer` was rebuilt after the last change; `unplugin-typesugar` was rebuilt before the `configFilePath` edit, which only touches transformer code.
- `tsc --noEmit` is clean for both packages.
- Tests pass: all 3 unplugin test files, plus the transformer pipeline, pipeline-review-fixes, pipeline-e2e, showcase, cli-exit-codes, build-emit, ts-patch-entry, cache, language-service (both files), and the macro-loader and approve-macros suites.
- Nothing is left failing, and no process of mine is still running.
