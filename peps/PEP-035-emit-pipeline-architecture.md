# PEP-035: Emit Pipeline Architecture

**Status:** Draft
**Date:** 2026-04-04
**Author:** Claude (with Dean Povey)
**Supersedes:** PEP-033 2F (namespace companion / esbuild compatibility)

## Problem

The typesugar transformer always emits TypeScript. This works for consumers that use tsc (the `build` command, ts-plugin, language service), but breaks for consumers that use esbuild or swc for TS→JS transpilation — which includes `typesugar run`, the unplugin in Vite/esbuild mode, and any user running `tsx`.

The immediate symptom is that `@derive` generates `const Point` + `namespace Point` declaration merging, which esbuild rejects with "The symbol 'Point' has already been declared". But the problem is broader: esbuild and swc intentionally do not support the full TypeScript language. Namespaces, const enums, declaration merging, and other features that require type-directed emit will all fail. As macros grow more sophisticated, more constructs will hit this boundary.

**This is not a bug in the companion pattern.** Namespace declaration merging is valid, non-deprecated TypeScript. The bug is that we hand TypeScript to tools that don't fully support TypeScript.

## Current Architecture

Every transformation path shares the same core:

```
Source (.ts/.sts)
  → preprocess (custom syntax: |>, ::, F<_>)
  → macro expansion (MacroTransformer)
  → expanded TypeScript
```

What happens next varies by consumer:

| Path               | Consumer                               | TS→JS done by  | Namespace support |
| ------------------ | -------------------------------------- | -------------- | ----------------- |
| `typesugar build`  | `program.emit()` with transformer hook | tsc            | Yes               |
| `typesugar check`  | Type-check only, no emit               | n/a            | Yes               |
| `typesugar expand` | Print to stdout                        | n/a (stays TS) | n/a               |
| `typesugar run`    | esbuild                                | esbuild        | **No**            |
| unplugin (Vite)    | esbuild (via Vite)                     | esbuild        | **No**            |
| unplugin (Webpack) | ts-loader / esbuild-loader             | Depends        | Maybe             |
| unplugin (esbuild) | esbuild                                | esbuild        | **No**            |
| ts-plugin          | TS language service                    | tsc (on emit)  | Yes               |
| LSP server         | TS language service                    | n/a (IDE only) | Yes               |
| Playground         | Browser display                        | n/a (stays TS) | n/a               |

The paths marked **No** are broken for any macro output that uses namespace merging, const enums, or other tsc-only features.

## Shared Code Today

The transformation step is already well-factored:

- **`TransformationPipeline`** (`packages/transformer/src/pipeline.ts`) — used by unplugin, LSP, language service, CLI `expand`, CLI `run`
- **`macroTransformerFactory`** — used by CLI `build` (directly via `program.emit()`)
- **`transformCode()`** — standalone single-file transform, used by playground and CLI `run` (non-cache path)

The gap is that there is **no shared post-transform transpilation step**. Each consumer is responsible for TS→JS conversion, and the non-tsc consumers can't handle the full TS output.

## Proposed Architecture

### Add a `transpile` post-pass to TransformationPipeline

Add an optional `transpile()` step that uses `ts.transpileModule()` to convert the expanded TypeScript to JavaScript before handing it to downstream consumers. This compiles away namespaces, const enums, type annotations, and any other construct that requires type-directed emit.

```
Source (.ts/.sts)
  → preprocess
  → macro expansion
  → expanded TypeScript          ← what `expand` prints, what tsc/LS consumes
  → transpile (ts.transpileModule) ← new step, opt-in
  → portable JavaScript           ← what esbuild/swc/bundlers consume
```

The transpile step is **opt-in** — consumers that use tsc for emit don't need it.

### Consumer changes

| Path               | Change                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------- |
| `typesugar build`  | None — tsc handles emit via `program.emit()`                                            |
| `typesugar check`  | None — no emit                                                                          |
| `typesugar expand` | None by default. Add `--js` flag to show transpiled output                              |
| `typesugar run`    | Enable transpile step. Feed JS (not TS) to esbuild. esbuild becomes a bundler only      |
| unplugin           | Enable transpile step. Return JS from `transform()` hook. Bundler just resolves/bundles |
| ts-plugin          | None — TS language service handles it                                                   |
| LSP server         | None — serves IDE features, no emit                                                     |
| Playground         | None by default. Could add a "compiled JS" tab                                          |

### Implementation

#### 1. Add `transpileExpanded()` to pipeline

In `packages/transformer/src/pipeline.ts`, add a function:

```typescript
function transpileExpanded(
  code: string,
  fileName: string,
  compilerOptions: ts.CompilerOptions
): { outputText: string; sourceMapText?: string } {
  return ts.transpileModule(code, {
    compilerOptions: {
      ...compilerOptions,
      // Ensure we get clean JS output
      module: ts.ModuleKind.ESNext,
      target: compilerOptions.target ?? ts.ScriptTarget.ESNext,
      sourceMap: true,
      declaration: false,
    },
    fileName,
  });
}
```

#### 2. Add `emitJs` option to TransformResult

Extend `TransformResult` to optionally include transpiled JS:

```typescript
interface TransformResult {
  code: string; // expanded TypeScript (always present)
  js?: string; // transpiled JavaScript (when requested)
  sourceMap: RawSourceMap;
  jsSourceMap?: RawSourceMap; // composed: original → TS → JS
  mapper: PositionMapper;
  diagnostics: TransformDiagnostic[];
  dependencies: Set<string>;
}
```

#### 3. Update consumers

- **`typesugar run`**: Use `result.js` instead of `result.code` as esbuild input. Change esbuild loader from `"ts"` to `"js"`.
- **unplugin**: Return `result.js` from `transform()` hook instead of `result.code`.
- **Source maps**: Compose the transpile source map with the existing transform source map so debugging maps back to the original source.

#### 4. Constraints on macro authors

None. Macros can emit any valid TypeScript. The transpile step handles portability. This is the key advantage over the alternative approach of restricting macro output to the "portable subset" of TypeScript.

### Source map composition

The full chain becomes:

```
original source → preprocessed TS → expanded TS → transpiled JS
```

Three source maps need composing. The pipeline already composes the first two. Adding the third follows the same pattern using `remapping` or `merge-source-map`.

### What about `typesugar build`?

`typesugar build` uses `program.emit()` with the transformer as a `before` hook. This means tsc does the macro expansion _and_ the TS→JS emit in a single pass. It never produces intermediate expanded TypeScript as text — the transformer modifies the AST in-place and tsc emits JS from the modified AST.

This is the most efficient path and doesn't need the transpile step. However, it means `build` uses a fundamentally different code path from all other consumers. This is an existing architectural divergence (not introduced by this PEP) and is acceptable because:

1. `build` is the only path where performance of the emit step matters (it processes all files)
2. tsc emit from a modified AST is more correct than print-then-reparse-then-transpile
3. The transformer is already tested against both paths

Long-term, if we want to unify all paths through `TransformationPipeline`, we could have `build` use the pipeline + `transpileExpanded()` instead of `program.emit()`. But that's a separate consideration and not required for correctness.

## Implementation Notes

### The companion const→var fix

`ts.transpileModule` doesn't handle `const X = {}; namespace X { ... }` declaration merging — it emits `var X;` which redeclares the block-scoped `const`. The transpile step pre-processes the expanded TypeScript to convert companion `const X: Record<string, any> = {};` declarations to `var`, since `var` redeclarations are legal JavaScript. This is done via `fixCompanionConsts()` using MagicString with a tracked source map, composed into the full chain via `composeSourceMapChain()` (remapping's array form).

The regex `/^(export )?const (\w+): Record<string, any> = \{\};/gm` is tightly scoped to only match the exact pattern emitted by `ensureDataTypeCompanionConst()` in `typeclass.ts`.

### Source map chain

The full source map chain is: original → preprocessed → expanded TS → (const→var fix) → JS. The first two maps are composed by the existing pipeline. The last two are composed by the transpile step. All four are composed using `composeSourceMapChain()` which uses `@ampproject/remapping`'s array form to avoid infinite recursion when all maps reference the same source file.

## Wave 2: Follow-up work

### 2A. Macro transformer source map coverage

**Implemented.** Added `setSourceMapRangeDeep()` to the macro transformer which recursively sets `ts.setSourceMapRange()` on all nodes in derive-generated statements (companion consts, namespace blocks, TC derive results), pointing them back to the originating `@derive` decorator. This makes `generateASTSourceMap()` produce mappings for previously-unmapped macro output lines. Coverage went from ~6 segments (3 lines) to ~33 mapped segments (10 lines) for a typical `@derive(Eq)` expansion.

### 2B. Skip transpile on unchanged files

**Implemented.** Changed the `changed` comparison from `transformed !== original` to `transformed.trimEnd() !== original.trimEnd()`. The TypeScript printer always appends a trailing newline, causing false-positive diffs for files without macros. With the fix, files with no macro activity are correctly marked as `changed: false` and skip the transpile step.

### 2C. Unplugin bundler-aware emitJs

**Implemented.** Added `needsEmitJs(framework)` function that uses unplugin's `meta.framework` parameter to detect the bundler. Only enables `emitJs` for esbuild, Vite, rolldown, and farm (which use esbuild/swc for TS→JS). Disables for webpack and rspack (which may use tsc). Falls back to `emitJs: true` for unknown bundlers (safe default).

### 2D. Integration tests for unplugin

**Implemented.** Created `tests/unplugin-integration.test.ts` with esbuild integration tests that build a `@derive(Eq, Debug)` fixture and verify:

1. Build completes without errors
2. Output is valid JavaScript (no TypeScript syntax, no namespaces)
3. Runtime execution produces correct results (`Point.Eq.equals()` and `Point.Debug.debug()`)

Note: Vite build mode cannot be tested inside Vitest (since Vitest itself runs on Vite), but the same transpile path is exercised via the esbuild tests.

## Testing

- [x] `typesugar run` on a file with `@derive(Eq, Clone, Debug, Hash)` executes successfully
- [x] `typesugar run` produces correct runtime behavior (not just no errors)
- [x] unplugin in esbuild mode works with `@derive`
- [x] Source maps in transpiled output map back to original source (not expanded TS)
- [x] Source maps cover macro-generated lines (namespace, companion) — Wave 2A
- [x] `typesugar expand` still shows TypeScript (no regression)
- [x] `typesugar expand --js` shows transpiled JavaScript
- [x] `typesugar build` is unaffected (still uses `program.emit()`)
- [x] Playground is unaffected

## Alternatives Considered

### Restrict macro output to "portable TypeScript"

Force macros to only emit constructs that esbuild/swc support (no namespaces, no const enums, no declaration merging). Rejected because:

- Limits what macros can generate
- Namespace companion is a natural, idiomatic pattern
- The "portable subset" is poorly defined and changes across esbuild/swc versions
- Pushes complexity onto every macro author

### Per-consumer workarounds

Fix each consumer individually (e.g., change `@derive` to emit assignments instead of namespaces for esbuild). Rejected because:

- Macros shouldn't need to know their consumer
- New macros would hit the same issue
- Multiplies testing surface

### Use tsc for all transpilation

Run `tsc --outDir` instead of esbuild for `typesugar run`. Rejected because:

- Much slower than esbuild for the run command
- Doesn't help the unplugin path (bundler does its own TS handling)
- tsc can't bundle

## Success Criteria

- [x] All paths that use esbuild/swc for TS→JS receive JavaScript, not TypeScript
- [x] Macro authors can emit any valid TypeScript without considering downstream consumers
- [x] Source maps work end-to-end from original source to final JS in all paths (limited by upstream macro transformer source map quality — see Known Limitations)
- [x] No performance regression in `typesugar build`
- [x] `typesugar run` works with `@derive` (resolves PEP-033 1B remaining issue and 2F)
