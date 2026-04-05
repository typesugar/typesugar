# Integration Tests

End-to-end tests for typesugar editor features. Tests the real LSP server against
fixture projects in `/tmp`, covering diagnostics, completions, hover, navigation,
code actions, semantic tokens, inlay hints, CodeLens, and rename.

See [PEP-037](../peps/PEP-037-editor-integration-testing.md) for the full design.

## Quick Start

### Test against local build (development)

```bash
# 1. Build the packages
cd /path/to/typesugar
pnpm build --filter @typesugar/lsp-server --filter typesugar --filter @typesugar/std

# 2. Install test deps (first time only)
cd integration
npm install

# 3. Run tests
TYPESUGAR_TEST_MODE=local npx vitest run
```

### Test against released npm packages

```bash
cd integration
npm install
TYPESUGAR_TEST_MODE=released npx vitest run
```

### Run a single test file

```bash
TYPESUGAR_TEST_MODE=local npx vitest run tests/diagnostics.test.ts
```

## How It Works

1. `fixture-manager.ts` copies a fixture from `fixtures/` to `/tmp`
2. Runs `npm install` in the `/tmp` project (installs typesugar from npm or local tarball)
3. Spawns `typesugar-lsp --stdio` from the fixture's `node_modules`
4. Sends LSP requests and asserts responses match expected positions

## Iterative Dev Cycle

1. Fix code in `packages/`
2. `pnpm build --filter @typesugar/lsp-server`
3. `cd integration && TYPESUGAR_TEST_MODE=local npx vitest run tests/diagnostics.test.ts`
4. When happy, build VSIX + verify visually via manual checklist

## Manual Checklists

For visual verification in real editors:

- [Cursor checklist](manual/checklist-cursor.md)
- [VS Code checklist](manual/checklist-vscode.md)
- [Zed checklist](manual/checklist-zed.md)

## Modes

| Mode     | `TYPESUGAR_TEST_MODE` | What happens                                |
| -------- | --------------------- | ------------------------------------------- |
| Local    | `local` (default)     | Packs local packages, installs from tarball |
| Released | `released`            | Installs from npm registry                  |

## Adding a new test

1. Add source files to `fixtures/basic-project/src/` with intentional errors at known lines
2. Add test assertions in the relevant `tests/*.test.ts` file
3. Update the manual checklists if the new test covers visual features
