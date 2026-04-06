# PEP-038: LSP Diagnostic Pipeline Fix

## Status: Implemented (Wave 1)

## Problem

The VS Code extension's LSP server had unreliable diagnostics — errors came and went,
appeared at wrong positions, or were missing entirely. Multiple root causes:

### Root Cause 1: Extension Activation Failure

`vscode-languageclient` was externalized by tsup (because it was in `dependencies`) but
never included in the VSIX, so `require("vscode-languageclient/node.js")` failed at
runtime, leaving the extension stuck on "Activating...".

### Root Cause 2: Pipeline Recreation Storm

`getTransformResult()` called `ensureFileInPipeline()` for every file.
`ensureFileInPipeline()` added the file to `projectFileNames` and **recreated the entire
pipeline**. When the TS language service read 60+ lib.d.ts files, each triggered a full
pipeline recreation that cleared all transform caches, re-transformed all project files,
and invalidated all position mappers.

### Root Cause 3: Stale AST on Edit

`onDidChangeContent` called `pipeline.invalidate(fileName)` which only cleared the
expansion cache — it did NOT reset the TS program or the cached transformer factory.
The macro transformer kept using a stale AST with old source code, so edits had no
effect on diagnostics.

### Root Cause 4: SFINAE Over-Suppression

The MacroGenerated SFINAE rule used `errorCodes: []` (wildcard) and suppressed ANY
diagnostic where `toOriginal()` returned null — including real user errors after macro
expansions.

### Root Cause 5: staticAssert Cache

The disk-backed `MacroExpansionCache` cached staticAssert results without re-emitting
diagnostics on re-transform.

## Changes

### packages/vscode/tsup.config.ts

- Added `noExternal: ["vscode-languageclient"]` — inlines the client library into the
  extension bundle.

### packages/vscode/src/extension.ts

- Changed from `module`/`TransportKind.ipc` (fork, hangs with ESM) to
  `command: "node", args: [serverModule, "--stdio"]` (spawn).
- Removed manual `registerCommand` for LSP commands — used `middleware.executeCommand`
  instead to avoid "command already exists" conflict with vscode-languageclient's
  ExecuteCommandFeature.
- Added auto-disable of `typescript.validate.enable` to prevent duplicate diagnostics.
- Added `resolveServerPath()` preferring bundled `server-bundled.cjs`.

### packages/lsp-server/src/server.ts

- **Removed `ensureFileInPipeline`** and `pipelineFileSet` entirely — the pipeline is
  created once with all project files at initialization.
- **New file handling in `onDidOpen`**: adds file to project and recreates pipeline ONCE
  only for new transformable files.
- **Guarded `getScriptSnapshot`**: early return for `.d.ts` and `node_modules` files —
  avoids calling `getTransformResult` for untransformable files.
- **Changed `invalidate` → `invalidateContent`** in `onDidChangeContent` — resets the
  TS program and transformer factory so edits produce fresh diagnostics.
- Added `pipelineGeneration` counter for TS language service cache busting.
- Pre-transforms all project files in `createPipeline` for deterministic macro registry state.

### packages/transformer/src/pipeline.ts

- Fixed `invalidateContent()` to also null `cachedTransformerFactory` — the factory
  captures a reference to the program at creation time, so it must be recreated when
  the program changes.

### packages/core/src/sfinae-rules.ts

- Changed MacroGenerated rule from `errorCodes: []` (wildcard) to specific list
  `[2451, 2304, 2339, 6133, 6196]`.

### packages/macros/src/static-assert.ts

- Added `cacheable: false` to staticAssertMacro, compileErrorMacro, compileWarningMacro.

### packages/macros/src/typeclass.ts

- Fixed @derive TS2451: skip companion `const` when namespace already exists.
- Fixed Show shadowing: hoist implementation to module scope when it references
  primitive companions (e.g., `Show.string`).

### packages/transformer/src/index.ts

- Applied @derive companion const fix in the transformer call site.

### packages/lsp-server/tsup.config.ts

- Added second config for `server-bundled.cjs` with `noExternal: [/.*/]` and
  `external: ["typescript"]`.

### packages/lsp-server/tests/lsp-integration.test.ts

- Fixed LspClient: changed from string-based to Buffer-based LSP message parsing —
  `Content-Length` is bytes but string `.length` counts characters, causing parse
  failures on multi-byte characters (e.g., `✓` in log messages).
- Added test: "staticAssert error clears when condition is fixed (false → true)".
- Added test: "@derive error updates when derives are added/removed".

### Fixture fixes

- `integration/fixtures/basic-project/src/macros.ts`: removed Show from @derive
  (not imported), changed staticAssert to `false` for error testing.
- `integration/fixtures/basic-project/src/pipe-chain.ts`: renamed `const bad` to
  `const pipeBad` to avoid TS2451 with macros.ts in same project.

### packages/vscode/test/vsix-smoke.test.ts

- Added tests for: vscode-languageclient inlining, extension size, external requires,
  lsp-server bundling, middleware usage, icon.

### tests/emit-pipeline.test.ts

- Added tests for: @derive(Eq) companion const, namespace merging, multi-interface,
  full pipeline integration.

## Known Issue: Derive Primitive Instance References

`@derive(Ord)` generates `Ord.number.compare(a.x, b.x)` which breaks when the user
imports `Ord` from typesugar (a `unique symbol`, not the primitives namespace).

`@derive(Eq)` avoids this by inlining `===` for primitive fields — a special case
that doesn't generalize.

All typeclasses that use `companionAccess("TC", "number")` for primitives have this
bug: Ord, Show, Hash, Semigroup, Monoid. It just doesn't manifest until the user
imports the typeclass symbol.

## Wave 2: Derive Primitive Instance Fix (TODO)

### Approach: Internal Primitive Imports

When derive code references primitive instances (e.g., `Ord.number`), the transformer
should inject an internal import under a non-conflicting name:

```typescript
import { Ord as __Ord } from "@typesugar/macros/primitives";
```

Then `companionAccess` for primitives generates `__Ord.number` instead of `Ord.number`.
This is general — works for all typeclasses (built-in, custom, auto-derived) without
special cases.

### Approach: @inline Instances

Allow primitive instances to be annotated with `@inline`, telling the derive system
to inline their implementation at the call site instead of generating a reference.
This eliminates the import entirely for simple cases:

```typescript
// In primitives definition:
/** @inline */
export const ordNumber = {
  compare: (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0),
};

// Generated derive output (no Ord.number reference):
{
  const _a = a.x,
    _b = b.x;
  if (_a < _b) return -1;
  if (_a > _b) return 1;
}
```

This generalizes the existing Eq primitive inlining — instead of hard-coding `===`
in Eq's `deriveProduct`, the inline comes from the instance definition itself.

### Unifying the Two Codegen Paths

Currently there are two derive codegen paths:

1. Simple path in `generateDeriveImplementation` (switch/case "Eq"/"Ord"/...)
2. Advanced path in `builtinDerivations` registry (`Eq.deriveProduct`, `Ord.deriveProduct`)

Once macro packages load, the advanced path takes over. The simple path should be
removed and the advanced path should be the only one. The `@inline` mechanism replaces
the simple path's hand-coded primitive handling.

## Verification

```bash
# All 14 LSP integration tests pass
npx vitest run packages/lsp-server/tests/lsp-integration.test.ts

# Build and install
pnpm --filter @typesugar/lsp-server build
cd packages/vscode && pnpm run package
code --install-extension typesugar-vscode-0.1.1.vsix --force

# Manual verification in VS Code:
# - staticAssert(false) shows error, change to true clears it
# - const bad: number = "wrong" shows TS2322
# - Errors update on every edit
# - createPipeline appears ONCE in output channel (not 60+)
```
