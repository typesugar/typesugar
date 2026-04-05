# PEP-037: Editor Integration Testing Framework

**Status:** Draft
**Date:** 2026-04-05
**Author:** Claude (with Dean Povey)
**Depends on:** PEP-036 (source map red team)

## Problem

PEP-036 verified diagnostic positions at the transformer and LSP protocol layers, but never tested that features actually work in real editors. The typesugar extensions provide a rich feature set — diagnostics, completions, hover, go-to-definition, CodeLens, inlay hints, semantic tokens, code actions, rename, and macro expansion commands. All of these need to work correctly with position mapping through the source map pipeline.

The existing `packages/lsp-server/tests/lsp-integration.test.ts` tests the LSP protocol in isolation, but:

- Uses the **workspace-linked** LSP server (not the installed npm package)
- Constructs ad-hoc temp projects inline (no reusable fixtures)
- Only tests diagnostics, hover, completions, and go-to-definition
- Doesn't test semantic tokens, inlay hints, CodeLens, code actions, or rename

## Scope

A standalone `integration/` directory at the repo root that:

1. Tests the full LSP feature set against **installed** packages (from npm or local tarball)
2. Uses self-contained fixture projects copied to `/tmp` at test time
3. Runs manually (not in CI — editors aren't available in CI)
4. Includes manual checklists for visual verification in Cursor, VS Code, and Zed

## Feature Matrix

### Category 1: Error Positioning (red squigglies)

- TS type errors before/after macro expansions map to correct lines
- Macro-specific errors (@derive, @tailrec, summon, staticAssert) point to call site
- Errors clear when content is fixed
- Multiple error sources in same file have consistent positions
- Error spans underline the right tokens (not just start position)

### Category 2: Completions & Hover

- Standard TS completions work after macro expansion
- Extension method completions appear (`.show()` on @typeclass types)
- Hover shows correct type info on variables before/after expansions
- completionItem/resolve returns documentation
- Signature help shows parameter info

### Category 3: Navigation

- Go-to-definition jumps to correct location (not the expanded code)
- Go-to-type-definition works
- Find all references works across files
- Document highlights work
- Rename maps positions correctly

### Category 4: Macro Expansion Features

- CodeLens appears above macros (comptime, @derive, sql``, etc.)
- Inlay hints show comptime values (e.g., `= 5`) and bind variable types

### Category 5: Syntax Highlighting

- Semantic token types assigned correctly: macro (purple), macroDecorator (yellow), macroTemplate (orange), extensionMethod (cyan)
- .sts/.stsx files get proper syntax highlighting

### Category 6: Code Actions

- "Expand macro" available on macro invocations
- Macro suggestion quick fixes from transformer diagnostics

## Architecture

### Layer 1: LSP-direct (automated, ~10s)

Spawn `@typesugar/lsp-server` over stdio against `/tmp` fixture projects. Send LSP requests and assert responses. This covers the shared backend for Cursor, VS Code, and Zed since all three use the same LSP server.

### Layer 2: Manual editor checklists

Step-by-step instructions for visual verification in each editor. Covers things that can't be tested via LSP alone: actual squiggly rendering, syntax colors, CodeLens click behavior, diff view appearance.

### Two Modes

| Mode     | `TYPESUGAR_TEST_MODE` | Fixture deps                 | LSP server                   |
| -------- | --------------------- | ---------------------------- | ---------------------------- |
| Released | `released` (default)  | `typesugar@latest` from npm  | From `node_modules`          |
| Local    | `local`               | Local tarball via `npm pack` | From `node_modules` (packed) |

### Iterative Dev Cycle

1. Fix code in `packages/lsp-server/` or `packages/transformer-core/`
2. `pnpm build --filter @typesugar/lsp-server`
3. `cd integration && TYPESUGAR_TEST_MODE=local npx vitest run` (~10s)
4. When happy, build VSIX + verify visually via manual checklist

## Directory Structure

```
integration/
  README.md
  package.json
  tsconfig.json
  vitest.config.ts

  fixtures/
    basic-project/
      package.json
      tsconfig.json
      typesugar.manifest.json
      src/
        diagnostics.ts
        completions.ts
        navigation.ts
        macros.ts
        extension-methods.ts
        pipe-chain.ts
    sts-project/
      package.json
      tsconfig.json
      typesugar.manifest.json
      src/
        pipe-operator.sts
        cons-operator.sts
        hkt-syntax.sts

  lib/
    fixture-manager.ts
    lsp-client.ts
    assertions.ts

  tests/
    diagnostics.test.ts
    completions.test.ts
    hover.test.ts
    navigation.test.ts
    code-actions.test.ts
    semantic-tokens.test.ts
    inlay-hints.test.ts
    codelens.test.ts
    rename.test.ts
    sts-features.test.ts

  manual/
    checklist-cursor.md
    checklist-vscode.md
    checklist-zed.md
```

## Fixture Design

Each fixture is a self-contained npm project. At test time, `fixture-manager.ts` copies it to `/tmp`, runs `npm install` (which installs the real published `typesugar` package or a local tarball), and returns the path. The LSP server is spawned from the fixture's `node_modules/.bin/typesugar-lsp`.

### basic-project/src/diagnostics.ts

```typescript
// Line 1: Type error BEFORE macro expansion
const x: number = "wrong"; // TS2322 on line 1

// Line 3-5: @derive generates companion namespace
/** @derive(Eq) */
interface Point {
  x: number;
  y: number;
}

// Line 7: Type error AFTER @derive expansion — must not drift
const y: string = 42; // TS2322 on line 7

// Line 9-10: Macro error
import { staticAssert } from "typesugar";
staticAssert(false, "intentional"); // typesugar error on line 10
```

### basic-project/src/completions.ts

```typescript
/** @derive(Eq) */
interface Color { r: number; g: number; b: number; }

const c: Color = { r: 0, g: 0, b: 0 };
c.  // <-- completions at line 4, char 2: should include r, g, b
```

### basic-project/src/navigation.ts

```typescript
function greet(name: string): string {
  return `Hello, ${name}!`;
}

const msg = greet("world");
// goto-def on "greet" at line 4 → should jump to line 0
// find-references on "greet" → should find lines 0 and 4
```

## Consequences

### Benefits

- Regression-proof testing of the full editor feature set
- Fixture-based approach makes adding new test cases trivial
- Manual checklists document expected behavior for visual features
- Two-mode support enables both release smoke testing and iterative development

### Trade-offs

- Tests run against installed packages, so there's a build step for local mode
- Manual checklists require human verification (can't fully automate visual features)
- Standalone `integration/` directory means separate `npm install` for test deps

### Future work

- Automated Zed testing when Zed provides a testing API
- Screenshot comparison for visual regression testing
- CI support if headless VS Code testing becomes reliable
