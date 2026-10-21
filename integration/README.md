# Integration Tests

End-to-end tests for typesugar's editor support. Each test file starts TypeScript's own
`tsserver` on a copy of a fixture project whose `tsconfig.json` lists the typesugar plugin
(`@typesugar/transformer/language-service`), the same process and setup every tsserver-based
editor uses (VS Code, and typescript-language-server / vtsls under Neovim, Zed, Sublime, Helix and
Emacs). The tests cover diagnostics, completions, hover, go-to-definition, references, rename,
quick fixes, inlay hints and the plugin's custom requests (`_typesugar.expandMacro`,
`_typesugar.showTransformed`).

See [PEP-037](../peps/PEP-037-editor-integration-testing.md) for the original design (written for
the LSP server, which was removed from the repo in PEP-060 D5).

## Quick Start

### Test against the local build (development)

The suite uses the monorepo's own `vitest` and `typescript`; there is nothing to install here.

```bash
# 1. Build the packages the fixture uses (the plugin loads from packages/transformer/dist)
pnpm --dir integration prepare-local

# 2. Run the tests
pnpm --dir integration test
```

### Test against released npm packages

```bash
pnpm --dir integration test:released
```

This runs `npm install` in each temp fixture copy and uses the installed `typescript`.

### Run a single test file

```bash
pnpm --dir integration test tests/diagnostics.test.ts
```

### Debugging

Set `TYPESUGAR_TSSERVER_LOG=/path/to/tsserver.log` to keep a verbose tsserver log. It includes the
plugin's `[typesugar]` lines, so it shows whether the plugin loaded and what it transformed.

## How It Works

1. `lib/fixture-manager.ts` copies a fixture from `fixtures/` to the OS temp directory. In local
   mode it links the monorepo's packages into the copy's `node_modules` with the layout npm would
   install (each package's `package.json` plus its `files`), so tsserver resolves the plugin the
   way it does in a user's project.
2. `lib/tsserver-client.ts` spawns `node .../typescript/lib/tsserver.js` with
   `--pluginProbeLocations <fixture>` and speaks tsserver's protocol: one JSON request per line
   in, `Content-Length`-framed responses and events out (framed by bytes, not characters).
3. `lib/assertions.ts` opens files, finds positions by searching the fixture text, and wraps the
   tsserver commands the tests use.

## Known plugin bugs

Tests written with `it.fails(...)` assert the correct behaviour for a bug the plugin still has,
so the suite stays green and the test turns red when the bug is fixed (then change it to `it`).
Each one names the bug in a comment and where it is tracked. There are none at the moment: the
position-mapping bugs the suite first recorded were fixed under PEP-060 item 5 (one diagnostics
and position model).

## Modes

| Mode     | `TYPESUGAR_TEST_MODE` | What happens                                       |
| -------- | --------------------- | -------------------------------------------------- |
| Local    | `local` (default)     | Links the monorepo's built packages and TypeScript |
| Released | `released`            | `npm install` from the npm registry                |

## Manual Checklists

For visual verification in real editors:

- [Cursor checklist](manual/checklist-cursor.md)
- [VS Code checklist](manual/checklist-vscode.md)

## Adding a new test

1. Add source files to `fixtures/basic-project/src/`, with intentional errors where a test needs
   them.
2. Add assertions in the relevant `tests/*.test.ts` file. Locate positions with `locate(text,
"...")` rather than hard-coded line numbers.
3. Update the manual checklists if the new test covers visual features.
