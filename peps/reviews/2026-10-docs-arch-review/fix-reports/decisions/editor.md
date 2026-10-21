## PEP-060 D5: the tsserver plugin is now the only editor engine (decisions-1.0)

The VS Code extension no longer starts the LSP client. The expansion views still work, but now through the tsserver plugin. `@typesugar/lsp-server` is marked unsupported and its code is kept. All the tests I ran pass. Nothing has been checked inside a real VS Code: the integration tests need a VS Code download, so I did not run them.

### Inventory: what the LSP client gave VS Code that the plugin didn't

| Feature                                                                                     | Outcome                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expand Macro at Cursor (peek)                                                               | **Kept.** The plugin registers a custom tsserver request, `_typesugar.expandMacro` (`session.addProtocolHandler`). The extension calls it through `typescript.tsserverRequest`. It is in the command palette and the editor context menu.                                                             |
| Show Transformed Source (diff)                                                              | **Kept.** Same mechanism, request `_typesugar.showTransformed`. It shows the unsaved buffer.                                                                                                                                                                                                          |
| Inlay hints (expansion previews)                                                            | **Kept.** The plugin now overrides `provideInlayHints` and adds `= <expansion>` after expression-macro calls. TS's own hints are now mapped back to source positions (before, they came out at transformed positions). VS Code only asks for hints when some `typescript.inlayHints.*` setting is on. |
| `typesugar.comptimeInEditor`                                                                | **Kept.** The extension sends it with the TS extension's `configurePlugin`, and only in trusted workspaces. The plugin takes it from `onConfigurationChanged`, or from `info.config` only when the tsconfig plugin entry doesn't contain the key, so a repo can't turn it on from its own tsconfig.   |
| Macro semantic tokens                                                                       | **Dropped.** tsserver's classification legend is fixed to TS's own token types, so custom `macro` tokens can't be expressed. The TextMate grammars stay.                                                                                                                                              |
| CodeLens                                                                                    | **Dropped.** tsserver has no CodeLens hook, and a VS Code-side port would be a bigger job. Inlay hints and the context-menu command cover it.                                                                                                                                                         |
| Status bar                                                                                  | **Dropped.** Its only action was refreshManifest.                                                                                                                                                                                                                                                     |
| refreshManifest / generateManifest / addDerive                                              | **Dropped.** generateManifest ran `typesugar build --manifest`, a flag that doesn't exist. addDerive was never a real edit.                                                                                                                                                                           |
| Diagnostics, completion, hover, definition, references, rename, signature help, quick fixes | The plugin already served all of these.                                                                                                                                                                                                                                                               |

### Plugin changes (`packages/transformer/src/language-service.ts`)

Besides the requests and settings above:

- **Double load:** the plugin now loads at most once per project, via a `Symbol.for` marker on the host. A second load stands down and forwards configuration to the first. Before this, a tsconfig entry plus the VS Code global plugin transformed already-transformed code. tsserver also re-wraps on tsconfig reload, and that case is now covered too.
- **TS refactors:** positions are now mapped into transformed coordinates, and the edits are mapped back. Before, `getApplicableRefactors` crashed on transformed files; the failing test reproduced it.
- **Do-nothing refactors removed:** "Expand …" and "Add @derive" did nothing. Only "Wrap in comptime" is still offered.

### Other changes

- **VS Code extension:**
  - `extension.ts` is rewritten.
  - 8 dead modules and 5 of their tests are deleted.
  - `package.json`:
    - Removed `@typesugar/lsp-server` and `vscode-languageclient`.
    - Removed the semantic-token contributions, three commands, four settings and the manifest activation event.
    - Added `menus` entries for the two commands.
  - `tsup.config.ts`: removed the `noExternal` entry for `vscode-languageclient`.
  - The packaging scripts no longer bundle lsp-server.
  - The vsix and integration tests are updated.
- **lsp-server:**
  - README banner.
  - New `src/deprecation.ts`: a one-time warning on stderr plus `window.showWarningMessage`.
  - `server.ts` calls it in `onInitialized` (one added line).
- **Plugin name:** standardised on `@typesugar/transformer/language-service`. That's the name `typesugar init` writes. It is now used in the docs and the ts-plugin README/showcase. The `examples/*/tsconfig.json` files had the nonexistent `typesugar/language-service`; fixed. `.zed/settings.json` (repo root and examples/basic) switched from `typesugar-lsp` to vtsls.
- **Docs:**
  - `editor-setup.md` is rewritten plugin-first. It covers VS Code, Neovim (ts_ls, and vtsls with `autoUseWorkspaceTsdk` or `globalPlugins`), Zed, Sublime, Helix, Emacs, JetBrains (marked unverified) and the TS 7 note. The page says the per-editor snippets are untested.
  - Updated where they mentioned the LSP or the removed settings: the docs/editor-setup.md stub, comptime.md, the VS Code section of config.md, README.md and AGENTS.md.
- PEP-060 D5 is marked decided, and there is a new changeset `.changeset/pep-060-d5-single-editor-engine.md`.
- **Manifest machinery:** the vscode side is gone. Still there:
  - `transformer/src/manifest.ts` (exported, not wired to the CLI)
  - `lsp-server/src/manifest.ts`
  - the plugin's `getMacroManifest`, which gates "Wrap in comptime" on a `typesugar.manifest.json`
  - the vscode test fixture

### Tests (all through the limiter, one at a time)

| Test                                                             | Result                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------ |
| New `transformer/tests/language-service-editor.test.ts`          | 12/12; it failed first, 10 of 12                             |
| `language-service.test.ts`                                       | 42/42                                                        |
| `language-service-review-fixes.test.ts`                          | 4/4                                                          |
| vscode unit tests (`extension-activation`, `vsix-smoke`)         | 46/46; activation failed first                               |
| New `lsp-server/tests/deprecation.test.ts` + `helpers` + `wave2` | 81/81                                                        |
| `ts-plugin/test/plugin.test.ts`                                  | 17/17                                                        |
| `tsc --noEmit` for transformer, vscode, lsp-server               | Clean                                                        |
| vscode `tsup` build                                              | Built; 138 MB peak; output requires only `vscode` and `path` |

### Decisions for Dean

- The VS Code side depends on two VS Code behaviours, both unverified here. `typescript.tsserverRequest` forwards custom commands only when the name starts with `_` (the Vue tools rely on the same rule). `configurePlugin` is matched by the name `@typesugar/ts-plugin`.
- Wrap in comptime still needs `typesugar.manifest.json`, so it's undocumented for now.
- After a tsconfig reload, the plugin keeps the pipeline it built from the old compiler options. That is an existing limitation, now a safe one rather than a double transform.

### Needs from others / not done

- **`pnpm-lock.yaml`:** must be refreshed (`pnpm install`). The vscode importer dropped two dependencies, so `--frozen-lockfile` will fail until then. I did not touch the lockfile because other agents are changing dependency ranges.
- **Dist builds:** I did not rebuild the transformer or lsp-server dist. A full build would bundle the other agents' unfinished edits and take more RAM. They're needed before packaging the VSIX, and before anything else that loads the plugin from dist.
- **Example dependencies (pnpm):** `@typesugar/transformer` should become a direct devDependency of `examples/basic`, `examples/implicits` and `examples/standalone/hello-world`. Under pnpm it isn't resolvable from the example roots, so the editor can't find the plugin. This also needs the lockfile.

### Files changed

- `packages/transformer/src/language-service.ts`
- `packages/transformer/tests/language-service-editor.test.ts` (new)
- `packages/vscode/`: `src/extension.ts`, `package.json`, `tsup.config.ts`, `scripts/bundle-ts-plugin.js`, `scripts/inject-ts-plugin.js`, `test/extension-activation.test.ts`, `test/vsix-smoke.test.ts`, `test/mocks/vscode-mock.ts`, `test/integration/{activation,commands,providers}.test.ts`, `README.md`, `examples/showcase.ts`
- Deleted from `packages/vscode/src/`: `code-actions.ts`, `codelens.ts`, `commands.ts`, `diagnostics.ts`, `expansion.ts`, `inlay-hints.ts`, `manifest.ts`, `semantic-tokens.ts`
- Deleted from `packages/vscode/test/`: `codelens-inlay`, `error-scenarios`, `expansion`, `manifest`, `semantic-tokens` (`.test.ts`)
- `packages/lsp-server/src/deprecation.ts` (new), `packages/lsp-server/src/server.ts`, `packages/lsp-server/tests/deprecation.test.ts` (new), `packages/lsp-server/README.md`
- `packages/ts-plugin/README.md`, `packages/ts-plugin/examples/showcase.ts`
- `docs/getting-started/editor-setup.md`, `docs/editor-setup.md`, `docs/guides/comptime.md`, `docs/reference/config.md`
- `README.md`, `AGENTS.md`
- `examples/basic/tsconfig.json`, `examples/implicits/tsconfig.json`, `examples/standalone/hello-world/tsconfig.json`
- `examples/basic/.zed/settings.json`, `.zed/settings.json`
- `peps/PEP-060-architecture-for-1.0.md`
- `.changeset/pep-060-d5-single-editor-engine.md` (new)

All under `/Users/deapovey/src/personal/typesugar/`. Nothing of mine is still running, and I made no git state changes.
